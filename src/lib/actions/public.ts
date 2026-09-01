import type { AIActionRequest, AIActionTarget } from "@prisma/client";
import { DEMO_BLOCKED_MESSAGE } from "@/lib/demo/constants";
import type { PublicActionRequest } from "@/lib/actions/types";

export function toPublicActionRequest(
  request: AIActionRequest & { targets: AIActionTarget[] },
  options?: { isDemo?: boolean }
): PublicActionRequest {
  const pending = request.targets.filter((target) => target.status === "PENDING" || target.status === "EXCLUDED");
  return {
    id: request.id,
    actionKey: request.actionKey,
    title: request.title,
    summary: request.summary,
    status: request.status,
    level: request.level,
    riskLevel: request.riskLevel,
    draftLabel: request.level === "EXECUTE" && request.status === "AWAITING_APPROVAL" ? "DRAFT — NOTHING HAS BEEN SENT" : null,
    targetCount: pending.filter((target) => target.status === "PENDING").length || request.targetCount,
    executedCount: request.executedCount,
    skippedCount: request.skippedCount,
    failedCount: request.failedCount,
    estimatedImpactCents: request.estimatedImpactCents,
    criteria: (request.criteria as Record<string, unknown> | null) ?? null,
    provider: request.provider,
    executionMode: request.executionMode,
    expiresAt: request.expiresAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    failureReason: request.failureReason,
    demoBlocked: Boolean(options?.isDemo) && request.status !== "AWAITING_APPROVAL" && request.status !== "DRAFT",
    targets: request.targets.map((target) => ({
      id: target.id,
      recordType: target.recordType,
      customerName: target.customerName,
      amountCents: target.amountCents,
      daysValue: target.daysValue,
      recipient: target.recipient,
      draftMessage: target.draftMessage,
      reason: target.reason,
      status: target.status,
      skipReason: target.skipReason,
      failureReason: target.failureReason,
    })),
  };
}

export function demoExecutionNote(isDemo: boolean) {
  return isDemo ? DEMO_BLOCKED_MESSAGE : null;
}

export function sanitizeForModel(data: unknown): unknown {
  if (Array.isArray(data)) return data.slice(0, 40).map(sanitizeForModel);
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("pit") ||
      lower.includes("apikey") ||
      lower.includes("api_key") ||
      lower.includes("credential")
    ) {
      continue;
    }
    out[key] = sanitizeForModel(value);
  }
  return out;
}
