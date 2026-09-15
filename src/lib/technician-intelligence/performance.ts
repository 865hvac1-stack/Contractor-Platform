import { startOfDay, startOfYear, subDays } from "date-fns";
import { prisma } from "@/lib/db";
import {
  averageOrNull,
  confidenceForSampleSize,
  normalizeJobLabel,
  safeRate,
  type DataConfidence,
} from "@/lib/technician-intelligence/core";

export type IntelligenceWindow = "LAST_30_DAYS" | "LAST_90_DAYS" | "THIS_YEAR" | "ALL_TIME";

export const PERFORMANCE_DEFINITIONS = {
  completedJobs: "Completed, non-canceled jobs with an explicit technician assignment.",
  recognizedRevenue:
    "Total non-draft, non-void invoice value linked to eligible completed jobs. Imported accounting history without a technician assignment is excluded.",
  callbackRate:
    "Explicit CALLBACK relationships divided by eligible completed original jobs. Similar dates or text labels are never guessed as callbacks.",
  firstTimeCompletion:
    "Eligible completed original jobs with no explicit CALLBACK relationship divided by eligible completed original jobs.",
  estimateConversion:
    "Approved estimates divided by estimates in a presented/final state linked to eligible completed jobs.",
  averageDuration:
    "Average checked-in to checked-out duration. Missing, non-positive, or durations over 24 hours are excluded.",
} as const;

export function windowRange(window: IntelligenceWindow, now = new Date()) {
  if (window === "LAST_30_DAYS") return { start: startOfDay(subDays(now, 30)), end: now };
  if (window === "LAST_90_DAYS") return { start: startOfDay(subDays(now, 90)), end: now };
  if (window === "THIS_YEAR") return { start: startOfYear(now), end: now };
  return { start: null, end: now };
}

export async function resolveJobCategory(input: {
  companyId: string;
  serviceTypeId?: string | null;
  serviceTypeKey?: string | null;
  serviceTypeName?: string | null;
  jobType?: string | null;
}) {
  if (input.serviceTypeId) {
    const mapped = await prisma.technicianJobCategoryMapping.findFirst({
      where: { companyId: input.companyId, serviceTypeId: input.serviceTypeId },
      include: { category: true },
    });
    if (mapped) return mapped.category;
  }

  const categories = await prisma.technicianJobCategory.findMany({
    where: { companyId: input.companyId, active: true },
    orderBy: { sortOrder: "asc" },
  });
  const labels = [input.serviceTypeKey, input.serviceTypeName, input.jobType]
    .map(normalizeJobLabel)
    .filter(Boolean);
  return (
    categories.find((category) => {
      const values = [category.key, category.name, ...category.aliases].map(normalizeJobLabel);
      return labels.some((label) => values.includes(label));
    }) ??
    categories.find((category) => category.key === "OTHER") ??
    null
  );
}

export async function calculateTechnicianCategoryPerformance(input: {
  companyId: string;
  technicianId: string;
  categoryId: string;
  window: IntelligenceWindow;
  now?: Date;
}) {
  const category = await prisma.technicianJobCategory.findFirst({
    where: { id: input.categoryId, companyId: input.companyId },
    include: { mappings: true },
  });
  if (!category) throw new Error("Job category not found");

  const range = windowRange(input.window, input.now);
  const normalizedLabels = [category.key, category.name, ...category.aliases].map(normalizeJobLabel);
  const mappingServiceTypeIds = category.mappings.map((mapping) => mapping.serviceTypeId).filter(Boolean) as string[];

  const jobs = await prisma.job.findMany({
    where: {
      companyId: input.companyId,
      status: "COMPLETED",
      completedAt: {
        ...(range.start ? { gte: range.start } : {}),
        lte: range.end,
      },
      assignments: { some: { userId: input.technicianId } },
    },
    include: {
      serviceType: { select: { key: true, name: true } },
      invoices: {
        where: { status: { notIn: ["DRAFT", "VOID"] } },
        select: { totalCents: true },
      },
      estimates: { select: { status: true } },
      technicianJobRelationshipsOriginal: {
        where: { type: "CALLBACK" },
        select: { id: true },
      },
    },
  });

  const eligible = jobs.filter((job) => {
    if (job.serviceTypeId && mappingServiceTypeIds.includes(job.serviceTypeId)) return true;
    const labels = [job.serviceType?.key, job.serviceType?.name, job.jobType].map(normalizeJobLabel);
    return labels.some((label) => label && normalizedLabels.includes(label));
  });
  const completedJobs = eligible.length;
  const callbackCount = eligible.filter((job) => job.technicianJobRelationshipsOriginal.length > 0).length;
  const recognizedRevenueCents = eligible.reduce(
    (sum, job) => sum + job.invoices.reduce((invoiceSum, invoice) => invoiceSum + invoice.totalCents, 0),
    0
  );
  const invoiceCount = eligible.reduce((sum, job) => sum + job.invoices.length, 0);
  const validDurations = eligible
    .filter((job) => job.checkedInAt && job.checkedOutAt)
    .map((job) => Math.round((job.checkedOutAt!.getTime() - job.checkedInAt!.getTime()) / 60_000))
    .filter((minutes) => minutes > 0 && minutes <= 24 * 60);
  const estimates = eligible.flatMap((job) => job.estimates);
  const presented = estimates.filter((estimate) =>
    ["SENT", "VIEWED", "APPROVED", "DECLINED", "EXPIRED"].includes(estimate.status)
  );
  const approved = presented.filter((estimate) => estimate.status === "APPROVED");
  const confidence = confidenceForSampleSize(completedJobs);

  return {
    completedJobs,
    recognizedRevenueCents,
    invoiceCount,
    averageTicketCents: averageOrNull(recognizedRevenueCents, invoiceCount),
    callbackCount,
    callbackRate: safeRate(callbackCount, completedJobs),
    firstTimeCompletionCount: completedJobs - callbackCount,
    firstTimeCompletionRate: safeRate(completedJobs - callbackCount, completedJobs),
    validDurationCount: validDurations.length,
    totalDurationMinutes: validDurations.reduce((sum, minutes) => sum + minutes, 0),
    averageDurationMinutes: averageOrNull(
      validDurations.reduce((sum, minutes) => sum + minutes, 0),
      validDurations.length
    ),
    estimatePresentedCount: presented.length,
    estimateApprovedCount: approved.length,
    estimateConversionRate: safeRate(approved.length, presented.length),
    confidence,
    window: input.window,
    windowStart: range.start,
    windowEnd: range.end,
  };
}

export async function refreshTechnicianPerformance(input: {
  companyId: string;
  technicianId: string;
  windows?: IntelligenceWindow[];
}) {
  const membership = await prisma.membership.findFirst({
    where: {
      companyId: input.companyId,
      userId: input.technicianId,
      role: { in: ["TECHNICIAN", "INSTALLER", "MANAGER"] },
    },
  });
  if (!membership) throw new Error("Technician not found in company");

  const profile = await prisma.technicianIntelligenceProfile.upsert({
    where: {
      companyId_technicianId: {
        companyId: input.companyId,
        technicianId: input.technicianId,
      },
    },
    update: {},
    create: { companyId: input.companyId, technicianId: input.technicianId },
  });
  const categories = await prisma.technicianJobCategory.findMany({
    where: { companyId: input.companyId, active: true },
    select: { id: true },
  });
  const windows = input.windows ?? ["LAST_30_DAYS", "LAST_90_DAYS", "THIS_YEAR", "ALL_TIME"];

  for (const category of categories) {
    for (const window of windows) {
      const metric = await calculateTechnicianCategoryPerformance({
        ...input,
        categoryId: category.id,
        window,
      });
      await prisma.technicianPerformanceAggregate.upsert({
        where: {
          profileId_categoryId_window: {
            profileId: profile.id,
            categoryId: category.id,
            window,
          },
        },
        update: aggregateData(metric),
        create: {
          companyId: input.companyId,
          profileId: profile.id,
          categoryId: category.id,
          window,
          ...aggregateData(metric),
        },
      });
    }
  }
  return profile;
}

function aggregateData(metric: {
  completedJobs: number;
  recognizedRevenueCents: number;
  invoiceCount: number;
  callbackCount: number;
  firstTimeCompletionCount: number;
  validDurationCount: number;
  totalDurationMinutes: number;
  estimatePresentedCount: number;
  estimateApprovedCount: number;
  confidence: DataConfidence;
  windowStart: Date | null;
  windowEnd: Date;
}) {
  return {
    windowStart: metric.windowStart,
    windowEnd: metric.windowEnd,
    completedJobs: metric.completedJobs,
    recognizedRevenueCents: metric.recognizedRevenueCents,
    invoiceCount: metric.invoiceCount,
    callbackCount: metric.callbackCount,
    firstTimeCompletionCount: metric.firstTimeCompletionCount,
    validDurationCount: metric.validDurationCount,
    totalDurationMinutes: metric.totalDurationMinutes,
    estimatePresentedCount: metric.estimatePresentedCount,
    estimateApprovedCount: metric.estimateApprovedCount,
    confidence: metric.confidence,
    calculatedAt: new Date(),
    sourceThrough: metric.windowEnd,
  };
}
