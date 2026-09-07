import { differenceInCalendarDays } from "date-fns";
import type { AttentionItem } from "@/lib/attention";
import { prisma } from "@/lib/db";
import { customerDisplayName } from "@/lib/actions/eligibility";
import { itemNameFromMetadata, parseWaitingMetadata } from "@/lib/waiting/types";

export async function detectWaitingAttention(companyId: string): Promise<AttentionItem[]> {
  const now = new Date();
  const records = await prisma.waitingRecord.findMany({
    where: { companyId, state: "ACTIVE" },
    include: {
      column: true,
      customer: { select: { firstName: true, lastName: true, businessName: true } },
      job: { select: { jobNumber: true } },
    },
    take: 200,
  });

  const items: AttentionItem[] = [];
  for (const record of records) {
    const meta = parseWaitingMetadata(record.metadata);
    const item = itemNameFromMetadata(meta, record.reason);
    const customerName = customerDisplayName(record.customer);
    const days = differenceInCalendarDays(now, record.enteredAt);
    const href = `/operations/waiting?record=${record.id}`;

    if (record.expectedResolutionAt && record.expectedResolutionAt < now && record.column.kind !== "READY") {
      items.push({
        id: `waiting-overdue-${record.id}`,
        type: "waiting_expected_date_passed",
        title: `${customerName} — ${item}`,
        description: `Expected ${record.expectedResolutionAt.toLocaleDateString()} · still ${record.column.name}`,
        severity: "critical",
        href,
        entityType: "WaitingRecord",
        entityId: record.id,
        createdAt: record.expectedResolutionAt,
        customerName,
        recommendedAction: "Check status and update the customer.",
        category: "operations",
      });
    }

    if (!record.expectedResolutionAt && record.column.key === "WAITING_ON_PART") {
      items.push({
        id: `waiting-no-date-${record.id}`,
        type: "waiting_missing_expected_date",
        title: `${customerName} — no expected date`,
        description: `${record.job.jobNumber} · ${item}`,
        severity: "warning",
        href,
        entityType: "WaitingRecord",
        entityId: record.id,
        createdAt: record.enteredAt,
        customerName,
        recommendedAction: "Enter an expected arrival date when you have one.",
        category: "operations",
      });
    }

    if (days >= record.column.urgentDays && record.column.kind !== "READY") {
      items.push({
        id: `waiting-too-long-${record.id}`,
        type: "waiting_too_long",
        title: `${customerName} — waiting ${days} days`,
        description: record.column.name,
        severity: "critical",
        href,
        entityType: "WaitingRecord",
        entityId: record.id,
        createdAt: record.enteredAt,
        customerName,
        recommendedAction: "Escalate this wait or move the job forward.",
        category: "operations",
      });
    }

    if (record.lastCommunicationStatus === "FAILED") {
      items.push({
        id: `waiting-send-failed-${record.id}`,
        type: "waiting_update_failed",
        title: `Customer update failed · ${customerName}`,
        description: record.lastCommunicationError || "The provider did not send the waiting update.",
        severity: "critical",
        href,
        entityType: "WaitingRecord",
        entityId: record.id,
        createdAt: record.updatedAt,
        customerName,
        recommendedAction: "Fix communications and send the update.",
        category: "operations",
      });
    }

    if (record.column.kind === "READY" || record.column.key === "READY_TO_SCHEDULE") {
      items.push({
        id: `waiting-ready-${record.id}`,
        type: "waiting_ready_to_schedule",
        title: `Ready to schedule · ${customerName}`,
        description: `${record.job.jobNumber}${item ? ` · ${item}` : ""}`,
        severity: "warning",
        href: `/jobs/${record.jobId}`,
        entityType: "Job",
        entityId: record.jobId,
        createdAt: record.actualArrivalAt ?? record.updatedAt,
        customerName,
        recommendedAction: "Schedule the customer.",
        category: "operations",
      });
    }

    if (record.customerRepliedAt) {
      items.push({
        id: `waiting-replied-${record.id}`,
        type: "waiting_customer_replied",
        title: `Customer replied · ${customerName}`,
        description: `${record.job.jobNumber} is still ${record.column.name}`,
        severity: "warning",
        href,
        entityType: "WaitingRecord",
        entityId: record.id,
        createdAt: record.customerRepliedAt,
        customerName,
        recommendedAction: "Read the reply. Do not assume the wait is over.",
        category: "customers",
      });
    }

    if (!record.assignedOwnerUserId) {
      items.push({
        id: `waiting-no-owner-${record.id}`,
        type: "waiting_missing_owner",
        title: `No owner · ${customerName}`,
        description: record.column.name,
        severity: "info",
        href,
        entityType: "WaitingRecord",
        entityId: record.id,
        createdAt: record.enteredAt,
        customerName,
        recommendedAction: "Assign an office owner.",
        category: "operations",
      });
    }

    if (record.column.key === "WAITING_ON_WARRANTY" && record.expectedResolutionAt && record.expectedResolutionAt < now) {
      items.push({
        id: `waiting-warranty-overdue-${record.id}`,
        type: "waiting_warranty_overdue",
        title: `Warranty response overdue · ${customerName}`,
        description: meta.warranty?.claimNumber || record.job.jobNumber,
        severity: "warning",
        href,
        entityType: "WaitingRecord",
        entityId: record.id,
        createdAt: record.expectedResolutionAt,
        customerName,
        recommendedAction: "Check the warranty claim.",
        category: "operations",
      });
    }
  }

  return items;
}
