import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { calculateTechnicianCategoryPerformance, refreshTechnicianPerformance } from "@/lib/technician-intelligence/performance";
import { calculateFamiliarity, getTechnicianJobFit } from "@/lib/technician-intelligence/job-fit";
import { writeAudit } from "@/lib/audit";

const prisma = new PrismaClient();

describe("Technician Intelligence persistence and job-fit integration", () => {
  const ids = {
    companyA: "",
    companyB: "",
    owner: "",
    technician: "",
    customer: "",
    property: "",
    category: "",
    skill: "",
    qualification: "",
    profile: "",
    currentJob: "",
    equipment: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const [owner, technician, otherOwner] = await Promise.all([
      prisma.user.create({
        data: { email: `ti-owner-${stamp}@test.local`, passwordHash: "test", firstName: "Owner", lastName: "One" },
      }),
      prisma.user.create({
        data: { email: `ti-tech-${stamp}@test.local`, passwordHash: "test", firstName: "Johnny", lastName: "Smith" },
      }),
      prisma.user.create({
        data: { email: `ti-other-${stamp}@test.local`, passwordHash: "test", firstName: "Owner", lastName: "Two" },
      }),
    ]);
    ids.owner = owner.id;
    ids.technician = technician.id;
    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: {
          businessName: `TI Test A ${stamp}`,
          status: "ACTIVE",
          memberships: {
            create: [
              { userId: owner.id, role: "COMPANY_OWNER", status: "ACTIVE" },
              { userId: technician.id, role: "TECHNICIAN", status: "ACTIVE" },
            ],
          },
        },
      }),
      prisma.company.create({
        data: {
          businessName: `TI Test B ${stamp}`,
          status: "ACTIVE",
          memberships: { create: { userId: otherOwner.id, role: "COMPANY_OWNER", status: "ACTIVE" } },
        },
      }),
    ]);
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const customer = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Sam", lastName: "Customer", status: "ACTIVE" },
    });
    ids.customer = customer.id;
    const property = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        address: "123 Intelligence Way",
        city: "Knoxville",
        state: "TN",
        zip: "37901",
      },
    });
    ids.property = property.id;
    const equipment = await prisma.equipment.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        propertyId: property.id,
        name: "Main Heat Pump",
      },
    });
    ids.equipment = equipment.id;

    const category = await prisma.technicianJobCategory.create({
      data: {
        companyId: companyA.id,
        key: "NO_COOLING",
        name: "No Cooling",
        aliases: ["AC NOT COOLING", "NO COOL"],
      },
    });
    ids.category = category.id;
    const skill = await prisma.technicianSkillDefinition.create({
      data: {
        companyId: companyA.id,
        categoryId: category.id,
        key: "NO_COOLING",
        name: "No Cooling",
      },
    });
    ids.skill = skill.id;
    const qualification = await prisma.technicianQualificationDefinition.create({
      data: { companyId: companyA.id, key: "EPA_UNIVERSAL", name: "EPA Universal" },
    });
    ids.qualification = qualification.id;
    await prisma.technicianJobTypeRequirement.create({
      data: {
        companyId: companyA.id,
        categoryId: category.id,
        qualificationDefinitionId: qualification.id,
        createdById: owner.id,
      },
    });
    const profile = await prisma.technicianIntelligenceProfile.create({
      data: {
        companyId: companyA.id,
        technicianId: technician.id,
        evaluationCompletedAt: new Date(),
        evaluationCompletedById: owner.id,
        skillRatings: {
          create: {
            companyId: companyA.id,
            skillId: skill.id,
            rating: 5,
            updatedById: owner.id,
          },
        },
        preferences: {
          create: {
            companyId: companyA.id,
            categoryId: category.id,
            preference: "PREFERRED",
            changedById: owner.id,
          },
        },
      },
    });
    ids.profile = profile.id;

    const jobs = await Promise.all(
      [
        { number: "TI-1", status: "COMPLETED" as const, type: "AC Not Cooling", start: -120, end: -30 },
        { number: "TI-2", status: "COMPLETED" as const, type: "No Cool", start: -100, end: -20 },
        { number: "TI-3", status: "CANCELED" as const, type: "No Cooling", start: -60, end: -10 },
        { number: "TI-NOW", status: "SCHEDULED" as const, type: "No Cooling", start: 60, end: 120 },
      ].map((data) =>
        prisma.job.create({
          data: {
            companyId: companyA.id,
            customerId: customer.id,
            propertyId: property.id,
            jobNumber: `${data.number}-${stamp}`,
            jobType: data.type,
            status: data.status,
            scheduledStart: new Date(Date.now() + data.start * 60_000),
            scheduledEnd: new Date(Date.now() + data.end * 60_000),
            checkedInAt: data.status === "COMPLETED" ? new Date(Date.now() + data.start * 60_000) : null,
            checkedOutAt: data.status === "COMPLETED" ? new Date(Date.now() + data.end * 60_000) : null,
            completedAt: data.status === "COMPLETED" ? new Date() : null,
            assignments: { create: { userId: technician.id } },
          },
        })
      )
    );
    ids.currentJob = jobs[3].id;
    await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        propertyId: property.id,
        jobId: jobs[0].id,
        invoiceNumber: `TI-INV-${stamp}`,
        status: "PAID",
        subtotalCents: 50_000,
        totalCents: 50_000,
        amountPaidCents: 50_000,
        balanceCents: 0,
      },
    });
    await prisma.estimate.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        propertyId: property.id,
        jobId: jobs[0].id,
        estimateNumber: `TI-EST-${stamp}`,
        status: "APPROVED",
        totalCents: 50_000,
        createdById: technician.id,
      },
    });
    await prisma.technicianJobRelationship.create({
      data: {
        companyId: companyA.id,
        originalJobId: jobs[0].id,
        relatedJobId: jobs[1].id,
        type: "CALLBACK",
        reason: "Confirmed return for unresolved original scope",
        createdById: owner.id,
      },
    });
    await prisma.jobPhoto.createMany({
      data: [
        {
          companyId: companyA.id,
          jobId: jobs[0].id,
          equipmentId: equipment.id,
          fileName: "prior.jpg",
          filePath: "/test/prior.jpg",
          mimeType: "image/jpeg",
        },
        {
          companyId: companyA.id,
          jobId: jobs[3].id,
          equipmentId: equipment.id,
          fileName: "current.jpg",
          filePath: "/test/current.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });
  });

  afterAll(async () => {
    const users = [ids.owner, ids.technician];
    const otherMembership = await prisma.membership.findFirst({ where: { companyId: ids.companyB } });
    if (otherMembership) users.push(otherMembership.userId);
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("persists owner skill ratings and preferences separately from performance", async () => {
    const profile = await prisma.technicianIntelligenceProfile.findUniqueOrThrow({
      where: { id: ids.profile },
      include: { skillRatings: true, preferences: true, performance: true },
    });
    expect(profile.skillRatings[0].rating).toBe(5);
    expect(profile.preferences[0].preference).toBe("PREFERRED");
    expect(profile.performance).toEqual([]);
  });

  it("uses only real completed jobs and excludes canceled jobs", async () => {
    const metric = await calculateTechnicianCategoryPerformance({
      companyId: ids.companyA,
      technicianId: ids.technician,
      categoryId: ids.category,
      window: "ALL_TIME",
    });
    expect(metric.completedJobs).toBe(2);
    expect(metric.recognizedRevenueCents).toBe(50_000);
    expect(metric.averageTicketCents).toBe(50_000);
    expect(metric.confidence).toBe("INSUFFICIENT");
  });

  it("separates performance by canonical call type aliases", async () => {
    const metric = await calculateTechnicianCategoryPerformance({
      companyId: ids.companyA,
      technicianId: ids.technician,
      categoryId: ids.category,
      window: "ALL_TIME",
    });
    expect(metric.completedJobs).toBe(2);
    expect(metric.callbackCount).toBe(1);
    expect(metric.firstTimeCompletionRate).toBe(50);
  });

  it("calculates durations from check-in and check-out only", async () => {
    const metric = await calculateTechnicianCategoryPerformance({
      companyId: ids.companyA,
      technicianId: ids.technician,
      categoryId: ids.category,
      window: "ALL_TIME",
    });
    expect(metric.validDurationCount).toBe(2);
    expect(metric.averageDurationMinutes).toBeGreaterThan(0);
  });

  it("refreshes cached aggregates for Dispatch without render-time scans", async () => {
    await refreshTechnicianPerformance({
      companyId: ids.companyA,
      technicianId: ids.technician,
      windows: ["ALL_TIME"],
    });
    const aggregate = await prisma.technicianPerformanceAggregate.findUnique({
      where: {
        profileId_categoryId_window: {
          profileId: ids.profile,
          categoryId: ids.category,
          window: "ALL_TIME",
        },
      },
    });
    expect(aggregate?.completedJobs).toBe(2);
    expect(aggregate?.callbackCount).toBe(1);
  });

  it("blocks the technician when a required qualification is missing despite strong history", async () => {
    const fit = await getTechnicianJobFit({
      companyId: ids.companyA,
      technicianId: ids.technician,
      jobId: ids.currentJob,
    });
    expect(fit.eligible).toBe(false);
    expect(fit.ownerEvaluation.skillRating).toBe(5);
    expect(fit.reasons.some((reason) => reason.code === "MISSING_REQUIRED_QUALIFICATION")).toBe(true);
  });

  it("recognizes active qualifications and preserves preference as a soft reason", async () => {
    await prisma.technicianQualification.create({
      data: {
        companyId: ids.companyA,
        profileId: ids.profile,
        definitionId: ids.qualification,
        status: "ACTIVE",
        createdById: ids.owner,
      },
    });
    const fit = await getTechnicianJobFit({
      companyId: ids.companyA,
      technicianId: ids.technician,
      jobId: ids.currentJob,
    });
    expect(fit.eligible).toBe(true);
    expect(fit.reasons.map((reason) => reason.code)).toContain("PREFERRED_CALL_TYPE");
  });

  it("calculates customer, property, and equipment familiarity from completed assigned jobs", async () => {
    const familiarity = await calculateFamiliarity({
      companyId: ids.companyA,
      technicianId: ids.technician,
      currentJobId: ids.currentJob,
      customerId: ids.customer,
      propertyId: ids.property,
      equipmentIds: [ids.equipment],
    });
    expect(familiarity.customerVisits).toBe(2);
    expect(familiarity.propertyVisits).toBe(2);
    expect(familiarity.equipmentVisits).toBe(1);
  });

  it("enforces tenant isolation in job-fit loading", async () => {
    await expect(
      getTechnicianJobFit({
        companyId: ids.companyB,
        technicianId: ids.technician,
        jobId: ids.currentJob,
      })
    ).rejects.toThrow("Job not found");
  });

  it("records manual intelligence changes in the shared audit trail", async () => {
    await writeAudit({
      companyId: ids.companyA,
      actorId: ids.owner,
      action: "technician_intelligence.skill_rating_updated",
      entityType: "TechnicianSkillRating",
      entityId: ids.skill,
      metadata: { technicianId: ids.technician, before: 4, after: 5 },
    });
    const audit = await prisma.auditLog.findFirst({
      where: {
        companyId: ids.companyA,
        action: "technician_intelligence.skill_rating_updated",
      },
    });
    expect(audit?.actorId).toBe(ids.owner);
  });
});
