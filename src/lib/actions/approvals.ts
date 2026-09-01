import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { assertInvocableAction, requiredPermissionsOf } from "@/lib/actions/registry";
import { handleExecuteAction } from "@/lib/actions/execute";
import { toPublicActionRequest } from "@/lib/actions/public";
import type { ActionContext, PublicActionRequest } from "@/lib/actions/types";

export async function getActionRequestForCompany(companyId: string, requestId: string) {
  return prisma.aIActionRequest.findFirst({
    where: { id: requestId, companyId },
    include: {
      targets: { orderBy: { createdAt: "asc" } },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

export async function listRecentActionRequests(companyId: string, take = 5) {
  return prisma.aIActionRequest.findMany({
    where: { companyId },
    include: {
      requestedBy: { select: { firstName: true, lastName: true } },
      targets: { select: { id: true, status: true, amountCents: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function listActionRequests(companyId: string, tab: "approval" | "drafts" | "completed" | "failed") {
  const status =
    tab === "approval"
      ? ["AWAITING_APPROVAL", "APPROVED", "EXECUTING"]
      : tab === "drafts"
        ? ["DRAFT"]
        : tab === "failed"
          ? ["FAILED", "PARTIALLY_COMPLETED", "CANCELED", "EXPIRED"]
          : ["COMPLETED", "PARTIALLY_COMPLETED"];
  return prisma.aIActionRequest.findMany({
    where: { companyId, status: { in: status as never } },
    include: {
      requestedBy: { select: { firstName: true, lastName: true } },
      targets: { select: { id: true, status: true, amountCents: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function updateActionTargets(input: {
  ctx: ActionContext;
  requestId: string;
  excludeIds?: string[];
  includeIds?: string[];
  edits?: { targetId: string; draftMessage: string }[];
}) {
  const request = await getActionRequestForCompany(input.ctx.companyId, input.requestId);
  if (!request) return { ok: false as const, error: "Action not found." };
  if (request.status !== "AWAITING_APPROVAL" && request.status !== "DRAFT") {
    return { ok: false as const, error: "This action can no longer be edited." };
  }
  if (input.excludeIds?.length) {
    await prisma.aIActionTarget.updateMany({
      where: { companyId: input.ctx.companyId, requestId: request.id, id: { in: input.excludeIds } },
      data: { status: "EXCLUDED" },
    });
  }
  if (input.includeIds?.length) {
    await prisma.aIActionTarget.updateMany({
      where: { companyId: input.ctx.companyId, requestId: request.id, id: { in: input.includeIds }, status: "EXCLUDED" },
      data: { status: "PENDING" },
    });
  }
  for (const edit of input.edits ?? []) {
    const message = edit.draftMessage.trim().slice(0, 2000);
    if (!message) continue;
    await prisma.aIActionTarget.updateMany({
      where: { companyId: input.ctx.companyId, requestId: request.id, id: edit.targetId },
      data: { draftMessage: message },
    });
  }
  const pending = await prisma.aIActionTarget.findMany({
    where: { companyId: input.ctx.companyId, requestId: request.id, status: "PENDING" },
    select: { amountCents: true },
  });
  await prisma.aIActionRequest.update({
    where: { id: request.id },
    data: {
      targetCount: pending.length,
      estimatedImpactCents: pending.reduce((sum, row) => sum + (row.amountCents ?? 0), 0),
    },
  });
  const next = await getActionRequestForCompany(input.ctx.companyId, request.id);
  return { ok: true as const, request: next ? toPublicActionRequest(next, { isDemo: input.ctx.isDemo }) : null };
}

export async function excludeTargetsByName(input: { ctx: ActionContext; requestId?: string | null; name: string }) {
  const request = input.requestId
    ? await getActionRequestForCompany(input.ctx.companyId, input.requestId)
    : await prisma.aIActionRequest.findFirst({
        where: {
          companyId: input.ctx.companyId,
          conversationId: input.ctx.conversationId ?? undefined,
          status: "AWAITING_APPROVAL",
        },
        include: { targets: true, requestedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      });
  if (!request) return { ok: false as const, error: "No open approval matched that request." };
  const needle = input.name.trim().toLowerCase();
  const matches = request.targets.filter((target) => (target.customerName || "").toLowerCase().includes(needle));
  if (matches.length === 0) return { ok: false as const, error: `I could not find ${input.name} on this approval.` };
  return updateActionTargets({ ctx: input.ctx, requestId: request.id, excludeIds: matches.map((row) => row.id) });
}

export async function cancelActionRequest(ctx: ActionContext, requestId: string) {
  const request = await getActionRequestForCompany(ctx.companyId, requestId);
  if (!request) return { ok: false as const, error: "Action not found." };
  if (!["DRAFT", "AWAITING_APPROVAL", "APPROVED"].includes(request.status)) {
    return { ok: false as const, error: "This action can no longer be canceled." };
  }
  await prisma.aIActionRequest.update({
    where: { id: request.id },
    data: { status: "CANCELED" },
  });
  await writeAudit({
    companyId: ctx.companyId,
    actorId: ctx.userId,
    action: "AI_ACTION_CANCELED",
    entityType: "AIActionRequest",
    entityId: request.id,
  });
  const next = await getActionRequestForCompany(ctx.companyId, request.id);
  return { ok: true as const, request: next ? toPublicActionRequest(next, { isDemo: ctx.isDemo }) : null };
}

export async function approveAndExecuteRequest(
  ctx: ActionContext,
  requestId: string
): Promise<{ ok: true; request: PublicActionRequest } | { ok: false; error: string; request?: PublicActionRequest }> {
  const current = await getActionRequestForCompany(ctx.companyId, requestId);
  if (!current) return { ok: false, error: "Action not found." };

  const definition = assertInvocableAction(current.actionKey);
  if (!definition.ok) return { ok: false, error: definition.error };
  const perm = requiredPermissionsOf(definition.definition)[0];
  if (!can(ctx.role, perm)) return { ok: false, error: "You do not have permission to execute that action." };

  if (current.status === "COMPLETED" || current.status === "PARTIALLY_COMPLETED") {
    return { ok: true, request: toPublicActionRequest(current, { isDemo: ctx.isDemo }) };
  }
  if (current.status === "EXECUTING") {
    return { ok: false, error: "This action is already running.", request: toPublicActionRequest(current, { isDemo: ctx.isDemo }) };
  }
  if (current.status === "CANCELED") return { ok: false, error: "This approval was canceled." };
  if (current.status === "EXPIRED" || current.expiresAt.getTime() <= Date.now()) {
    if (current.status !== "EXPIRED") {
      await prisma.aIActionRequest.update({ where: { id: current.id }, data: { status: "EXPIRED" } });
    }
    return { ok: false, error: "This approval has expired." };
  }
  if (current.status !== "AWAITING_APPROVAL" && current.status !== "APPROVED") {
    return { ok: false, error: "This action is not waiting for approval." };
  }

  const locked = await prisma.aIActionRequest.updateMany({
    where: {
      id: current.id,
      companyId: ctx.companyId,
      status: { in: ["AWAITING_APPROVAL", "APPROVED"] },
    },
    data: {
      status: "EXECUTING",
      approvedAt: current.approvedAt ?? new Date(),
      approvedByUserId: ctx.userId,
    },
  });
  if (locked.count === 0) {
    const again = await getActionRequestForCompany(ctx.companyId, requestId);
    if (again && (again.status === "COMPLETED" || again.status === "PARTIALLY_COMPLETED")) {
      return { ok: true, request: toPublicActionRequest(again, { isDemo: ctx.isDemo }) };
    }
    return { ok: false, error: "This action is already running or is no longer approvable." };
  }

  const pending = current.targets.filter((target) => target.status === "PENDING");
  await writeAudit({
    companyId: ctx.companyId,
    actorId: ctx.userId,
    action: "AI_ACTION_APPROVED",
    entityType: "AIActionRequest",
    entityId: current.id,
    metadata: { actionKey: current.actionKey, targetCount: pending.length },
  });

  try {
    const executed = await handleExecuteAction(ctx, current.actionKey, pending, current.id);
    for (const result of executed.results) {
      await prisma.aIActionTarget.updateMany({
        where: { id: result.targetId, companyId: ctx.companyId, requestId: current.id },
        data: {
          status: result.status,
          skipReason: result.skipReason ?? null,
          failureReason: result.failureReason ?? null,
          provider: result.provider ?? null,
          providerResultId: result.providerResultId ?? null,
          executedAt: result.status === "EXECUTED" ? new Date() : null,
        },
      });
    }
    const executedCount = executed.results.filter((row) => row.status === "EXECUTED").length;
    const skippedCount = executed.results.filter((row) => row.status === "SKIPPED").length;
    const failedCount = executed.results.filter((row) => row.status === "FAILED").length;
    const status =
      failedCount > 0 && executedCount > 0
        ? "PARTIALLY_COMPLETED"
        : failedCount > 0 && executedCount === 0
          ? "FAILED"
          : skippedCount > 0 && executedCount > 0
            ? "PARTIALLY_COMPLETED"
            : executedCount > 0
              ? "COMPLETED"
              : skippedCount > 0
                ? "COMPLETED"
                : "FAILED";
    await prisma.aIActionRequest.update({
      where: { id: current.id },
      data: {
        status,
        executedAt: new Date(),
        executedCount,
        skippedCount,
        failedCount,
        provider: executed.provider,
        executionMode: executed.executionMode,
        summary: executed.summary,
        failureReason: failedCount ? executed.results.find((row) => row.failureReason)?.failureReason ?? null : null,
      },
    });
    await writeAudit({
      companyId: ctx.companyId,
      actorId: ctx.userId,
      action: "AI_ACTION_EXECUTED",
      entityType: "AIActionRequest",
      entityId: current.id,
      metadata: {
        actionKey: current.actionKey,
        status,
        executedCount,
        skippedCount,
        failedCount,
        provider: executed.provider,
        executionMode: executed.executionMode,
      },
    });
    const next = await getActionRequestForCompany(ctx.companyId, current.id);
    return {
      ok: true,
      request: next ? toPublicActionRequest(next, { isDemo: ctx.isDemo }) : toPublicActionRequest(current, { isDemo: ctx.isDemo }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed.";
    await prisma.aIActionRequest.update({
      where: { id: current.id },
      data: { status: "FAILED", failureReason: message, executedAt: new Date() },
    });
    return { ok: false, error: message };
  }
}

export async function retryFailedTargets(ctx: ActionContext, requestId: string) {
  const request = await getActionRequestForCompany(ctx.companyId, requestId);
  if (!request) return { ok: false as const, error: "Action not found." };
  if (request.status !== "FAILED" && request.status !== "PARTIALLY_COMPLETED") {
    return { ok: false as const, error: "Only failed targets can be retried." };
  }
  await prisma.aIActionTarget.updateMany({
    where: { companyId: ctx.companyId, requestId, status: "FAILED" },
    data: { status: "PENDING", failureReason: null },
  });
  await prisma.aIActionRequest.update({
    where: { id: requestId },
    data: { status: "AWAITING_APPROVAL", failureReason: null },
  });
  return approveAndExecuteRequest(ctx, requestId);
}
