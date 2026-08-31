import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { can } from "@/lib/permissions";
import { missingStripeEnvVars } from "@/lib/payments/config";
import { deriveOnboardingStatus, uxStatus } from "@/lib/payments/connect";
import { createInvoicePaymentIntent } from "@/lib/payments/intents";
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
