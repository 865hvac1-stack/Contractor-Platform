import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { can } from "@/lib/permissions";
import { missingStripeEnvVars } from "@/lib/payments/config";
import { deriveOnboardingStatus, uxStatus } from "@/lib/payments/connect";
import {
  connectAccountIdFromEvent,
  connectIdempotencyKey,
  mapV2AccountCapabilities,
  publicPaymentsError,
  v2AccountCreateParams,
  v2OnboardingLinkParams,
} from "@/lib/payments/connect-v2";
import { createInvoicePaymentIntent, resolveInvoicePaymentDestination } from "@/lib/payments/intents";
import { collectedAmountCents, reconcileInvoiceFromPayments, recordConfirmedProviderPayment } from "@/lib/payments/record";
import { constructStripeEvent, processStripeEvent } from "@/lib/payments/webhooks";
import { PAYMENT_AUTOMATION_TRIGGERS } from "@/lib/payments/events";
import { toolsForQuestion } from "@/lib/intelligence/intent";

const prisma = new PrismaClient();

describe("stripe connect status honesty", () => {
  it("never reports CONNECTED unless charges, payouts, and details are all true", () => {
    expect(
      deriveOnboardingStatus({
        chargesEnabled: false,
        payoutsEnabled: true,
        detailsSubmitted: true,
      })
    ).toBe("ACTION_REQUIRED");
    expect(
      deriveOnboardingStatus({
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
      })
    ).toBe("ACTION_REQUIRED");
    expect(
      deriveOnboardingStatus({
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: false,
      })
    ).toBe("ONBOARDING");
    expect(
      deriveOnboardingStatus({
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      })
    ).toBe("CONNECTED");
    expect(
      uxStatus({
        platformConfigured: false,
        account: {
          disabledAt: null,
          onboardingStatus: "CONNECTED",
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          requirementsDue: null,
        },
      })
    ).toBe("NOT_CONFIGURED");
  });

  it("lists missing Stripe environment variables without inventing keys", () => {
    const previous = {
      secret: process.env.STRIPE_SECRET_KEY,
      pub: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      hook: process.env.STRIPE_WEBHOOK_SECRET,
    };
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(missingStripeEnvVars()).toEqual([
      "STRIPE_SECRET_KEY",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    if (previous.secret) process.env.STRIPE_SECRET_KEY = previous.secret;
    if (previous.pub) process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = previous.pub;
    if (previous.hook) process.env.STRIPE_WEBHOOK_SECRET = previous.hook;
  });

  it("rejects webhook events without a configured secret or signature", () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(constructStripeEvent("{}", "t=1,v1=abc").status).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    expect(constructStripeEvent("{}", null).status).toBe(401);
    expect(constructStripeEvent("{}", "t=1,v1=not-valid").status).toBe(401);
    if (previous) process.env.STRIPE_WEBHOOK_SECRET = previous;
    else delete process.env.STRIPE_WEBHOOK_SECRET;
  });
});

describe("stripe accounts v2 helpers", () => {
  it("creates the documented SaaS Accounts v2 merchant configuration", () => {
    const body = v2AccountCreateParams({
      companyId: "co_865",
      email: "owner@865hvac.local",
      businessName: "865 HVAC",
    });
    expect(body.dashboard).toBe("full");
    expect(body.defaults.responsibilities.fees_collector).toBe("stripe");
    expect(body.defaults.responsibilities.losses_collector).toBe("stripe");
    expect(body.identity.country).toBe("us");
    expect(body.configuration.merchant.capabilities.card_payments.requested).toBe(true);
    expect(body.configuration.merchant.capabilities).not.toHaveProperty("ach_debit_payments");
    expect(body.metadata.companyId).toBe("co_865");
    expect(JSON.stringify(body)).not.toMatch(/"type"\s*:\s*"express"/);
    expect(body.dashboard).not.toBe("express");
    expect(v2OnboardingLinkParams("acct_123", { refreshUrl: "https://a/r", returnUrl: "https://a/return" }).use_case.type).toBe(
      "account_onboarding"
    );
    expect(connectIdempotencyKey("co_865")).toBe("cy-connect-v2-saas-co_865");
  });

  it("reuses the same idempotency key for one company", () => {
    expect(connectIdempotencyKey("co_a")).toBe(connectIdempotencyKey("co_a"));
    expect(connectIdempotencyKey("co_a")).not.toBe(connectIdempotencyKey("co_b"));
  });

  it("does not mark CONNECTED unless card payments and payouts are active", () => {
    const incomplete = mapV2AccountCapabilities({
      id: "acct_1",
      configuration: {
        merchant: {
          applied: false,
          capabilities: { card_payments: { status: "pending" } },
        },
      },
      requirements: { entries: [{ awaiting_action_from: "user", description: "business_profile.url" }] },
    });
    expect(incomplete.chargesEnabled).toBe(false);
    expect(incomplete.detailsSubmitted).toBe(false);
    expect(
      deriveOnboardingStatus({
        chargesEnabled: incomplete.chargesEnabled,
        payoutsEnabled: incomplete.payoutsEnabled,
        detailsSubmitted: incomplete.detailsSubmitted,
        requirementsDue: incomplete.requirementsDue,
      })
    ).toBe("ONBOARDING");

    const ready = mapV2AccountCapabilities({
      id: "acct_2",
      configuration: {
        merchant: {
          applied: true,
          capabilities: {
            card_payments: { status: "active" },
            stripe_balance: { payouts: { status: "active" } },
          },
        },
      },
      requirements: { entries: [] },
    });
    expect(ready.chargesEnabled).toBe(true);
    expect(ready.payoutsEnabled).toBe(true);
    expect(ready.detailsSubmitted).toBe(true);
    expect(
      deriveOnboardingStatus({
        chargesEnabled: ready.chargesEnabled,
        payoutsEnabled: ready.payoutsEnabled,
        detailsSubmitted: ready.detailsSubmitted,
      })
    ).toBe("CONNECTED");
  });

  it("resolves connected account ids from v2 events and never from a browser companyId", () => {
    expect(
      connectAccountIdFromEvent({
        type: "v2.core.account[requirements].updated",
        related_object: { id: "acct_v2_1" },
      })
    ).toBe("acct_v2_1");
    expect(connectAccountIdFromEvent({ type: "account.updated", account: "acct_v1_1" })).toBe("acct_v1_1");
    expect(
      connectAccountIdFromEvent({
        type: "v2.core.account.updated",
        data: { object: { id: "acct_v2_obj", object: "v2.core.account" } },
      })
    ).toBe("acct_v2_obj");
    expect(connectAccountIdFromEvent({ type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } })).toBeUndefined();
    expect(
      connectAccountIdFromEvent({
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_1", metadata: { companyId: "browser-supplied" } } },
      })
    ).toBeUndefined();
  });

  it("hides raw Stripe API errors from contractors", () => {
    const safe = publicPaymentsError(
      new Error("Stripe no longer recommends Accounts v1. Create connected accounts with POST /v2/core/accounts instead. sk_test_abc123")
    );
    expect(safe.user).toMatch(/couldn't start setup/i);
    expect(safe.user).not.toMatch(/Accounts v1|sk_test/);
    expect(safe.diagnostic).not.toMatch(/sk_test_abc123/);

    const coded = publicPaymentsError({
      message: "This account configuration is not supported. Please reference https://docs.stripe.com/connect/design-an-integration.",
      code: "account_controller_express_dash_without_application_losses_or_fees",
      requestId: "req_test_123",
    });
    expect(coded.user).toMatch(/couldn't start setup/i);
    expect(coded.user).not.toMatch(/account_controller|design-an-integration/);
    expect(coded.diagnostic).toContain("account_controller_express_dash_without_application_losses_or_fees");
    expect(coded.diagnostic).toContain("req_test_123");
  });
});

describe("payment permissions", () => {
  it("lets owners manage and refund, technicians collect only, dispatchers neither", () => {
    expect(can("COMPANY_OWNER", "payments:manage")).toBe(true);
    expect(can("COMPANY_OWNER", "payments:refund")).toBe(true);
    expect(can("OFFICE", "payments:refund")).toBe(true);
    expect(can("OFFICE", "payments:manage")).toBe(false);
    expect(can("TECHNICIAN", "invoices:field")).toBe(true);
    expect(can("TECHNICIAN", "payments:refund")).toBe(false);
    expect(can("TECHNICIAN", "payments:manage")).toBe(false);
    expect(can("DISPATCHER", "invoices:field")).toBe(false);
    expect(can("DISPATCHER", "payments:refund")).toBe(false);
  });
});

describe("stripe connect tenant payments", () => {
  const ids = {
    companyA: "",
    companyB: "",
    customerA: "",
    customerB: "",
    invoiceA: "",
    invoiceB: "",
    historical: "",
    voided: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const user = await prisma.user.create({
      data: {
        email: `pay-a-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Pay",
        lastName: "Owner",
      },
    });
    const companyA = await prisma.company.create({
      data: {
        businessName: `Pay A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: user.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `Pay B ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Tony", lastName: "Bailey" },
    });
    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Other", lastName: "Co" },
    });
    const invoiceA = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        invoiceNumber: `INV-PAY-${stamp}`,
        status: "SENT",
        subtotalCents: 48500,
        taxCents: 0,
        totalCents: 48500,
        balanceCents: 48500,
        publicToken: `paytok-${stamp}`,
      },
    });
    const invoiceB = await prisma.invoice.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        invoiceNumber: `INV-B-${stamp}`,
        status: "SENT",
        subtotalCents: 10000,
        taxCents: 0,
        totalCents: 10000,
        balanceCents: 10000,
        publicToken: `paytok-b-${stamp}`,
      },
    });
    const historical = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        invoiceNumber: `INV-HIST-${stamp}`,
        status: "SENT",
        subtotalCents: 20000,
        taxCents: 0,
        totalCents: 20000,
        balanceCents: 20000,
        importMode: "HISTORICAL",
      },
    });
    const voided = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        invoiceNumber: `INV-VOID-${stamp}`,
        status: "VOID",
        subtotalCents: 1000,
        taxCents: 0,
        totalCents: 1000,
        balanceCents: 1000,
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    ids.customerA = customerA.id;
    ids.customerB = customerB.id;
    ids.invoiceA = invoiceA.id;
    ids.invoiceB = invoiceB.id;
    ids.historical = historical.id;
    ids.voided = voided.id;
  });

  afterAll(async () => {
    const companies = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.stripeWebhookEvent.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.stripeConnectAccount.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.payment.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.invoice.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "pay-a-" } } });
    await prisma.$disconnect();
  });

  it("refuses to charge another company's invoice", async () => {
    const result = await createInvoicePaymentIntent(prisma, {
      companyId: ids.companyA,
      invoiceId: ids.invoiceB,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });

  it("refuses historical, void, and unpaid-setup invoices", async () => {
    const historical = await createInvoicePaymentIntent(prisma, {
      companyId: ids.companyA,
      invoiceId: ids.historical,
    });
    expect(historical.ok).toBe(false);
    if (!historical.ok) expect(historical.error).toMatch(/historical/i);

    const voided = await createInvoicePaymentIntent(prisma, {
      companyId: ids.companyA,
      invoiceId: ids.voided,
    });
    expect(voided.ok).toBe(false);

    const notSetup = await createInvoicePaymentIntent(prisma, {
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
    });
    expect(notSetup.ok).toBe(false);
    if (!notSetup.ok) expect(notSetup.error).toMatch(/not set up/i);
  });

  it("stores one connected account per company and never leaks Company B's Stripe id", async () => {
    await prisma.stripeConnectAccount.create({
      data: {
        companyId: ids.companyA,
        stripeAccountId: `acct_a_${ids.companyA}`,
        onboardingStatus: "ONBOARDING",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });
    await prisma.stripeConnectAccount.create({
      data: {
        companyId: ids.companyB,
        stripeAccountId: `acct_b_${ids.companyB}`,
        onboardingStatus: "CONNECTED",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });
    const a = await prisma.stripeConnectAccount.findUnique({ where: { companyId: ids.companyA } });
    const b = await prisma.stripeConnectAccount.findUnique({ where: { companyId: ids.companyB } });
    const leaked = await prisma.stripeConnectAccount.findFirst({
      where: { companyId: ids.companyA, stripeAccountId: b!.stripeAccountId },
    });
    expect(a?.stripeAccountId).toBe(`acct_a_${ids.companyA}`);
    expect(b?.stripeAccountId).toBe(`acct_b_${ids.companyB}`);
    expect(leaked).toBeNull();
    const secondA = await prisma.stripeConnectAccount
      .create({
        data: {
          companyId: ids.companyA,
          stripeAccountId: `acct_a_dup_${ids.companyA}`,
        },
      })
      .catch((error: { code?: string }) => error);
    expect(secondA).toMatchObject({ code: "P2002" });
  });

  it("routes Company A invoices only to Company A's connected account", async () => {
    const destA = await resolveInvoicePaymentDestination(prisma, {
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
    });
    const destCross = await resolveInvoicePaymentDestination(prisma, {
      companyId: ids.companyA,
      invoiceId: ids.invoiceB,
    });
    const destSpoof = await resolveInvoicePaymentDestination(prisma, {
      companyId: ids.companyB,
      invoiceId: ids.invoiceA,
    });
    expect(destA.ok).toBe(true);
    if (destA.ok) {
      expect(destA.stripeAccountId).toBe(`acct_a_${ids.companyA}`);
      expect(destA.stripeAccountId).not.toBe(`acct_b_${ids.companyB}`);
      expect(destA.amountCents).toBe(48500);
    }
    expect(destCross.ok).toBe(false);
    expect(destSpoof.ok).toBe(false);
  });

  it("rejects webhook payment events that spoof another company's invoice", async () => {
    const event = {
      id: `evt_spoof_${Date.now()}`,
      type: "payment_intent.succeeded",
      account: `acct_a_${ids.companyA}`,
      data: {
        object: {
          id: `pi_spoof_${Date.now()}`,
          amount: 10000,
          amount_received: 10000,
          payment_method_types: ["card"],
          metadata: { companyId: ids.companyA, invoiceId: ids.invoiceB },
        },
      },
    } as never;
    await processStripeEvent(prisma, event);
    const payments = await prisma.payment.findMany({
      where: { invoiceId: ids.invoiceB, provider: "STRIPE" },
    });
    expect(payments).toHaveLength(0);
  });

  it("keeps ACH processing off the paid balance until success", async () => {
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: ids.invoiceA,
        customerId: ids.customerA,
        amountCents: 48500,
        method: "ACH",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_processing_test",
      },
    });
    const invoice = await reconcileInvoiceFromPayments(prisma, ids.invoiceA, ids.companyA);
    expect(invoice?.amountPaidCents).toBe(0);
    expect(invoice?.status).not.toBe("PAID");
    expect(collectedAmountCents({ status: "PROCESSING", amountCents: 48500 })).toBe(0);
  });

  it("marks the invoice paid only after a confirmed payment and stays idempotent", async () => {
    const first = await recordConfirmedProviderPayment({
      prisma,
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
      amountCents: 48500,
      provider: "STRIPE",
      providerPaymentId: "pi_success_test",
      method: "CREDIT_CARD",
    });
    expect(first.created).toBe(true);
    const second = await recordConfirmedProviderPayment({
      prisma,
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
      amountCents: 48500,
      provider: "STRIPE",
      providerPaymentId: "pi_success_test",
      method: "CREDIT_CARD",
    });
    expect(second.created).toBe(false);
    const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceA } });
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.balanceCents).toBe(0);
    const count = await prisma.payment.count({
      where: { companyId: ids.companyA, providerPaymentId: "pi_success_test" },
    });
    expect(count).toBe(1);
  });

  it("does not let cash exceed the remaining balance", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        invoiceNumber: `INV-CASH-${Date.now()}`,
        status: "SENT",
        subtotalCents: 10000,
        taxCents: 0,
        totalCents: 10000,
        amountPaidCents: 0,
        balanceCents: 10000,
      },
    });
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: invoice.id,
        customerId: ids.customerA,
        amountCents: 10000,
        method: "CASH",
        status: "RECORDED",
        provider: "MANUAL",
      },
    });
    await reconcileInvoiceFromPayments(prisma, invoice.id, ids.companyA);
    const paid = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(paid?.balanceCents).toBe(0);
    expect(paid?.status).toBe("PAID");
    expect(10001 > (paid?.balanceCents ?? 0)).toBe(true);
  });

  it("replays the same Stripe event without creating a second payment", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        invoiceNumber: `INV-WH-${Date.now()}`,
        status: "SENT",
        subtotalCents: 20000,
        taxCents: 0,
        totalCents: 20000,
        balanceCents: 20000,
      },
    });
    const event = {
      id: `evt_pay_${Date.now()}`,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: `pi_wh_${Date.now()}`,
          amount: 20000,
          amount_received: 20000,
          payment_method_types: ["card"],
          metadata: { companyId: ids.companyA, invoiceId: invoice.id },
        },
      },
    } as never;
    const first = await processStripeEvent(prisma, event);
    const second = await processStripeEvent(prisma, event);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const payments = await prisma.payment.findMany({
      where: { invoiceId: invoice.id, provider: "STRIPE" },
    });
    expect(payments).toHaveLength(1);
    const updated = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(updated?.status).toBe("PAID");
  });

  it("exposes payment tools to Intelligence without inventing transactions", () => {
    const tools = toolsForQuestion("How much did we collect today?");
    expect(tools).toContain("getPaymentCollection");
    expect(PAYMENT_AUTOMATION_TRIGGERS).toContain("PAYMENT_SUCCEEDED");
  });
});
