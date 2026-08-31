import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const retrieve = vi.fn();

vi.mock("@/lib/payments/stripe-client", () => ({
  requireStripe: () => ({
    paymentIntents: { retrieve },
    webhooks: {
      constructEvent: vi.fn(() => {
        throw new Error("Invalid signature.");
      }),
    },
    parseEventNotification: vi.fn(() => {
      throw new Error("Invalid signature.");
    }),
  }),
}));

const { constructStripeEvent, processStripeEvent } = await import("@/lib/payments/webhooks");
const {
  confirmStripeIntentPayment,
  invoiceForStripeIntent,
  invoicePaymentSnapshot,
  loadAuthoritativeInvoice,
  syncStripePaymentFromProvider,
} = await import("@/lib/payments/sync");
const {
  collectedAmountCents,
  reconcileInvoiceFromPayments,
  recordConfirmedProviderPayment,
} = await import("@/lib/payments/record");
const {
  STRIPE_PAYMENT_WEBHOOK_EVENTS,
  STRIPE_WEBHOOK_LISTEN_MODE,
  STRIPE_WEBHOOK_PATH,
  STRIPE_WEBHOOK_SECRET_ENV,
} = await import("@/lib/payments/webhook-events");
const { deriveOnboardingStatus } = await import("@/lib/payments/connect");
const { v2AccountCreateParams, connectIdempotencyKey } = await import("@/lib/payments/connect-v2");

const prisma = new PrismaClient();

function piEvent(input: {
  id: string;
  type: string;
  paymentIntentId: string;
  amount: number;
  companyId?: string;
  invoiceId?: string;
  account?: string;
  methodTypes?: string[];
}) {
  return {
    id: input.id,
    type: input.type,
    account: input.account,
    data: {
      object: {
        id: input.paymentIntentId,
        amount: input.amount,
        amount_received: input.type === "payment_intent.succeeded" ? input.amount : 0,
        payment_method_types: input.methodTypes ?? ["card"],
        metadata: {
          ...(input.companyId ? { companyId: input.companyId } : {}),
          ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
        },
      },
    },
  } as never;
}

describe("stripe payment webhook → invoice sync", () => {
  const ids = {
    companyA: "",
    companyB: "",
    customerA: "",
    customerB: "",
    invoiceTen: "",
    invoicePartial: "",
    invoiceTwo: "",
    invoiceFail: "",
    invoiceAchOk: "",
    invoiceAchFail: "",
    invoiceRefund: "",
    invoiceCash: "",
    invoiceMissing: "",
    invoiceUnknown: "",
    acctA: "",
    acctB: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const companyA = await prisma.company.create({
      data: { businessName: `Sync A ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `Sync B ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Pat", lastName: "Pay" },
    });
    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Other", lastName: "Co" },
    });
    ids.acctA = `acct_sync_a_${companyA.id}`;
    ids.acctB = `acct_sync_b_${companyB.id}`;
    await prisma.stripeConnectAccount.create({
      data: {
        companyId: companyA.id,
        stripeAccountId: ids.acctA,
        onboardingStatus: "CONNECTED",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });
    await prisma.stripeConnectAccount.create({
      data: {
        companyId: companyB.id,
        stripeAccountId: ids.acctB,
        onboardingStatus: "CONNECTED",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });

    async function invoice(suffix: string, totalCents: number, companyId = companyA.id, customerId = customerA.id) {
      return prisma.invoice.create({
        data: {
          companyId,
          customerId,
          invoiceNumber: `INV-SYNC-${suffix}-${stamp}`,
          status: "DRAFT",
          subtotalCents: totalCents,
          taxCents: 0,
          totalCents,
          amountPaidCents: 0,
          balanceCents: totalCents,
        },
      });
    }

    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    ids.customerA = customerA.id;
    ids.customerB = customerB.id;
    ids.invoiceTen = (await invoice("10", 1000)).id;
    ids.invoicePartial = (await invoice("PART", 100000)).id;
    ids.invoiceTwo = (await invoice("TWO", 100000)).id;
    ids.invoiceFail = (await invoice("FAIL", 2500)).id;
    ids.invoiceAchOk = (await invoice("ACHOK", 4000)).id;
    ids.invoiceAchFail = (await invoice("ACHBAD", 4000)).id;
    ids.invoiceRefund = (await invoice("REF", 100000)).id;
    ids.invoiceCash = (await invoice("CASH", 1500)).id;
    ids.invoiceMissing = (await invoice("MISS", 1000)).id;
    ids.invoiceUnknown = (await invoice("UNK", 1000)).id;
  });

  afterAll(async () => {
    const companies = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.stripeWebhookEvent.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.payment.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.stripeConnectAccount.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.invoice.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.$disconnect();
  });

  it("documents connected-account webhook configuration", () => {
    expect(STRIPE_WEBHOOK_LISTEN_MODE).toBe("events_on_connected_accounts");
    expect(STRIPE_WEBHOOK_PATH).toBe("/api/webhooks/stripe");
    expect(STRIPE_WEBHOOK_SECRET_ENV).toBe("STRIPE_WEBHOOK_SECRET");
    expect(STRIPE_PAYMENT_WEBHOOK_EVENTS).toContain("payment_intent.succeeded");
    expect(STRIPE_PAYMENT_WEBHOOK_EVENTS).toContain("charge.succeeded");
    expect(STRIPE_PAYMENT_WEBHOOK_EVENTS).toContain("payment_intent.processing");
  });

  it("INV-00001 regression: $10 connected-account success creates one SUCCEEDED payment and marks the invoice PAID", async () => {
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: ids.invoiceTen,
        customerId: ids.customerA,
        amountCents: 1000,
        method: "CREDIT_CARD",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_ten_dollar",
        stripeAccountId: ids.acctA,
        notes: "Stripe PaymentIntent created",
      },
    });

    const event = piEvent({
      id: "evt_ten_dollar",
      type: "payment_intent.succeeded",
      paymentIntentId: "pi_ten_dollar",
      amount: 1000,
      companyId: ids.companyA,
      invoiceId: ids.invoiceTen,
      account: ids.acctA,
    });
    const first = await processStripeEvent(prisma, event);
    const second = await processStripeEvent(prisma, event);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const payments = await prisma.payment.findMany({
      where: { invoiceId: ids.invoiceTen, provider: "STRIPE" },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe("SUCCEEDED");
    expect(payments[0]?.amountCents).toBe(1000);
    expect(payments[0]?.providerPaymentId).toBe("pi_ten_dollar");

    const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceTen } });
    expect(invoice?.amountPaidCents).toBe(1000);
    expect(invoice?.balanceCents).toBe(0);
    expect(invoice?.status).toBe("PAID");
    expect(invoicePaymentSnapshot(invoice!).invoiceStatus).toBe("PAID");
  });

  it("confirms an existing PROCESSING payment by PaymentIntent id when metadata is missing", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        invoiceNumber: `INV-NOMETA-${Date.now()}`,
        status: "SENT",
        subtotalCents: 1000,
        taxCents: 0,
        totalCents: 1000,
        balanceCents: 1000,
      },
    });
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: invoice.id,
        customerId: ids.customerA,
        amountCents: 1000,
        method: "CREDIT_CARD",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_nometa",
        stripeAccountId: ids.acctA,
      },
    });
    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_nometa_${Date.now()}`,
        type: "payment_intent.succeeded",
        paymentIntentId: "pi_nometa",
        amount: 1000,
        account: ids.acctA,
      })
    );
    const updated = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(updated?.status).toBe("PAID");
    expect(updated?.amountPaidCents).toBe(1000);
  });

  it("A. partial card payment leaves PARTIALLY_PAID", async () => {
    const result = await confirmStripeIntentPayment(prisma, {
      providerPaymentId: "pi_partial_300",
      amountCents: 30000,
      metadata: { companyId: ids.companyA, invoiceId: ids.invoicePartial },
      stripeAccountId: ids.acctA,
    });
    expect(result.ok).toBe(true);
    const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoicePartial } });
    expect(invoice?.amountPaidCents).toBe(30000);
    expect(invoice?.balanceCents).toBe(70000);
    expect(invoice?.status).toBe("PARTIALLY_PAID");
  });

  it("B. two payments complete one invoice without duplicates", async () => {
    await confirmStripeIntentPayment(prisma, {
      providerPaymentId: "pi_two_300",
      amountCents: 30000,
      metadata: { companyId: ids.companyA, invoiceId: ids.invoiceTwo },
      stripeAccountId: ids.acctA,
    });
    await confirmStripeIntentPayment(prisma, {
      providerPaymentId: "pi_two_300",
      amountCents: 30000,
      metadata: { companyId: ids.companyA, invoiceId: ids.invoiceTwo },
      stripeAccountId: ids.acctA,
    });
    await confirmStripeIntentPayment(prisma, {
      providerPaymentId: "pi_two_700",
      amountCents: 70000,
      metadata: { companyId: ids.companyA, invoiceId: ids.invoiceTwo },
      stripeAccountId: ids.acctA,
    });
    const payments = await prisma.payment.findMany({
      where: { invoiceId: ids.invoiceTwo, provider: "STRIPE" },
    });
    expect(payments).toHaveLength(2);
    const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceTwo } });
    expect(invoice?.amountPaidCents).toBe(100000);
    expect(invoice?.balanceCents).toBe(0);
    expect(invoice?.status).toBe("PAID");
  });

  it("C. failed card payment does not collect", async () => {
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: ids.invoiceFail,
        customerId: ids.customerA,
        amountCents: 2500,
        method: "CREDIT_CARD",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_fail_card",
        stripeAccountId: ids.acctA,
      },
    });
    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_fail_${Date.now()}`,
        type: "payment_intent.payment_failed",
        paymentIntentId: "pi_fail_card",
        amount: 2500,
        companyId: ids.companyA,
        invoiceId: ids.invoiceFail,
        account: ids.acctA,
      })
    );
    const payment = await prisma.payment.findFirst({
      where: { providerPaymentId: "pi_fail_card" },
    });
    expect(payment?.status).toBe("FAILED");
    await reconcileInvoiceFromPayments(prisma, ids.invoiceFail, ids.companyA);
    const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceFail } });
    expect(invoice?.amountPaidCents).toBe(0);
    expect(invoice?.balanceCents).toBe(2500);
    expect(invoice?.status).not.toBe("PAID");
    expect(collectedAmountCents({ status: "FAILED", amountCents: 2500 })).toBe(0);
  });

  it("D. ACH processing then success", async () => {
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: ids.invoiceAchOk,
        customerId: ids.customerA,
        amountCents: 4000,
        method: "ACH",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_ach_ok",
        stripeAccountId: ids.acctA,
      },
    });
    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_ach_proc_${Date.now()}`,
        type: "payment_intent.processing",
        paymentIntentId: "pi_ach_ok",
        amount: 4000,
        methodTypes: ["us_bank_account"],
        account: ids.acctA,
      })
    );
    let invoice = await reconcileInvoiceFromPayments(prisma, ids.invoiceAchOk, ids.companyA);
    expect(invoice?.amountPaidCents).toBe(0);
    expect(invoice?.status).not.toBe("PAID");

    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_ach_ok_${Date.now()}`,
        type: "payment_intent.succeeded",
        paymentIntentId: "pi_ach_ok",
        amount: 4000,
        methodTypes: ["us_bank_account"],
        companyId: ids.companyA,
        invoiceId: ids.invoiceAchOk,
        account: ids.acctA,
      })
    );
    invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceAchOk } });
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.amountPaidCents).toBe(4000);
    const payment = await prisma.payment.findFirst({ where: { providerPaymentId: "pi_ach_ok" } });
    expect(payment?.status).toBe("SUCCEEDED");
    expect(payment?.method).toBe("ACH");
  });

  it("E. ACH processing then failure leaves balance due", async () => {
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: ids.invoiceAchFail,
        customerId: ids.customerA,
        amountCents: 4000,
        method: "ACH",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_ach_fail",
        stripeAccountId: ids.acctA,
      },
    });
    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_ach_fail_${Date.now()}`,
        type: "payment_intent.payment_failed",
        paymentIntentId: "pi_ach_fail",
        amount: 4000,
        methodTypes: ["us_bank_account"],
        account: ids.acctA,
      })
    );
    const payment = await prisma.payment.findFirst({ where: { providerPaymentId: "pi_ach_fail" } });
    expect(payment?.status).toBe("FAILED");
    const invoice = await reconcileInvoiceFromPayments(prisma, ids.invoiceAchFail, ids.companyA);
    expect(invoice?.amountPaidCents).toBe(0);
    expect(invoice?.balanceCents).toBe(4000);
  });

  it("G. invalid webhook signature is rejected", () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_sync";
    expect(constructStripeEvent("{}", null).status).toBe(401);
    expect(constructStripeEvent("{}", "t=1,v1=not-valid").status).toBe(401);
    if (previous) process.env.STRIPE_WEBHOOK_SECRET = previous;
    else delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it("H. Company A connected-account event cannot update Company B invoice", async () => {
    const invoiceB = await prisma.invoice.create({
      data: {
        companyId: ids.companyB,
        customerId: ids.customerB,
        invoiceNumber: `INV-B-ISO-${Date.now()}`,
        status: "SENT",
        subtotalCents: 1000,
        taxCents: 0,
        totalCents: 1000,
        balanceCents: 1000,
      },
    });
    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_spoof_b_${Date.now()}`,
        type: "payment_intent.succeeded",
        paymentIntentId: "pi_spoof_b",
        amount: 1000,
        companyId: ids.companyA,
        invoiceId: invoiceB.id,
        account: ids.acctA,
      })
    );
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoiceB.id } });
    expect(payments).toHaveLength(0);
    const mapped = await invoiceForStripeIntent(prisma, {
      providerPaymentId: "pi_spoof_b",
      metadataCompanyId: ids.companyA,
      metadataInvoiceId: invoiceB.id,
      stripeAccountId: ids.acctA,
    });
    expect(mapped).toBeNull();
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceB.id } });
    expect(invoice?.amountPaidCents).toBe(0);
    expect(invoice?.status).toBe("SENT");
  });

  it("I. refund reduces collected amount and invoice paid total", async () => {
    await recordConfirmedProviderPayment({
      prisma,
      companyId: ids.companyA,
      invoiceId: ids.invoiceRefund,
      amountCents: 100000,
      provider: "STRIPE",
      providerPaymentId: "pi_refund",
      method: "CREDIT_CARD",
      stripeAccountId: ids.acctA,
    });
    await processStripeEvent(prisma, {
      id: `evt_refund_${Date.now()}`,
      type: "charge.refunded",
      account: ids.acctA,
      data: {
        object: {
          payment_intent: "pi_refund",
          amount_refunded: 20000,
        },
      },
    } as never);
    const payment = await prisma.payment.findFirst({ where: { providerPaymentId: "pi_refund" } });
    expect(payment?.status).toBe("PARTIALLY_REFUNDED");
    expect(payment?.refundedCents).toBe(20000);
    const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceRefund } });
    expect(invoice?.amountPaidCents).toBe(80000);
    expect(invoice?.balanceCents).toBe(20000);
    expect(invoice?.status).toBe("PARTIALLY_PAID");
  });

  it("J. missing invoice metadata and no existing payment is a safe no-op", async () => {
    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_missing_${Date.now()}`,
        type: "payment_intent.succeeded",
        paymentIntentId: "pi_missing_map",
        amount: 1000,
        account: ids.acctA,
      })
    );
    const payments = await prisma.payment.findMany({
      where: { providerPaymentId: "pi_missing_map" },
    });
    expect(payments).toHaveLength(0);
    const invoice = await prisma.invoice.findUnique({ where: { id: ids.invoiceMissing } });
    expect(invoice?.amountPaidCents).toBe(0);
  });

  it("K. unknown Stripe events are ignored", async () => {
    const before = await prisma.invoice.findUnique({ where: { id: ids.invoiceUnknown } });
    await processStripeEvent(prisma, {
      id: `evt_unknown_${Date.now()}`,
      type: "radar.early_fraud_warning.created",
      account: ids.acctA,
      data: { object: { id: "issfr_1" } },
    } as never);
    const after = await prisma.invoice.findUnique({ where: { id: ids.invoiceUnknown } });
    expect(after?.amountPaidCents).toBe(before?.amountPaidCents);
    const payments = await prisma.payment.findMany({ where: { invoiceId: ids.invoiceUnknown } });
    expect(payments).toHaveLength(0);
  });

  it("L. cash and check recorded payments still settle the invoice", async () => {
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: ids.invoiceCash,
        customerId: ids.customerA,
        amountCents: 1500,
        method: "CHECK",
        status: "RECORDED",
        provider: "MANUAL",
      },
    });
    const invoice = await reconcileInvoiceFromPayments(prisma, ids.invoiceCash, ids.companyA);
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.amountPaidCents).toBe(1500);
    expect(invoice?.balanceCents).toBe(0);
  });

  it("M. invoice reload after webhook / Stripe retrieve reflects paid totals", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        invoiceNumber: `INV-RELOAD-${Date.now()}`,
        status: "DRAFT",
        subtotalCents: 1000,
        taxCents: 0,
        totalCents: 1000,
        balanceCents: 1000,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: invoice.id,
        customerId: ids.customerA,
        amountCents: 1000,
        method: "CREDIT_CARD",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_reload",
        stripeAccountId: ids.acctA,
      },
    });
    retrieve.mockResolvedValueOnce({
      id: "pi_reload",
      status: "succeeded",
      amount: 1000,
      amount_received: 1000,
      payment_method_types: ["card"],
      metadata: { companyId: ids.companyA, invoiceId: invoice.id },
    });
    await syncStripePaymentFromProvider(prisma, payment);
    const loaded = await loadAuthoritativeInvoice(prisma, ids.companyA, invoice.id);
    expect(loaded?.status).toBe("PAID");
    expect(loaded?.amountPaidCents).toBe(1000);
    expect(loaded?.balanceCents).toBe(0);
    const snapshot = invoicePaymentSnapshot(loaded!);
    expect(snapshot.invoiceStatus).toBe("PAID");
    expect(snapshot).not.toHaveProperty("paymentStatus");
  });

  it("N. connected-account onboarding helpers are unchanged", () => {
    expect(connectIdempotencyKey(ids.companyA)).toBe(`cy-connect-v2-saas-${ids.companyA}`);
    expect(v2AccountCreateParams({ companyId: ids.companyA, businessName: "865 HVAC" }).dashboard).toBe("full");
    expect(
      deriveOnboardingStatus({
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      })
    ).toBe("CONNECTED");
  });

  it("charge.succeeded does not create a second payment for the same PaymentIntent", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        invoiceNumber: `INV-CH-${Date.now()}`,
        status: "SENT",
        subtotalCents: 1000,
        taxCents: 0,
        totalCents: 1000,
        balanceCents: 1000,
      },
    });
    await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: invoice.id,
        customerId: ids.customerA,
        amountCents: 1000,
        method: "CREDIT_CARD",
        status: "PROCESSING",
        provider: "STRIPE",
        providerPaymentId: "pi_charge_same",
        stripeAccountId: ids.acctA,
      },
    });
    await processStripeEvent(
      prisma,
      piEvent({
        id: `evt_pi_then_ch_${Date.now()}`,
        type: "payment_intent.succeeded",
        paymentIntentId: "pi_charge_same",
        amount: 1000,
        companyId: ids.companyA,
        invoiceId: invoice.id,
        account: ids.acctA,
      })
    );
    await processStripeEvent(prisma, {
      id: `evt_ch_same_${Date.now()}`,
      type: "charge.succeeded",
      account: ids.acctA,
      data: {
        object: {
          id: "ch_same",
          amount: 1000,
          payment_intent: "pi_charge_same",
          metadata: { companyId: ids.companyA, invoiceId: invoice.id },
          payment_method_details: { type: "card" },
        },
      },
    } as never);
    const payments = await prisma.payment.findMany({
      where: { invoiceId: invoice.id, provider: "STRIPE" },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe("SUCCEEDED");
    const updated = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(updated?.amountPaidCents).toBe(1000);
  });
});
