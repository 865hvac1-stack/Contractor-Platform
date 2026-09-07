import type { JobStatus, WaitingRecordState } from "@prisma/client";
import { isSmsOptedOut, smsRecipient } from "@/lib/actions/eligibility";
import { isReadyColumn } from "@/lib/waiting/types";

export type WaitingSafetyInput = {
  jobStatus: JobStatus | string;
  recordState: WaitingRecordState | string;
  communicationEnabled: boolean;
  automationEnabled: boolean;
  companyAutomaticUpdatesEnabled: boolean;
  customer: { tags?: string[]; preferredContactMethod?: string | null; phone?: string | null; secondaryPhone?: string | null };
  kind: string;
  manual?: boolean;
};

export function waitingSendBlockReason(input: WaitingSafetyInput): string | null {
  if (input.jobStatus === "COMPLETED" || input.jobStatus === "CANCELED") {
    return "Job is completed or canceled.";
  }
  if (input.recordState === "RESOLVED") {
    return "Waiting record is resolved.";
  }
  if (!input.communicationEnabled) {
    return "Customer updates are turned off for this waiting record.";
  }
  if (!input.manual && !input.automationEnabled) {
    return "Waiting automation is turned off for this record.";
  }
  if (!input.manual && !input.companyAutomaticUpdatesEnabled) {
    return "Company automatic customer updates are turned off.";
  }
  if (isSmsOptedOut(input.customer)) {
    return "Customer opted out of text messages.";
  }
  if (!smsRecipient(input.customer)) {
    return "Customer has no phone number on file.";
  }
  return null;
}

export function shouldStopWaitingAutomation(input: {
  jobStatus: JobStatus | string;
  recordState: WaitingRecordState | string;
  columnKind?: string;
  columnKey?: string | null;
}): boolean {
  if (input.jobStatus === "COMPLETED" || input.jobStatus === "CANCELED") return true;
  if (input.recordState === "RESOLVED") return true;
  if (input.columnKind && isReadyColumn(input.columnKind, input.columnKey)) return true;
  return false;
}

export function nextJobStatusForWaiting(input: {
  current: JobStatus | string;
  ready: boolean;
}): JobStatus | null {
  if (input.current === "COMPLETED" || input.current === "CANCELED") return null;
  if (input.ready) {
    if (input.current === "ON_HOLD" || input.current === "NEW") return "UNSCHEDULED";
    return null;
  }
  if (["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"].includes(String(input.current))) {
    return "ON_HOLD";
  }
  return null;
}

export function canTechnicianMutateWaiting(assignedToUser: boolean) {
  return assignedToUser;
}
