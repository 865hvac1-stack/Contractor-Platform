import type { JobPriority, WaitingCadence, WaitingRecordState } from "@prisma/client";

export const DEFAULT_COLUMN_KEYS = [
  "WAITING_ON_PART",
  "WAITING_ON_WARRANTY",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_APPROVAL",
  "WAITING_ON_THIRD_PARTY",
  "READY_TO_SCHEDULE",
] as const;

export type DefaultColumnKey = (typeof DEFAULT_COLUMN_KEYS)[number];

export const TEMPLATE_KINDS = ["INITIAL", "RECURRING", "ARRIVED", "READY", "RESOLVED"] as const;
export type WaitingTemplateKind = (typeof TEMPLATE_KINDS)[number];

export const SAFE_TEMPLATE_VARS = [
  "firstName",
  "companyName",
  "itemName",
  "jobNumber",
  "waitingReason",
  "waitingFor",
  "expectedDate",
  "expectedDateSentence",
  "ownerName",
] as const;

export type WaitingColumnKind = "WAITING" | "READY";

export type WaitingPartMeta = {
  name?: string;
  partNumber?: string;
  quantity?: number | string;
  vendor?: string;
  poNumber?: string;
  orderedAt?: string;
  expectedArrivalAt?: string;
  actualArrivalAt?: string;
  costCents?: number;
  notes?: string;
};

export type WaitingWarrantyMeta = {
  manufacturer?: string;
  claimNumber?: string;
  submittedAt?: string;
  expectedResponseAt?: string;
  notes?: string;
};

export type WaitingCustomerMeta = {
  needed?: string;
  lastContactAt?: string;
  nextFollowUpAt?: string;
  deadlineAt?: string;
};

export type WaitingApprovalMeta = {
  estimateId?: string;
  estimateNumber?: string;
  amountCents?: number;
  sentAt?: string;
};

export type WaitingThirdPartyMeta = {
  party?: string;
  contact?: string;
  reference?: string;
  expectedResponseAt?: string;
  notes?: string;
};

export type WaitingMetadata = {
  waitingFor?: string;
  vendor?: string;
  poNumber?: string;
  dateOrdered?: string;
  reminderFrequency?: string;
  part?: WaitingPartMeta;
  warranty?: WaitingWarrantyMeta;
  customerWait?: WaitingCustomerMeta;
  approval?: WaitingApprovalMeta;
  thirdParty?: WaitingThirdPartyMeta;
};

export type WaitingTransitionActions = {
  stopUpdates?: boolean;
  notifyCustomer?: boolean;
  createSchedulingTask?: boolean;
  markPartArrived?: boolean;
};

export type WaitingCard = {
  id: string;
  jobId: string;
  customerId: string;
  propertyId: string | null;
  columnId: string;
  columnKey: string;
  columnName: string;
  columnKind: string;
  state: WaitingRecordState;
  customerName: string;
  jobNumber: string;
  address: string;
  reason: string;
  waitingFor: string | null;
  enteredAt: Date;
  daysWaiting: number;
  technicianName: string | null;
  ownerName: string | null;
  assignedOwnerUserId: string | null;
  lastCustomerUpdateAt: Date | null;
  nextCustomerUpdateAt: Date | null;
  expectedResolutionAt: Date | null;
  priority: JobPriority;
  overdue: boolean;
  warning: boolean;
  urgent: boolean;
  communicationStatus: string | null;
  communicationError: string | null;
  customerReplied: boolean;
  communicationEnabled: boolean;
  automationEnabled: boolean;
  cadence: WaitingCadence;
  metadata: WaitingMetadata;
};

export function isDefaultColumnKey(key: string): key is DefaultColumnKey {
  return (DEFAULT_COLUMN_KEYS as readonly string[]).includes(key);
}

export function isReadyColumn(kind: string, key?: string | null) {
  return kind === "READY" || key === "READY_TO_SCHEDULE";
}

export function parseWaitingMetadata(value: unknown): WaitingMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as WaitingMetadata;
}

export function itemNameFromMetadata(meta: WaitingMetadata, fallback = "part") {
  return (
    meta.part?.name?.trim() ||
    meta.waitingFor?.trim() ||
    meta.warranty?.manufacturer?.trim() ||
    meta.thirdParty?.party?.trim() ||
    fallback
  );
}
