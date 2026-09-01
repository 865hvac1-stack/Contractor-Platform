import { createHash, randomUUID } from "crypto";
import { addHours } from "date-fns";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, canAny } from "@/lib/permissions";
import { assertInvocableAction, requiredPermissionsOf } from "@/lib/actions/registry";
import { handleReadAction } from "@/lib/actions/read";
import { handlePrepareAction } from "@/lib/actions/prepare";
import { loadLastResultSet, resolveRequestedIds, saveLastResultSet } from "@/lib/actions/result-set";
import { sanitizeForModel, toPublicActionRequest } from "@/lib/actions/public";
import type { ActionContext, ActionHandlerResult, AskKind, PublicActionRequest } from "@/lib/actions/types";

export type InvokeResult =
  | {
      ok: true;
      actionKey: string;
      level: "READ" | "PREPARE" | "EXECUTE";
      result: ActionHandlerResult;
      actionRequest?: PublicActionRequest | null;
      kind: AskKind;
    }
  | { ok: false; error: string; actionKey?: string };

export async function invokeRegisteredAction(input: {
  ctx: ActionContext;
  actionKey: string;
  rawInput?: unknown;
  idempotencyKey?: string;
}): Promise<InvokeResult> {
  const allowed = assertInvocableAction(input.actionKey);
  if (!allowed.ok) return { ok: false, error: allowed.error, actionKey: input.actionKey };
  const definition = allowed.definition;
  const perms = requiredPermissionsOf(definition);
  if (perms.length > 1) {
    if (!canAny(input.ctx.role, perms)) {
      return { ok: false, error: "You do not have permission for that action.", actionKey: input.actionKey };
    }
  } else if (!can(input.ctx.role, perms[0])) {
    return { ok: false, error: "You do not have permission for that action.", actionKey: input.actionKey };
  }

  if (definition.level === "EXECUTE") {
    return {
      ok: false,
      error: "That action needs approval. ContractorYou will not execute it from a model request.",
      actionKey: input.actionKey,
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = (definition.inputSchema.parse(input.rawInput ?? {}) as Record<string, unknown>) ?? {};
  } catch {
    return { ok: false, error: "That action received invalid input.", actionKey: input.actionKey };
  }

  const lastResult = await loadLastResultSet(input.ctx.companyId, input.ctx.conversationId);
  const expectedKind =
    definition.key.startsWith("estimate.")
      ? "ESTIMATE"
      : definition.key.startsWith("invoice.")
        ? "INVOICE"
        : definition.key.startsWith("membership.")
          ? "MEMBERSHIP"
          : definition.key.startsWith("job.")
            ? "JOB"
            : definition.key.startsWith("customer.")
              ? "CUSTOMER"
              : undefined;
  const resolved = resolveRequestedIds({
    requestedIds: Array.isArray(parsed.recordIds) ? (parsed.recordIds as string[]) : [],
    lastResult,
    expectedKind,
    source: input.ctx.source,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error, actionKey: input.actionKey };
  if (resolved.ids.length) parsed.recordIds = resolved.ids;

  try {
    if (definition.level === "READ") {
      const result = await handleReadAction(input.ctx, definition.key, parsed);
      if (result.recordKind && result.recordIds) {
        await saveLastResultSet(input.ctx.companyId, input.ctx.conversationId, {
          kind: result.recordKind,
          ids: result.recordIds,
          criteria: result.criteria,
        });
      }
      await writeAudit({
        companyId: input.ctx.companyId,
        actorId: input.ctx.userId,
        action: "AI_ACTION_READ",
        entityType: "AIActionRequest",
        metadata: { actionKey: definition.key, count: result.recordIds?.length ?? 0 },
      });
      return { ok: true, actionKey: definition.key, level: "READ", result, kind: "ANSWER" };
    }

    const prepared = await handlePrepareAction(input.ctx, definition.key, parsed);
    const request = await persistPreparedRequest({
      ctx: input.ctx,
      executeKey: prepared.executeActionKey,
      prepared,
      input: parsed,
      idempotencyKey: input.idempotencyKey,
    });
    await saveLastResultSet(input.ctx.companyId, input.ctx.conversationId, {
      kind: (prepared.targets[0]?.recordType as "ESTIMATE") || "ESTIMATE",
      ids: prepared.targets.map((target) => target.recordId),
      actionRequestId: request.id,
      criteria: prepared.criteria,
    });
    await writeAudit({
      companyId: input.ctx.companyId,
      actorId: input.ctx.userId,
      action: "AI_ACTION_PREPARED",
      entityType: "AIActionRequest",
      entityId: request.id,
      metadata: { actionKey: prepared.executeActionKey, targetCount: prepared.targets.length },
    });
    return {
      ok: true,
      actionKey: definition.key,
      level: "PREPARE",
      result: prepared,
      actionRequest: toPublicActionRequest(request, { isDemo: input.ctx.isDemo }),
      kind: prepared.targets.length ? "ACTION_REQUIRES_APPROVAL" : "ANSWER",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "That action could not run.";
    return { ok: false, error: message, actionKey: input.actionKey };
  }
}

async function persistPreparedRequest(input: {
  ctx: ActionContext;
  executeKey: string;
  prepared: Extract<ActionHandlerResult, { kind: "PREPARE" }>;
  input: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const executeDef = assertInvocableAction(input.executeKey);
  const risk = executeDef.ok ? executeDef.definition.riskLevel : "MEDIUM";
  const fingerprint = createHash("sha256")
    .update(
      [
        input.executeKey,
        input.ctx.userId,
        input.ctx.conversationId ?? "none",
        input.prepared.targets
          .map((target) => target.recordId)
          .sort()
          .join(","),
      ].join("|")
    )
    .digest("hex")
    .slice(0, 40);
  const idempotencyKey = input.idempotencyKey || `prep:${fingerprint}`;
  const existing = await prisma.aIActionRequest.findFirst({
    where: { companyId: input.ctx.companyId, idempotencyKey },
    include: { targets: { orderBy: { createdAt: "asc" } } },
  });
  if (existing && (existing.status === "AWAITING_APPROVAL" || existing.status === "DRAFT")) {
    return existing;
  }
  return prisma.aIActionRequest.create({
    data: {
      companyId: input.ctx.companyId,
      requestedByUserId: input.ctx.userId,
      conversationId: input.ctx.conversationId ?? null,
      actionKey: input.executeKey,
      actionVersion: 1,
      level: "EXECUTE",
      riskLevel: risk,
      status: input.prepared.targets.length ? "AWAITING_APPROVAL" : "CANCELED",
      title: input.prepared.title,
      summary: input.prepared.summary,
      input: input.input as Prisma.InputJsonValue,
      preview: input.prepared.preview as Prisma.InputJsonValue,
      criteria: (input.prepared.criteria ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      estimatedImpactCents: input.prepared.estimatedImpactCents ?? null,
      targetCount: input.prepared.targets.length,
      provider: executeDef.ok ? executeDef.definition.provider : null,
      idempotencyKey: existing ? `${idempotencyKey}:${randomUUID().slice(0, 8)}` : idempotencyKey,
      expiresAt: addHours(new Date(), input.prepared.expiresInHours ?? 24),
      targets: {
        create: input.prepared.targets.map((target) => ({
          companyId: input.ctx.companyId,
          recordType: target.recordType,
          recordId: target.recordId,
          customerId: target.customerId ?? null,
          customerName: target.customerName ?? null,
          amountCents: target.amountCents ?? null,
          daysValue: target.daysValue ?? null,
          channel: target.channel ?? null,
          recipient: target.recipient ?? null,
          draftMessage: target.draftMessage ?? null,
          reason: target.reason ?? null,
          payload: target.payload ?? undefined,
        })),
      },
    },
    include: { targets: { orderBy: { createdAt: "asc" } } },
  });
}

export function modelSafeToolPayload(result: InvokeResult) {
  if (!result.ok) return { error: result.error };
  return sanitizeForModel({
    actionKey: result.actionKey,
    level: result.level,
    title: result.result.title,
    summary: result.result.summary,
    data: result.result.kind === "READ" ? result.result.data : undefined,
    targetCount: result.actionRequest?.targetCount,
    estimatedImpactCents: result.actionRequest?.estimatedImpactCents,
    status: result.actionRequest?.status,
    draftLabel: result.actionRequest?.draftLabel,
  });
}
