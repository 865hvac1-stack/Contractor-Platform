import type { CompanyRole, Prisma } from "@prisma/client";
import type { Permission } from "@/lib/permissions";

export const ACTION_REGISTRY_VERSION = 1;

export type ActionLevel = "READ" | "PREPARE" | "EXECUTE";
export type ActionRisk = "LOW" | "MEDIUM" | "HIGH";
export type ActionSource = "planner" | "model" | "ui" | "attention";

export type RecordKind = "CUSTOMER" | "JOB" | "ESTIMATE" | "INVOICE" | "MEMBERSHIP" | "SOCIAL" | "TASK" | "REVIEW";

export type LastResultSet = {
  kind: RecordKind;
  ids: string[];
  actionRequestId?: string | null;
  criteria?: Record<string, unknown>;
  updatedAt: string;
};

export type ActionContext = {
  companyId: string;
  userId: string;
  role: CompanyRole;
  conversationId?: string | null;
  source: ActionSource;
  companyName: string;
  isDemo: boolean;
};

export type ActionTargetDraft = {
  recordType: RecordKind;
  recordId: string;
  customerId?: string | null;
  customerName?: string | null;
  amountCents?: number | null;
  daysValue?: number | null;
  channel?: string | null;
  recipient?: string | null;
  draftMessage?: string | null;
  reason?: string | null;
  payload?: Prisma.InputJsonValue;
};

export type ReadActionResult = {
  kind: "READ";
  title: string;
  summary: string;
  data: unknown;
  recordKind?: RecordKind;
  recordIds?: string[];
  estimatedImpactCents?: number | null;
  criteria?: Record<string, unknown>;
  grounding: { sources: string[] };
};

export type PrepareActionResult = {
  kind: "PREPARE";
  executeActionKey: string;
  title: string;
  summary: string;
  draftLabel: "DRAFT — NOTHING HAS BEEN SENT";
  targets: ActionTargetDraft[];
  estimatedImpactCents?: number | null;
  criteria?: Record<string, unknown>;
  preview: Record<string, unknown>;
  expiresInHours?: number;
  grounding: { sources: string[] };
};

export type TargetExecutionResult = {
  targetId: string;
  status: "EXECUTED" | "SKIPPED" | "FAILED";
  skipReason?: string;
  failureReason?: string;
  provider?: string;
  providerResultId?: string | null;
  simulated?: boolean;
};

export type ExecuteActionResult = {
  kind: "EXECUTE";
  title: string;
  summary: string;
  results: TargetExecutionResult[];
  provider?: string | null;
  executionMode: "live" | "demo";
  grounding: { sources: string[] };
};

export type ActionHandlerResult = ReadActionResult | PrepareActionResult | ExecuteActionResult;

export type ActionDefinition = {
  key: string;
  name: string;
  description: string;
  category: string;
  level: ActionLevel;
  riskLevel: ActionRisk;
  requiredPermission: Permission | Permission[];
  requiresApproval: boolean;
  externalSideEffect: boolean;
  provider: "contractoryou" | "highlevel" | "communication" | "none";
  inputSchema: { parse: (value: unknown) => unknown };
  version: number;
};

export type AskKind =
  | "ANSWER"
  | "INSIGHT"
  | "METRIC"
  | "TREND"
  | "OPPORTUNITY"
  | "LIST"
  | "GOAL_PROGRESS"
  | "RULE_CONFLICT"
  | "DRAFT"
  | "ACTION_REQUIRES_APPROVAL"
  | "ACTION_COMPLETED"
  | "ACTION_FAILED";

export type PublicActionTarget = {
  id: string;
  recordType: string;
  customerName: string | null;
  amountCents: number | null;
  daysValue: number | null;
  recipient: string | null;
  draftMessage: string | null;
  reason: string | null;
  status: string;
  skipReason: string | null;
  failureReason: string | null;
};

export type PublicActionRequest = {
  id: string;
  actionKey: string;
  title: string;
  summary: string;
  status: string;
  level: string;
  riskLevel: string;
  draftLabel: string | null;
  targetCount: number;
  executedCount: number;
  skippedCount: number;
  failedCount: number;
  estimatedImpactCents: number | null;
  criteria: Record<string, unknown> | null;
  provider: string | null;
  executionMode: string | null;
  expiresAt: string;
  createdAt: string;
  failureReason: string | null;
  demoBlocked: boolean;
  targets: PublicActionTarget[];
};
