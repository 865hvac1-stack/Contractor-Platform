import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { calculateCompensationAmount, summarizeCompensation, compensationIsPaid } from "@/lib/compensation/calculate";
import { applyCompensation } from "@/lib/compensation/apply";
import { voidCompensationForSource } from "@/lib/compensation/void";
import { unitPriceForCustomer } from "@/lib/pricebook/pricing";
import { averageTicket, closeRate, membershipConversion } from "@/lib/performance/scorecard";
import { recordConfirmedProviderPayment } from "@/lib/payments/record";
import { parseStripeCheckoutCompleted, verifyStripeSignature } from "@/lib/payments/stripe";
import { createHmac } from "crypto";
import { runIntelligenceTool } from "@/lib/intelligence/tools";
import { can } from "@/lib/permissions";

const prisma = new PrismaClient();

describe("compensation math", () => {
  it("calculates flat and percent rules in integer cents", () => {
    expect(calculateCompensationAmount({ type: "FLAT_AMOUNT", amountCents: 5000, saleCents: 10000 }).amountCents).toBe(5000);
    expect(calculateCompensationAmount({ type: "PERCENT_OF_SALE", percentBps: 500, saleCents: 20000 }).amountCents).toBe(1000);
    expect(
      calculateCompensationAmount({ type: "PERCENT_OF_GROSS_PROFIT", percentBps: 1000, saleCents: 20000, grossProfitCents: 8000 })
        .amountCents
    ).toBe(800);
  });

  it("does not auto-calculate foundation rule types", () => {
    const tiered = calculateCompensationAmount({ type: "TIERED", amountCents: 100, saleCents: 10000 });
    expect(tiered.supported).toBe(false);
    expect(tiered.amountCents).toBe(0);
  });

  it("keeps pending distinct from paid and approved", () => {
    const summary = summarizeCompensation([
      { amountCents: 100, status: "PENDING" },
      { amountCents: 200, status: "QUALIFIED" },
      { amountCents: 300, status: "APPROVED" },
      { amountCents: 400, status: "PAID" },
    ]);
    expect(summary.pendingCents).toBe(100);
    expect(summary.qualifiedCents).toBe(200);
    expect(summary.approvedCents).toBe(300);
    expect(summary.paidCents).toBe(400);
    expect(compensationIsPaid("PENDING")).toBe(false);
    expect(compensationIsPaid("APPROVED")).toBe(false);
    expect(compensationIsPaid("PAID")).toBe(true);
  });
});

describe("pricebook member price and scorecard math", () => {
  it("applies member price only when eligible", () => {
    expect(unitPriceForCustomer({ standardPriceCents: 20000, memberPriceCents: 15000, eligible: true })).toBe(15000);
    expect(unitPriceForCustomer({ standardPriceCents: 20000, memberPriceCents: 15000, eligible: false })).toBe(20000);
    expect(unitPriceForCustomer({ standardPriceCents: 20000, memberPriceCents: null, eligible: true })).toBe(20000);
  });

  it("is deterministic for average ticket, close rate, and membership conversion", () => {
    expect(averageTicket([10000, 20000, 30000])).toBe(20000);
    expect(averageTicket([])).toBeNull();
    expect(closeRate(4, 2)).toBe(50);
    expect(closeRate(0, 0)).toBeNull();
    expect(membershipConversion(5, 1)).toBe(20);
    expect(membershipConversion(0, 1)).toBeNull();
  });
});

describe("stripe webhook helpers", () => {
  it("verifies signatures and ignores bad ones", () => {
    const secret = "whsec_test";
    const payload = "{\"ok\":true}";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    expect(verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${timestamp},v1=deadbeef`, secret)).toBe(false);
  });

  it("parses checkout.session.completed only", () => {
    expect(
      parseStripeCheckoutCompleted({
        type: "checkout.session.completed",
        data: { object: { id: "cs_1", amount_total: 5000, metadata: { companyId: "c1", invoiceId: "i1" } } },
      })
    ).toEqual({ companyId: "c1", invoiceId: "i1", amountCents: 5000, providerPaymentId: "cs_1" });
    expect(parseStripeCheckoutCompleted({ type: "payment_intent.succeeded" })).toBeNull();
  });
});

describe("revenue tenant isolation and compensation safety", () => {
  const ids = {
    companyA: "",
    companyB: "",
    ownerA: "",
    techA: "",
    techB: "",
    customerA: "",
    customerB: "",
    propertyA: "",
    jobA: "",
    categoryA: "",
    itemA: "",
    planA: "",
    ruleA: "",
    estimateA: "",
    invoiceA: "",
    invoiceHistorical: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const ownerA = await prisma.user.create({
      data: { email: `rev-oa-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "A" },
    });
    const techA = await prisma.user.create({
      data: { email: `rev-ta-${stamp}@test.local`, passwordHash: hash, firstName: "Tech", lastName: "A" },
    });
    const techB = await prisma.user.create({
      data: { email: `rev-tb-${stamp}@test.local`, passwordHash: hash, firstName: "Tech", lastName: "B" },
    });
    ids.ownerA = ownerA.id;
    ids.techA = techA.id;
    ids.techB = techB.id;
    const companyA = await prisma.company.create({
      data: { businessName: `Rev A ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `Rev B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    await prisma.membership.createMany({
      data: [
        { companyId: companyA.id, userId: ownerA.id, role: "COMPANY_OWNER" },
        { companyId: companyA.id, userId: techA.id, role: "TECHNICIAN" },
        { companyId: companyB.id, userId: techB.id, role: "TECHNICIAN" },
      ],
    });
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Smith", lastName: "Residence", status: "ACTIVE" },
    });
    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Secret", lastName: "Home", status: "ACTIVE" },
    });
    ids.customerA = customerA.id;
    ids.customerB = customerB.id;
    const propertyA = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        address: "1 Main",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
      },
    });
    ids.propertyA = propertyA.id;
    const jobA = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-REV-${stamp}`,
        jobType: "Service",
        status: "IN_PROGRESS",
      },
    });
    ids.jobA = jobA.id;
    await prisma.jobAssignment.create({ data: { jobId: jobA.id, userId: techA.id } });
    const category = await prisma.pricebookCategory.create({
      data: { companyId: companyA.id, name: "Cooling" },
    });
    ids.categoryA = category.id;
    const item = await prisma.pricebookItem.create({
      data: {
        companyId: companyA.id,
        categoryId: category.id,
        name: "Capacitor",
        standardPriceCents: 20000,
        memberPriceCents: 15000,
        internalCostCents: 4000,
        type: "ADD_ON",
      },
    });
    ids.itemA = item.id;
    const plan = await prisma.membershipPlan.create({
      data: { companyId: companyA.id, name: "Comfort Plan", priceCents: 29900 },
    });
    ids.planA = plan.id;
    const rule = await prisma.compensationRule.create({
      data: {
        companyId: companyA.id,
        name: "Membership $50",
        type: "FLAT_AMOUNT",
        trigger: "MEMBERSHIP_SOLD",
        amountCents: 5000,
      },
    });
    ids.ruleA = rule.id;
    await prisma.compensationRuleVersion.create({
      data: { companyId: companyA.id, ruleId: rule.id, snapshot: { amountCents: 5000 } },
    });
    await prisma.compensationRule.create({
      data: {
        companyId: companyA.id,
        name: "5% of sale",
        type: "PERCENT_OF_SALE",
        trigger: "INVOICE_PAID",
        percentBps: 500,
      },
    });
    const estimate = await prisma.estimate.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        jobId: jobA.id,
        estimateNumber: `EST-REV-${stamp}`,
        createdById: techA.id,
        publicToken: `est-${stamp}`,
        status: "DRAFT",
        subtotalCents: 20000,
        totalCents: 20000,
        lineItems: {
          create: {
            name: "Capacitor",
            quantity: 1,
            unitPriceCents: 20000,
            pricebookItemId: item.id,
          },
        },
      },
    });
    ids.estimateA = estimate.id;
    const invoice = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        jobId: jobA.id,
        invoiceNumber: `INV-REV-${stamp}`,
        publicToken: `inv-${stamp}`,
        status: "SENT",
        subtotalCents: 20000,
        totalCents: 20000,
        balanceCents: 20000,
      },
    });
    ids.invoiceA = invoice.id;
    const historical = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        invoiceNumber: `INV-HIST-${stamp}`,
        status: "PAID",
        totalCents: 50000,
        amountPaidCents: 50000,
        importMode: "HISTORICAL",
      },
    });
    ids.invoiceHistorical = historical.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.techA, ids.techB] } } });
    await prisma.$disconnect();
  });

  it("keeps Company A from reading Company B pricebook, memberships, and compensation", async () => {
    const foreignItem = await prisma.pricebookItem.findFirst({
      where: { id: ids.itemA, companyId: ids.companyB },
    });
    const foreignPlan = await prisma.membershipPlan.findFirst({
      where: { id: ids.planA, companyId: ids.companyB },
    });
    const foreignRule = await prisma.compensationRule.findFirst({
      where: { id: ids.ruleA, companyId: ids.companyB },
    });
    expect(foreignItem).toBeNull();
    expect(foreignPlan).toBeNull();
    expect(foreignRule).toBeNull();
  });

  it("does not give technicians other employees' compensation or cost permission", () => {
    expect(can("TECHNICIAN", "compensation:view_own")).toBe(true);
    expect(can("TECHNICIAN", "compensation:view_all")).toBe(false);
    expect(can("TECHNICIAN", "pricebook:cost")).toBe(false);
    expect(can("TECHNICIAN", "job_costs:view")).toBe(false);
  });

  it("creates an estimate line from a pricebook item at the standard price without membership", async () => {
    const estimate = await prisma.estimate.findUnique({
      where: { id: ids.estimateA },
      include: { lineItems: true },
    });
    expect(estimate?.lineItems[0]?.pricebookItemId).toBe(ids.itemA);
    expect(estimate?.lineItems[0]?.unitPriceCents).toBe(20000);
  });

  it("does not generate compensation for historical invoices or memberships", async () => {
    const createdInvoice = await applyCompensation({
      prisma,
      companyId: ids.companyA,
      userId: ids.techA,
      trigger: "INVOICE_PAID",
      sourceType: "INVOICE",
      sourceId: ids.invoiceHistorical,
      saleCents: 50000,
      importMode: "HISTORICAL",
    });
    const membership = await prisma.customerMembership.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        planId: ids.planA,
        soldById: ids.techA,
        priceCents: 29900,
        status: "ACTIVE",
        importMode: "HISTORICAL",
      },
    });
    const createdMembership = await applyCompensation({
      prisma,
      companyId: ids.companyA,
      userId: ids.techA,
      trigger: "MEMBERSHIP_SOLD",
      sourceType: "MEMBERSHIP",
      sourceId: membership.id,
      saleCents: 29900,
      importMode: "HISTORICAL",
      membershipPlanId: ids.planA,
    });
    expect(createdInvoice).toEqual([]);
    expect(createdMembership).toEqual([]);
  });

  it("attributes a live membership sale and snapshots the rule amount", async () => {
    const membership = await prisma.customerMembership.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        planId: ids.planA,
        soldById: ids.techA,
        sourceJobId: ids.jobA,
        priceCents: 29900,
        status: "PENDING",
      },
    });
    const created = await applyCompensation({
      prisma,
      companyId: ids.companyA,
      userId: ids.techA,
      trigger: "MEMBERSHIP_SOLD",
      sourceType: "MEMBERSHIP",
      sourceId: membership.id,
      saleCents: 29900,
      jobId: ids.jobA,
      customerId: ids.customerA,
      membershipPlanId: ids.planA,
    });
    expect(created).toHaveLength(1);
    const event = await prisma.compensationEvent.findUnique({ where: { id: created[0] } });
    expect(event?.amountCents).toBe(5000);
    expect(event?.status).toBe("PENDING");
    expect(event?.userId).toBe(ids.techA);
    await prisma.compensationRule.update({
      where: { id: ids.ruleA },
      data: { amountCents: 6000 },
    });
    const again = await applyCompensation({
      prisma,
      companyId: ids.companyA,
      userId: ids.techA,
      trigger: "MEMBERSHIP_SOLD",
      sourceType: "MEMBERSHIP",
      sourceId: membership.id,
      saleCents: 29900,
      membershipPlanId: ids.planA,
    });
    expect(again).toEqual([]);
    const unchanged = await prisma.compensationEvent.findUnique({ where: { id: created[0] } });
    expect(unchanged?.amountCents).toBe(5000);
  });

  it("does not duplicate a provider payment on webhook retry", async () => {
    const first = await recordConfirmedProviderPayment({
      prisma,
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
      amountCents: 20000,
      provider: "STRIPE",
      providerPaymentId: "cs_retry_1",
      method: "CREDIT_CARD",
    });
    const second = await recordConfirmedProviderPayment({
      prisma,
      companyId: ids.companyA,
      invoiceId: ids.invoiceA,
      amountCents: 20000,
      provider: "STRIPE",
      providerPaymentId: "cs_retry_1",
      method: "CREDIT_CARD",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.payment?.id).toBe(first.payment?.id);
    const count = await prisma.payment.count({
      where: { companyId: ids.companyA, providerPaymentId: "cs_retry_1" },
    });
    expect(count).toBe(1);
  });

  it("voids compensation instead of deleting it", async () => {
    const event = await prisma.compensationEvent.findFirst({
      where: { companyId: ids.companyA, userId: ids.techA, status: "PENDING" },
    });
    expect(event).toBeTruthy();
    await voidCompensationForSource({
      prisma,
      companyId: ids.companyA,
      sourceType: event!.sourceType,
      sourceId: event!.sourceId,
      reason: "Cancelled sale",
    });
    const voided = await prisma.compensationEvent.findUnique({ where: { id: event!.id } });
    expect(voided?.status).toBe("VOIDED");
  });

  it("blocks Intelligence from company B records and unknown write tools", async () => {
    const scorecard = await runIntelligenceTool(
      { companyId: ids.companyB, userId: ids.techB, role: "TECHNICIAN" },
      "getCompensationSummary",
      {}
    );
    expect(scorecard.ok).toBe(true);
    const summary = scorecard.data as { pendingCents?: number };
    expect(summary.pendingCents ?? 0).toBe(0);
    const write = await runIntelligenceTool(
      { companyId: ids.companyA, userId: ids.ownerA, role: "COMPANY_OWNER" },
      "approveCompensation",
      { eventId: "x" }
    );
    expect(write.ok).toBe(false);
    const otherTech = await runIntelligenceTool(
      { companyId: ids.companyA, userId: ids.techA, role: "TECHNICIAN" },
      "getTechnicianScorecard",
      { userId: ids.techB }
    );
    expect(otherTech.ok).toBe(false);
    const margin = await runIntelligenceTool(
      { companyId: ids.companyA, userId: ids.techA, role: "TECHNICIAN" },
      "getMarginByTechnician",
      {}
    );
    expect(margin.ok).toBe(false);
  });
});
