import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadProject360 } from "@/lib/projects/load";

const prisma = new PrismaClient();

describe("Projects tenant isolation and costing", () => {
  const ids = { companyA: "", companyB: "", userA: "", userB: "", project: "", phase: "", customer: "", property: "" };

  beforeAll(async () => {
    const stamp = Date.now();
    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { email: `project-a-${stamp}@test.local`, passwordHash: "test", firstName: "Project", lastName: "Owner A" } }),
      prisma.user.create({ data: { email: `project-b-${stamp}@test.local`, passwordHash: "test", firstName: "Project", lastName: "Owner B" } }),
    ]);
    ids.userA = userA.id; ids.userB = userB.id;
    const [companyA, companyB] = await Promise.all([
      prisma.company.create({ data: { businessName: `Project Test A ${stamp}`, status: "ACTIVE", memberships: { create: { userId: userA.id, role: "COMPANY_OWNER", status: "ACTIVE", internalJobCostRateCents: 4200 } } } }),
      prisma.company.create({ data: { businessName: `Project Test B ${stamp}`, status: "ACTIVE", memberships: { create: { userId: userB.id, role: "COMPANY_OWNER", status: "ACTIVE" } } } }),
    ]);
    ids.companyA = companyA.id; ids.companyB = companyB.id;
    const customer = await prisma.customer.create({ data: { companyId: companyA.id, firstName: "Sarah", lastName: "Smith", status: "ACTIVE" } });
    ids.customer = customer.id;
    const property = await prisma.property.create({ data: { companyId: companyA.id, customerId: customer.id, address: "123 Project Way", city: "Knoxville", state: "TN", zip: "37901" } });
    ids.property = property.id;
    const project = await prisma.project.create({
      data: {
        companyId: companyA.id, customerId: customer.id, propertyId: property.id, projectNumber: `PRJ-${stamp}`,
        name: "Smith Residence", type: "NEW_CONSTRUCTION", status: "IN_PROGRESS", originalContractCents: 1_875_000,
        laborBudgetMinutes: 4800, createdById: userA.id,
        phases: { create: { companyId: companyA.id, name: "Rough-In", sortOrder: 0, status: "IN_PROGRESS", laborBudgetMinutes: 2880 } },
        changeOrders: { create: { companyId: companyA.id, number: "CO-001", title: "Added scope", revenueChangeCents: 125_000, estimatedCostChangeCents: 50_000, status: "APPROVED", createdById: userA.id, approvedById: userA.id, approvedAt: new Date() } },
        costs: { create: { companyId: companyA.id, description: "Equipment", category: "EQUIPMENT", amountCents: 350_000, status: "ACTUAL", sourceType: "MANUAL", idempotencyKey: `project-test:${stamp}`, createdById: userA.id } },
      },
      include: { phases: true },
    });
    ids.project = project.id; ids.phase = project.phases[0].id;
    await prisma.projectLaborEntry.create({
      data: {
        companyId: companyA.id, projectId: project.id, phaseId: ids.phase, employeeId: userA.id,
        workDate: new Date(), startedAt: new Date(Date.now() - 8 * 60 * 60_000), endedAt: new Date(),
        totalMinutes: 480, internalCostRateCents: 4200, internalLaborCostCents: 33_600,
        source: "MANUAL", createdById: userA.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB] } } });
    await prisma.$disconnect();
  });

  it("loads persisted financials for the owning tenant", async () => {
    const view = await loadProject360({ companyId: ids.companyA, projectId: ids.project, role: "COMPANY_OWNER", userId: ids.userA });
    expect(view?.financials.currentValueCents).toBe(2_000_000);
    expect(view?.financials.costToDateCents).toBe(383_600);
    expect(view?.actualLaborMinutes).toBe(480);
    expect(view?.project.laborEntries[0].internalCostRateCents).toBe(4200);
  });

  it("does not allow another tenant to load the project", async () => {
    const view = await loadProject360({ companyId: ids.companyB, projectId: ids.project, role: "COMPANY_OWNER", userId: ids.userB });
    expect(view).toBeNull();
  });

  it("prevents two active project clocks for one employee", async () => {
    const data = {
      companyId: ids.companyA, projectId: ids.project, phaseId: ids.phase, employeeId: ids.userA,
      workDate: new Date(), startedAt: new Date(), internalCostRateCents: 4200, source: "TECH_CLOCK", createdById: ids.userA,
    };
    const first = await prisma.projectLaborEntry.create({ data });
    await expect(prisma.projectLaborEntry.create({ data })).rejects.toMatchObject({ code: "P2002" });
    await prisma.projectLaborEntry.delete({ where: { id: first.id } });
  });
});
