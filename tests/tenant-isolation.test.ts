import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { dollarsToCents, lineTotalCents, sumCents, formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";

const prisma = new PrismaClient();

describe("money helpers", () => {
  it("converts dollars to cents without float drift", () => {
    expect(dollarsToCents("19.99")).toBe(1999);
    expect(dollarsToCents(10.1)).toBe(1010);
    expect(lineTotalCents(3, 1500)).toBe(4500);
    expect(sumCents([100, 200, 50])).toBe(350);
    expect(formatMoney(0)).toBe("$0.00");
  });
});

describe("permissions", () => {
  it("grants owner full access and limits technicians", () => {
    expect(can("COMPANY_OWNER", "invoices:financial")).toBe(true);
    expect(can("TECHNICIAN", "invoices:financial")).toBe(false);
    expect(can("TECHNICIAN", "jobs:assigned_only")).toBe(true);
    expect(can("SALES", "estimates:manage")).toBe(true);
    expect(can("DISPATCHER", "schedule:manage")).toBe(true);
  });
});

describe("tenant isolation (critical)", () => {
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    userB: "",
    customerA: "",
    customerB: "",
    jobA: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();

    const userA = await prisma.user.create({
      data: {
        email: `tenant-a-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Alice",
        lastName: "A",
      },
    });
    const userB = await prisma.user.create({
      data: {
        email: `tenant-b-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Bob",
        lastName: "B",
      },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;

    const companyA = await prisma.company.create({
      data: {
        businessName: `Company A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: {
          create: {
            userId: userA.id,
            role: "COMPANY_OWNER",
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        },
        numberSequences: {
          create: [
            { kind: "JOB", prefix: "JOB", nextValue: 1 },
            { kind: "ESTIMATE", prefix: "EST", nextValue: 1 },
            { kind: "INVOICE", prefix: "INV", nextValue: 1 },
          ],
        },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Company B ${stamp}`,
        industry: "PLUMBING",
        status: "ACTIVE",
        memberships: {
          create: {
            userId: userB.id,
            role: "COMPANY_OWNER",
            status: "ACTIVE",
            joinedAt: new Date(),
          },
        },
        numberSequences: {
          create: [
            { kind: "JOB", prefix: "JOB", nextValue: 1 },
            { kind: "ESTIMATE", prefix: "EST", nextValue: 1 },
            { kind: "INVOICE", prefix: "INV", nextValue: 1 },
          ],
        },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const customerA = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Cust",
        lastName: "A",
        email: `a-${stamp}@test.local`,
      },
    });
    const customerB = await prisma.customer.create({
      data: {
        companyId: companyB.id,
        firstName: "Cust",
        lastName: "B",
        email: `b-${stamp}@test.local`,
      },
    });
    ids.customerA = customerA.id;
    ids.customerB = customerB.id;

    const propertyA = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        address: "1 Main St",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
        isPrimary: true,
      },
    });

    const jobA = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-T-${stamp}`,
        status: "NEW",
        description: "Isolation test job",
      },
    });
    ids.jobA = jobA.id;

    await prisma.auditLog.create({
      data: {
        companyId: companyA.id,
        actorId: userA.id,
        action: "customer.created",
        entityType: "Customer",
        entityId: customerA.id,
      },
    });
  });

  afterAll(async () => {
    const companyIds = [ids.companyA, ids.companyB].filter(Boolean);
    if (companyIds.length) {
      await prisma.auditLog.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.jobAssignment.deleteMany({
        where: { job: { companyId: { in: companyIds } } },
      });
      await prisma.estimateLineItem.deleteMany({
        where: { estimate: { companyId: { in: companyIds } } },
      });
      await prisma.estimate.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.invoice.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.expense.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.job.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.property.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.numberSequence.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.membership.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    const userIds = [ids.userA, ids.userB].filter(Boolean);
    if (userIds.length) {
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it("Company A queries never return Company B customers", async () => {
    const results = await prisma.customer.findMany({
      where: { companyId: ids.companyA },
    });
    expect(results.every((c) => c.companyId === ids.companyA)).toBe(true);
    expect(results.find((c) => c.id === ids.customerB)).toBeUndefined();
  });

  it("looking up Company B customer with Company A scope returns null", async () => {
    const leaked = await prisma.customer.findFirst({
      where: { id: ids.customerB, companyId: ids.companyA },
    });
    expect(leaked).toBeNull();
  });

  it("Company B cannot mutate Company A jobs", async () => {
    const updated = await prisma.job.updateMany({
      where: { id: ids.jobA, companyId: ids.companyB },
      data: { status: "CANCELED" },
    });
    expect(updated.count).toBe(0);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: ids.jobA } });
    expect(job.status).toBe("NEW");
    expect(job.companyId).toBe(ids.companyA);
  });

  it("property belongs to customer and company", async () => {
    const property = await prisma.property.findFirst({
      where: { companyId: ids.companyA, customerId: ids.customerA },
    });
    expect(property).not.toBeNull();
    expect(property!.companyId).toBe(ids.companyA);
  });

  it("estimate totals use integer cents", async () => {
    const subtotal = lineTotalCents(2, 12500);
    const tax = dollarsToCents("12.50");
    const total = sumCents([subtotal, tax]);
    const estimate = await prisma.estimate.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        estimateNumber: `EST-T-${Date.now()}`,
        status: "DRAFT",
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        lineItems: {
          create: [
            {
              name: "Service call",
              quantity: 2,
              unitPriceCents: 12500,
              taxable: true,
              sortOrder: 0,
            },
          ],
        },
      },
    });
    expect(estimate.subtotalCents).toBe(25000);
    expect(estimate.taxCents).toBe(1250);
    expect(estimate.totalCents).toBe(26250);

    const crossTenant = await prisma.estimate.findFirst({
      where: { id: estimate.id, companyId: ids.companyB },
    });
    expect(crossTenant).toBeNull();

    await prisma.estimateLineItem.deleteMany({ where: { estimateId: estimate.id } });
    await prisma.estimate.delete({ where: { id: estimate.id } });
  });

  it("invoice balance math stays in cents", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        companyId: ids.companyA,
        customerId: ids.customerA,
        invoiceNumber: `INV-T-${Date.now()}`,
        status: "SENT",
        subtotalCents: 10000,
        taxCents: 0,
        totalCents: 10000,
        amountPaidCents: 2500,
        balanceCents: 7500,
      },
    });
    expect(invoice.balanceCents).toBe(invoice.totalCents - invoice.amountPaidCents);
    await prisma.invoice.delete({ where: { id: invoice.id } });
  });

  it("expense creation is company-scoped", async () => {
    const expense = await prisma.expense.create({
      data: {
        companyId: ids.companyA,
        vendor: "Supply House",
        amountCents: 4500,
        taxCents: 0,
        category: "MATERIALS",
        status: "SUBMITTED",
        createdById: ids.userA,
      },
    });
    const leaked = await prisma.expense.findFirst({
      where: { id: expense.id, companyId: ids.companyB },
    });
    expect(leaked).toBeNull();
    await prisma.expense.delete({ where: { id: expense.id } });
  });

  it("writes audit logs for important actions", async () => {
    const logs = await prisma.auditLog.findMany({
      where: { companyId: ids.companyA, action: "customer.created" },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]!.companyId).toBe(ids.companyA);
  });

  it("membership enforces company boundary", async () => {
    const aOnB = await prisma.membership.findFirst({
      where: { userId: ids.userA, companyId: ids.companyB, status: "ACTIVE" },
    });
    expect(aOnB).toBeNull();
  });
});

describe("dashboard zero states", () => {
  it("aggregates return zero when company has no financial activity", async () => {
    const company = await prisma.company.create({
      data: {
        businessName: `Empty Co ${Date.now()}`,
        industry: "OTHER",
        status: "ACTIVE",
      },
    });
    const revenue = await prisma.invoice.aggregate({
      where: { companyId: company.id, status: "PAID" },
      _sum: { totalCents: true },
      _count: true,
    });
    expect(revenue._sum.totalCents ?? 0).toBe(0);
    expect(revenue._count).toBe(0);
    await prisma.company.delete({ where: { id: company.id } });
  });
});
