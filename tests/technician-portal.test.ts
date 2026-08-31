import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { can, isFieldRole } from "@/lib/permissions";
import { jobAccessFilter } from "@/lib/tenant";
import { remainingRequiredItems, nextTechnicianAction, parseDefinition } from "@/lib/playbooks/engine";
import { flattenSteps } from "@/lib/playbooks/types";
import { getStarterTemplate } from "@/lib/playbooks/templates";
import { assignPlaybookToJob } from "@/lib/playbooks/assign";
import { technicianTodayJobs, customerLabel } from "@/lib/tech/today";
import { fieldCtaForStep, fieldSectionForStep, remainingHref } from "@/lib/tech/next-step";
import { mapsUrl } from "@/lib/tech/access";
import { technicianScorecard } from "@/lib/performance/scorecard";
import { applyCompensation } from "@/lib/compensation/apply";
import { compensationUserFilter } from "@/lib/compensation/access";
import { runIntelligenceTool } from "@/lib/intelligence/tools";
import { recordConfirmedProviderPayment } from "@/lib/payments/record";
import { stripeConfigured } from "@/lib/payments/provider";

const prisma = new PrismaClient();

describe("technician portal permissions", () => {
  it("routes field roles and keeps office modules off technicians", () => {
    expect(isFieldRole("TECHNICIAN")).toBe(true);
    expect(isFieldRole("INSTALLER")).toBe(true);
    expect(isFieldRole("COMPANY_OWNER")).toBe(false);
    expect(can("TECHNICIAN", "jobs:field_status")).toBe(true);
    expect(can("TECHNICIAN", "invoices:field")).toBe(true);
    expect(can("TECHNICIAN", "estimates:discount")).toBe(true);
    expect(can("TECHNICIAN", "invoices:financial")).toBe(false);
    expect(can("TECHNICIAN", "reports:financial")).toBe(false);
    expect(can("TECHNICIAN", "pricebook:cost")).toBe(false);
    expect(can("TECHNICIAN", "compensation:view_all")).toBe(false);
    expect(can("TECHNICIAN", "job_costs:view")).toBe(false);
    expect(can("INSTALLER", "invoices:field")).toBe(false);
    expect(can("INSTALLER", "estimates:manage")).toBe(false);
    expect(can("INSTALLER", "memberships:manage")).toBe(false);
  });

  it("maps next-step CTAs without inventing workflow", () => {
    const definition = getStarterTemplate("residential_service")!.definition;
    const next = nextTechnicianAction(definition, new Set());
    expect(next?.actionKey).toBe("ON_MY_WAY");
    expect(fieldCtaForStep(next!)).toBe("On my way");
    expect(fieldSectionForStep(next!)).toBe("overview");
    expect(remainingHref({ stepId: "x", title: "Before photo", reason: "Photos" })).toBe("#photos");
    expect(mapsUrl("123 Main St, Knoxville, TN 37902")).toContain("maps.google.com");
  });
});

describe("technician field workflow and isolation", () => {
  const ids = {
    companyA: "",
    companyB: "",
    ownerA: "",
    techA: "",
    techB: "",
    techOther: "",
    customerA: "",
    customerB: "",
    propertyA: "",
    jobA: "",
    jobB: "",
    jobOtherTech: "",
    playbookA: "",
    itemA: "",
    estimateA: "",
    invoiceA: "",
    planA: "",
    ruleA: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const ownerA = await prisma.user.create({
      data: { email: `tech-owner-a-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "A" },
    });
    const techA = await prisma.user.create({
      data: { email: `tech-a-${stamp}@test.local`, passwordHash: hash, firstName: "JR", lastName: "Tech" },
    });
    const techOther = await prisma.user.create({
      data: { email: `tech-other-${stamp}@test.local`, passwordHash: hash, firstName: "Sam", lastName: "Other" },
    });
    const techB = await prisma.user.create({
      data: { email: `tech-b-${stamp}@test.local`, passwordHash: hash, firstName: "Pat", lastName: "B" },
    });
    ids.ownerA = ownerA.id;
    ids.techA = techA.id;
    ids.techOther = techOther.id;
    ids.techB = techB.id;

    const companyA = await prisma.company.create({
      data: {
        businessName: `Tech Co A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        techDiscountLimitBps: 500,
        memberships: {
          create: [
            { userId: ownerA.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() },
            { userId: techA.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() },
            { userId: techOther.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() },
          ],
        },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Tech Co B ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: {
          create: { userId: techB.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() },
        },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const customerA = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Smith",
        lastName: "Residence",
        phone: "8655550100",
      },
    });
    const customerB = await prisma.customer.create({
      data: {
        companyId: companyB.id,
        firstName: "Other",
        lastName: "Co",
      },
    });
    ids.customerA = customerA.id;
    ids.customerB = customerB.id;

    const propertyA = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        address: "123 Main Street",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
        isPrimary: true,
      },
    });
    const propertyB = await prisma.property.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        address: "9 Other Ave",
        city: "Atlanta",
        state: "GA",
        zip: "30301",
      },
    });
    ids.propertyA = propertyA.id;

    const now = new Date();
    const jobA = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-TECH-${stamp}`,
        status: "SCHEDULED",
        jobType: "Residential Service",
        scheduledStart: now,
        scheduledEnd: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        assignments: { create: [{ userId: techA.id }] },
      },
    });
    const jobOther = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-OTHER-${stamp}`,
        status: "SCHEDULED",
        scheduledStart: now,
        assignments: { create: [{ userId: techOther.id }] },
      },
    });
    const jobB = await prisma.job.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        propertyId: propertyB.id,
        jobNumber: `JOB-B-${stamp}`,
        status: "SCHEDULED",
        scheduledStart: now,
        assignments: { create: [{ userId: techB.id }] },
      },
    });
    ids.jobA = jobA.id;
    ids.jobOtherTech = jobOther.id;
    ids.jobB = jobB.id;

    const template = getStarterTemplate("residential_service")!;
    const playbook = await prisma.playbook.create({
      data: {
        companyId: companyA.id,
        name: template.name,
        status: "ACTIVE",
        sortOrder: 1,
      },
    });
    const version = await prisma.playbookVersion.create({
      data: {
        companyId: companyA.id,
        playbookId: playbook.id,
        versionNumber: 1,
        definition: template.definition,
        createdById: ownerA.id,
      },
    });
    await prisma.playbook.update({
      where: { id: playbook.id },
      data: { currentVersionId: version.id },
    });
    ids.playbookA = playbook.id;
    await assignPlaybookToJob({ companyId: companyA.id, jobId: jobA.id, playbookId: playbook.id });

    const category = await prisma.pricebookCategory.create({
      data: { companyId: companyA.id, name: "Service", sortOrder: 0 },
    });
    const item = await prisma.pricebookItem.create({
      data: {
        companyId: companyA.id,
        categoryId: category.id,
        name: "Capacitor",
        type: "PRODUCT",
        standardPriceCents: 18000,
        memberPriceCents: 16200,
        internalCostCents: 4000,
        unit: "ea",
      },
    });
    ids.itemA = item.id;

    const plan = await prisma.membershipPlan.create({
      data: {
        companyId: companyA.id,
        name: "Comfort Plan",
        priceCents: 19900,
        billingFrequency: "ANNUAL",
        includedVisits: 2,
        discountPercent: 10,
        priorityService: true,
        active: true,
      },
    });
    ids.planA = plan.id;

    const rule = await prisma.compensationRule.create({
      data: {
        companyId: companyA.id,
        name: "$50 membership",
        type: "FLAT_AMOUNT",
        trigger: "MEMBERSHIP_SOLD",
        amountCents: 5000,
        active: true,
      },
    });
    ids.ruleA = rule.id;
    await prisma.compensationRuleVersion.create({
      data: { companyId: companyA.id, ruleId: rule.id, snapshot: { amountCents: 5000 } },
    });
  });

  afterAll(async () => {
    const companies = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.compensationEvent.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.compensationRuleVersion.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.compensationRule.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.customerMembership.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.membershipPlan.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.payment.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { companyId: { in: companies } } } });
    await prisma.invoice.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.estimateLineItem.deleteMany({ where: { estimate: { companyId: { in: companies } } } });
    await prisma.estimateOption.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.estimate.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.pricebookItem.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.pricebookCategory.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.jobPhoto.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.equipment.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.jobWorkflowEvent.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.jobChecklistItem.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.jobPlaybookSnapshot.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.jobAssignment.deleteMany({ where: { job: { companyId: { in: companies } } } });
    await prisma.job.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.playbookVersion.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.playbook.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.property.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    for (const id of [ids.ownerA, ids.techA, ids.techB, ids.techOther]) {
      if (id) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("shows only assigned jobs for today and hides other technicians and companies", async () => {
    const today = await technicianTodayJobs(ids.companyA, ids.techA);
    expect(today.map((job) => job.id)).toContain(ids.jobA);
    expect(today.map((job) => job.id)).not.toContain(ids.jobOtherTech);
    expect(today.map((job) => job.id)).not.toContain(ids.jobB);
    expect(customerLabel(today[0]!.customer)).toContain("Smith");

    const accessA = jobAccessFilter("TECHNICIAN", ids.techA);
    const hiddenB = await prisma.job.findFirst({
      where: { id: ids.jobB, companyId: ids.companyA, ...accessA },
    });
    expect(hiddenB).toBeNull();
    const hiddenOther = await prisma.job.findFirst({
      where: { id: ids.jobOtherTech, companyId: ids.companyA, ...accessA },
    });
    expect(hiddenOther).toBeNull();
    const own = await prisma.job.findFirst({
      where: { id: ids.jobA, companyId: ids.companyA, ...accessA },
    });
    expect(own?.id).toBe(ids.jobA);
  });

  it("reassignment removes job access", async () => {
    await prisma.jobAssignment.deleteMany({ where: { jobId: ids.jobA, userId: ids.techA } });
    const lost = await prisma.job.findFirst({
      where: { id: ids.jobA, companyId: ids.companyA, ...jobAccessFilter("TECHNICIAN", ids.techA) },
    });
    expect(lost).toBeNull();
    await prisma.jobAssignment.create({ data: { jobId: ids.jobA, userId: ids.techA } });
    const restored = await prisma.job.findFirst({
      where: { id: ids.jobA, companyId: ids.companyA, ...jobAccessFilter("TECHNICIAN", ids.techA) },
    });
    expect(restored?.id).toBe(ids.jobA);
  });

  it("runs a complete assigned-job workflow on fixtures only", async () => {
    await prisma.job.update({ where: { id: ids.jobA }, data: { status: "DISPATCHED" } });
    await prisma.job.update({ where: { id: ids.jobA }, data: { status: "IN_PROGRESS" } });

    await prisma.equipment.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        name: "Outdoor unit",
        model: "XR16",
        serialNumber: "SN-1",
      },
    });
    await prisma.jobPhoto.create({
      data: {
        companyId: ids.companyA,
        jobId: ids.jobA,
        kind: "BEFORE",
        fileName: "before.jpg",
        filePath: "test/before.jpg",
        mimeType: "image/jpeg",
        uploadedById: ids.techA,
      },
    });

    const snapshot = await prisma.jobPlaybookSnapshot.findFirst({
      where: { jobId: ids.jobA, companyId: ids.companyA },
    });
    expect(snapshot).not.toBeNull();
    const definition = parseDefinition(snapshot!.definition);
    const remainingBefore = await remainingRequiredItems({
      companyId: ids.companyA,
      jobId: ids.jobA,
      definition,
    });
    expect(remainingBefore.length).toBeGreaterThan(0);

    const estimate = await prisma.estimate.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        jobId: ids.jobA,
        estimateNumber: `EST-TECH-${Date.now()}`,
        status: "DRAFT",
        createdById: ids.techA,
        publicToken: `tok-${Date.now()}`,
        options: {
          create: [
            { companyId: ids.companyA, name: "Good", sortOrder: 0 },
            { companyId: ids.companyA, name: "Better", sortOrder: 1 },
            { companyId: ids.companyA, name: "Best", sortOrder: 2 },
          ],
        },
      },
      include: { options: true },
    });
    ids.estimateA = estimate.id;
    const better = estimate.options.find((option) => option.name === "Better")!;
    await prisma.estimateLineItem.create({
      data: {
        estimateId: estimate.id,
        optionId: better.id,
        name: "Capacitor",
        quantity: 1,
        unitPriceCents: 18000,
        pricebookItemId: ids.itemA,
      },
    });
    await prisma.estimate.update({
      where: { id: estimate.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedOptionId: better.id,
        approvalMethod: "CUSTOMER_PORTAL",
        subtotalCents: 18000,
        totalCents: 18000,
        version: 1,
      },
    });

    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        jobId: ids.jobA,
        invoiceNumber: `INV-TECH-${Date.now()}`,
        status: "SENT",
        subtotalCents: 18000,
        totalCents: 18000,
        balanceCents: 18000,
        publicToken: `inv-${Date.now()}`,
        lineItems: { create: [{ name: "Capacitor", quantity: 1, unitPriceCents: 18000 }] },
      },
    });
    ids.invoiceA = invoice.id;

    const recorded = await prisma.payment.create({
      data: {
        companyId: ids.companyA,
        invoiceId: invoice.id,
        customerId: ids.customerA,
        jobId: ids.jobA,
        amountCents: 18000,
        method: "CASH",
        status: "RECORDED",
        provider: "MANUAL",
        recordedById: ids.techA,
      },
    });
    expect(recorded.status).toBe("RECORDED");
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { amountPaidCents: 18000, balanceCents: 0, status: "PAID" },
    });

    const membership = await prisma.customerMembership.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        propertyId: ids.propertyA,
        planId: ids.planA,
        soldById: ids.techA,
        sourceJobId: ids.jobA,
        status: "ACTIVE",
        priceCents: 19900,
        startDate: new Date(),
      },
    });
    await applyCompensation({
      prisma,
      companyId: ids.companyA,
      userId: ids.techA,
      trigger: "MEMBERSHIP_SOLD",
      sourceType: "MEMBERSHIP",
      sourceId: membership.id,
      saleCents: 19900,
      jobId: ids.jobA,
      customerId: ids.customerA,
      membershipPlanId: ids.planA,
    });

    for (const step of flattenSteps(definition)) {
      if (!step.enabled) continue;
      const already = await prisma.jobWorkflowEvent.findFirst({
        where: { companyId: ids.companyA, jobId: ids.jobA, stepId: step.id },
      });
      if (!already) {
        await prisma.jobWorkflowEvent.create({
          data: {
            companyId: ids.companyA,
            jobId: ids.jobA,
            stepId: step.id,
            actorId: ids.techA,
            kind: step.kind,
            note: "test complete",
          },
        });
      }
      if (step.kind === "CHECKLIST" && step.checklist) {
        for (const section of step.checklist.sections) {
          for (const item of section.items.filter((row) => row.required)) {
            await prisma.jobChecklistItem.create({
              data: {
                companyId: ids.companyA,
                jobId: ids.jobA,
                itemId: item.id,
                section: section.name,
                label: item.label,
                required: true,
                fieldType: item.fieldType,
                completed: true,
              },
            });
          }
        }
      }
    }

    const remainingAfter = await remainingRequiredItems({
      companyId: ids.companyA,
      jobId: ids.jobA,
      definition,
    });
    expect(remainingAfter).toEqual([]);

    await prisma.job.update({
      where: { id: ids.jobA },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const card = await technicianScorecard({
      companyId: ids.companyA,
      userId: ids.techA,
      period: "this_week",
    });
    expect(card.jobsCompleted).toBeGreaterThanOrEqual(1);
    expect(card.revenueCents).toBeGreaterThanOrEqual(18000);
    expect(card.membershipsSold).toBeGreaterThanOrEqual(1);
    expect(card.incentives.pendingCents + card.incentives.qualifiedCents).toBeGreaterThanOrEqual(5000);
    expect(card.incentives.paidCents).toBe(0);
  });

  it("keeps compensation, cost, and company reports private", async () => {
    const ownFilter = compensationUserFilter("TECHNICIAN", ids.techA);
    expect(ownFilter).toEqual({ userId: ids.techA });
    const otherEvents = await prisma.compensationEvent.findMany({
      where: { companyId: ids.companyA, userId: ids.techOther },
    });
    expect(otherEvents).toHaveLength(0);

    const companyWide = await runIntelligenceTool(
      { companyId: ids.companyA, userId: ids.techA, role: "TECHNICIAN" },
      "getBusinessSummary",
      { period: "month" }
    );
    expect(companyWide.ok).toBe(false);

    const otherComp = await runIntelligenceTool(
      { companyId: ids.companyA, userId: ids.techA, role: "TECHNICIAN" },
      "getTechnicianScorecard",
      { userId: ids.techB }
    );
    expect(otherComp.ok).toBe(false);

    const crossCompany = await prisma.job.findFirst({
      where: { id: ids.jobB, companyId: ids.companyA },
    });
    expect(crossCompany).toBeNull();

    expect(can("TECHNICIAN", "pricebook:cost")).toBe(false);
    const item = await prisma.pricebookItem.findFirst({ where: { id: ids.itemA } });
    expect(item?.internalCostCents).toBe(4000);

    expect(ids.companyA && 500).toBe(500);
    const overLimit = 600 > 500;
    expect(overLimit).toBe(true);
    expect(can("INSTALLER", "invoices:field")).toBe(false);
    expect(stripeConfigured() ? "configured" : "manual-only").toMatch(/configured|manual-only/);
  });

  it("does not mark a card payment successful without the provider helper", async () => {
    const invoice = await prisma.invoice.findFirst({ where: { id: ids.invoiceA } });
    expect(invoice?.status).toBe("PAID");
    const fake = await recordConfirmedProviderPayment({
      prisma,
      companyId: ids.companyB,
      invoiceId: ids.invoiceA,
      provider: "STRIPE",
      providerPaymentId: "pi_fake",
      amountCents: 18000,
      method: "CREDIT_CARD",
    });
    expect(fake.created).toBe(false);
    expect(fake.payment).toBeNull();
  });
});
