import { endOfDay, startOfDay, startOfWeek } from "date-fns";
import type { Prisma, PrismaClient } from "@prisma/client";
import { operationalRecordWhere } from "@/lib/imports/modes";

export async function loadJobOperationsSummary(
  prisma: PrismaClient,
  input: { companyId: string; access: Prisma.JobWhereInput; now?: Date }
) {
  const now = input.now ?? new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const weekStart = startOfWeek(now);
  const base = {
    companyId: input.companyId,
    ...input.access,
    ...operationalRecordWhere(),
  } satisfies Prisma.JobWhereInput;
  const active = ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD"] as const;
  const [today, scheduled, inProgress, waiting, estimatesPending, completedThisWeek, needsAttention, runningLate, paymentsDue, unassigned, neededParts] =
    await Promise.all([
      prisma.job.count({ where: { ...base, scheduledStart: { gte: dayStart, lte: dayEnd } } }),
      prisma.job.count({ where: { ...base, status: { in: ["SCHEDULED", "DISPATCHED"] } } }),
      prisma.job.count({ where: { ...base, status: "IN_PROGRESS" } }),
      prisma.job.count({
        where: {
          ...base,
          OR: [{ status: "ON_HOLD" }, { waitingRecords: { some: { state: "ACTIVE" } } }],
        },
      }),
      prisma.job.count({
        where: {
          ...base,
          estimates: { some: { status: { in: ["SENT", "VIEWED"] } } },
        },
      }),
      prisma.job.count({
        where: { ...base, status: "COMPLETED", completedAt: { gte: weekStart, lte: now } },
      }),
      prisma.job.count({
        where: {
          ...base,
          status: { in: [...active] },
          OR: [
            { status: "ON_HOLD" },
            { confirmationFailed: true },
            { assignments: { none: {} } },
            { waitingRecords: { some: { state: "ACTIVE" } } },
            { estimates: { some: { status: { in: ["SENT", "VIEWED"] } } } },
            { invoices: { some: { balanceCents: { gt: 0 }, status: { in: ["OVERDUE", "SENT", "PARTIALLY_PAID"] } } } },
            { jobParts: { some: { status: "NEEDED" } } },
            { status: { in: ["SCHEDULED", "DISPATCHED"] }, scheduledStart: { lt: now } },
          ],
        },
      }),
      prisma.job.count({
        where: {
          ...base,
          status: { in: ["SCHEDULED", "DISPATCHED"] },
          scheduledStart: { lt: now },
        },
      }),
      prisma.job.count({
        where: {
          ...base,
          status: { in: [...active] },
          invoices: { some: { balanceCents: { gt: 0 }, status: { in: ["OVERDUE", "SENT", "PARTIALLY_PAID"] } } },
        },
      }),
      prisma.job.count({
        where: {
          ...base,
          status: { in: [...active] },
          assignments: { none: {} },
        },
      }),
      prisma.jobPart.findMany({
        where: {
          companyId: input.companyId,
          status: "NEEDED",
          job: { ...base, status: { in: [...active] } },
        },
        select: {
          jobId: true,
          quantity: true,
          part: { select: { inventoryStocks: { select: { onHand: true, reserved: true } } } },
        },
      }),
    ]);
  const missingParts = new Set(
    neededParts
      .filter(
        (row) =>
          row.part.inventoryStocks.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0) < row.quantity
      )
      .map((row) => row.jobId)
  ).size;
  const partsRequired = new Set(neededParts.map((row) => row.jobId)).size;
  return {
    today,
    scheduled,
    inProgress,
    waiting,
    estimatesPending,
    completedThisWeek,
    needsAttention,
    intelligence: {
      estimatesPending,
      runningLate,
      missingParts,
      partsRequired,
      paymentsDue,
      unassigned,
    },
  };
}

export type JobOperationalAlert =
  | "Technician Unassigned"
  | "Customer Waiting"
  | "Appointment Conflict"
  | "Estimate Awaiting Approval"
  | "Payment Due"
  | "Missing Invoice"
  | "Part Needed"
  | "Late";

export function deriveJobOperationalAlerts(job: {
  status: string;
  confirmationFailed?: boolean;
  assignments: unknown[];
  waitingRecords?: Array<{ state: string }>;
  estimates?: Array<{ status: string }>;
  invoices?: Array<{ status: string; balanceCents: number }>;
  scheduledStart?: Date | null;
  jobParts?: Array<{ status: string; quantity?: number; part?: { inventoryStocks: Array<{ onHand: number; reserved: number }> } }>;
}): JobOperationalAlert[] {
  const alerts: JobOperationalAlert[] = [];
  if (!job.assignments.length && !["COMPLETED", "CANCELED"].includes(job.status)) alerts.push("Technician Unassigned");
  if (job.status === "ON_HOLD" || job.waitingRecords?.some((row) => row.state === "ACTIVE")) alerts.push("Customer Waiting");
  if (job.confirmationFailed) alerts.push("Appointment Conflict");
  if (job.estimates?.some((row) => ["SENT", "VIEWED"].includes(row.status))) alerts.push("Estimate Awaiting Approval");
  if (job.invoices?.some((row) => row.balanceCents > 0 && ["OVERDUE", "SENT", "PARTIALLY_PAID"].includes(row.status))) {
    alerts.push("Payment Due");
  }
  if (job.status === "COMPLETED" && !job.invoices?.length) alerts.push("Missing Invoice");
  if (
    ["SCHEDULED", "DISPATCHED"].includes(job.status) &&
    job.scheduledStart &&
    job.scheduledStart.getTime() < Date.now()
  ) {
    alerts.push("Late");
  }
  if (
    job.jobParts?.some(
      (row) =>
        row.status === "NEEDED" &&
        (!row.part ||
          row.part.inventoryStocks.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0) <
            (row.quantity ?? 1))
    )
  ) {
    alerts.push("Part Needed");
  }
  return alerts;
}
