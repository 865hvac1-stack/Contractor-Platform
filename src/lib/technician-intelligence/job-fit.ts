import { prisma } from "@/lib/db";
import {
  evaluateJobFit,
  qualificationState,
  safeRate,
} from "@/lib/technician-intelligence/core";
import { resolveJobCategory } from "@/lib/technician-intelligence/performance";

export async function getTechnicianJobFit(input: {
  companyId: string;
  technicianId: string;
  jobId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const [job, membership, profile] = await Promise.all([
    prisma.job.findFirst({
      where: { id: input.jobId, companyId: input.companyId },
      include: {
        serviceType: { select: { id: true, key: true, name: true } },
        photos: { where: { equipmentId: { not: null }, deletedAt: null }, select: { equipmentId: true } },
      },
    }),
    prisma.membership.findFirst({
      where: { companyId: input.companyId, userId: input.technicianId },
    }),
    prisma.technicianIntelligenceProfile.findUnique({
      where: {
        companyId_technicianId: {
          companyId: input.companyId,
          technicianId: input.technicianId,
        },
      },
      include: {
        skillRatings: { include: { skill: true } },
        qualifications: { include: { definition: true } },
        preferences: true,
        performance: { where: { window: "ALL_TIME" } },
        overrides: { where: { active: true } },
      },
    }),
  ]);
  if (!job) throw new Error("Job not found");
  if (!membership) throw new Error("Technician not found in company");

  const category = await resolveJobCategory({
    companyId: input.companyId,
    serviceTypeId: job.serviceTypeId,
    serviceTypeKey: job.serviceType?.key,
    serviceTypeName: job.serviceType?.name,
    jobType: job.jobType,
  });
  const [requirements, familiarity, actualServiceEligibility] = await Promise.all([
    category
      ? prisma.technicianJobTypeRequirement.findMany({
          where: { companyId: input.companyId, categoryId: category.id },
          include: { qualification: true },
        })
      : Promise.resolve([]),
    calculateFamiliarity({
      companyId: input.companyId,
      technicianId: input.technicianId,
      currentJobId: job.id,
      customerId: job.customerId,
      propertyId: job.propertyId,
      equipmentIds: job.photos.map((photo) => photo.equipmentId).filter(Boolean) as string[],
    }),
    job.serviceTypeId
      ? prisma.technicianServiceEligibility.findFirst({
          where: {
            companyId: input.companyId,
            userId: input.technicianId,
            serviceTypeId: job.serviceTypeId,
          },
        })
      : Promise.resolve(null),
  ]);

  const requiredQualifications = requirements.map((requirement) => {
    const held = profile?.qualifications.find(
      (qualification) => qualification.definitionId === requirement.qualificationDefinitionId
    );
    return {
      id: requirement.qualificationDefinitionId,
      name: requirement.qualification.name,
      state: qualificationState(held, now),
    };
  });
  const ownerSkillRating =
    profile?.skillRatings
      .filter((rating) => rating.skill.categoryId === category?.id)
      .sort((a, b) => b.rating - a.rating)[0]?.rating ?? null;
  const performance = profile?.performance.find((metric) => metric.categoryId === category?.id);
  const preference = profile?.preferences.find((item) => item.categoryId === category?.id);
  const override = profile?.overrides.find(
    (item) => item.kind === "DO_NOT_RECOMMEND" && (!item.categoryId || item.categoryId === category?.id)
  );

  const result = evaluateJobFit({
    technicianActive: membership.status === "ACTIVE" && actualServiceEligibility?.eligible !== false,
    smartDispatchEligible: profile?.smartDispatchEligible ?? true,
    requiredQualifications,
    ownerSkillRating,
    preference: preference?.preference ?? null,
    completedJobs: performance?.completedJobs ?? 0,
    confidence: (performance?.confidence as "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH") ?? "INSUFFICIENT",
    firstTimeCompletionRate: performance
      ? safeRate(performance.firstTimeCompletionCount, performance.completedJobs)
      : null,
    callbackRate: performance ? safeRate(performance.callbackCount, performance.completedJobs) : null,
    customerVisits: familiarity.customerVisits,
    propertyVisits: familiarity.propertyVisits,
    equipmentVisits: familiarity.equipmentVisits,
    doNotRecommend: Boolean(override),
  });

  return {
    technicianId: input.technicianId,
    jobId: job.id,
    category: category ? { id: category.id, key: category.key, name: category.name } : null,
    ...result,
    qualificationStatus: requiredQualifications,
    ownerEvaluation: { skillRating: ownerSkillRating },
    historicalPerformance: performance
      ? {
          completedJobs: performance.completedJobs,
          confidence: performance.confidence,
          averageTicketCents: performance.invoiceCount
            ? Math.round(performance.recognizedRevenueCents / performance.invoiceCount)
            : null,
          firstTimeCompletionRate: safeRate(
            performance.firstTimeCompletionCount,
            performance.completedJobs
          ),
          callbackRate: safeRate(performance.callbackCount, performance.completedJobs),
        }
      : {
          completedJobs: 0,
          confidence: "INSUFFICIENT",
          averageTicketCents: null,
          firstTimeCompletionRate: null,
          callbackRate: null,
        },
    familiarity,
    preferences: {
      value: preference?.preference ?? null,
      reason: preference?.reason ?? null,
    },
    futureDimensions: {
      location: null,
      driveTime: null,
      scheduleImpact: null,
      workload: null,
      overtimeRisk: null,
      partsReadiness: null,
    },
  };
}

export async function isTechnicianEligibleForJob(input: {
  companyId: string;
  technicianId: string;
  jobId: string;
  now?: Date;
}) {
  const fit = await getTechnicianJobFit(input);
  return {
    eligible: fit.eligible,
    reasons: fit.reasons.filter((reason) => reason.kind === "BLOCKER"),
  };
}

export async function getEligibleTechniciansForJob(input: {
  companyId: string;
  jobId: string;
}) {
  const memberships = await prisma.membership.findMany({
    where: {
      companyId: input.companyId,
      status: "ACTIVE",
      role: { in: ["TECHNICIAN", "INSTALLER", "MANAGER"] },
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const fits = await Promise.all(
    memberships.map(async (membership) => ({
      technician: membership.user,
      fit: await getTechnicianJobFit({
        companyId: input.companyId,
        technicianId: membership.userId,
        jobId: input.jobId,
      }),
    }))
  );
  return fits.filter((item) => item.fit.eligible);
}

export async function calculateFamiliarity(input: {
  companyId: string;
  technicianId: string;
  currentJobId?: string;
  customerId: string;
  propertyId: string;
  equipmentIds?: string[];
}) {
  const base = {
    companyId: input.companyId,
    id: input.currentJobId ? { not: input.currentJobId } : undefined,
    status: "COMPLETED" as const,
    assignments: { some: { userId: input.technicianId } },
  };
  const [customerJobs, propertyJobs, equipmentJobs] = await Promise.all([
    prisma.job.findMany({
      where: { ...base, customerId: input.customerId },
      select: { id: true, completedAt: true },
      orderBy: { completedAt: "desc" },
    }),
    prisma.job.findMany({
      where: { ...base, propertyId: input.propertyId },
      select: { id: true, completedAt: true },
      orderBy: { completedAt: "desc" },
    }),
    input.equipmentIds?.length
      ? prisma.job.findMany({
          where: {
            ...base,
            photos: {
              some: { equipmentId: { in: input.equipmentIds }, deletedAt: null },
            },
          },
          select: { id: true, completedAt: true },
          orderBy: { completedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);
  return {
    customerVisits: customerJobs.length,
    propertyVisits: propertyJobs.length,
    equipmentVisits: equipmentJobs.length,
    mostRecentCustomerVisit: customerJobs[0]?.completedAt ?? null,
    mostRecentPropertyVisit: propertyJobs[0]?.completedAt ?? null,
    mostRecentEquipmentVisit: equipmentJobs[0]?.completedAt ?? null,
  };
}
