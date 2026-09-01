"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import {
  approveAndExecuteRequest,
  cancelActionRequest,
  getActionRequestForCompany,
  retryFailedTargets,
  updateActionTargets,
} from "@/lib/actions/approvals";
import { invokeRegisteredAction } from "@/lib/actions/invoke";
import { toPublicActionRequest } from "@/lib/actions/public";
import type { ActionContext, PublicActionRequest } from "@/lib/actions/types";
import type { ActionResult } from "@/server/actions/auth";

export type ActionEngineState = ActionResult & { request?: PublicActionRequest | null };

async function actionContext() {
  const ctx = await requirePermission("intelligence:view");
  return {
    session: ctx,
    ctx: {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      role: ctx.role,
      source: "ui" as const,
      companyName: ctx.company.businessName,
      isDemo: Boolean(ctx.company.isDemo),
    } satisfies ActionContext,
  };
}

function refresh() {
  revalidatePath("/actions");
  revalidatePath("/intelligence");
  revalidatePath("/dashboard");
  revalidatePath("/attention");
}

export async function approveActionRequestAction(requestId: string): Promise<ActionEngineState> {
  try {
    const { ctx } = await actionContext();
    const result = await approveAndExecuteRequest(ctx, requestId);
    refresh();
    if (!result.ok) return { ok: false, error: result.error, request: result.request };
    return { ok: true, request: result.request };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function cancelActionRequestAction(requestId: string): Promise<ActionEngineState> {
  try {
    const { ctx } = await actionContext();
    const result = await cancelActionRequest(ctx, requestId);
    refresh();
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, request: result.request };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function updateActionTargetsAction(input: {
  requestId: string;
  excludeIds?: string[];
  includeIds?: string[];
  edits?: { targetId: string; draftMessage: string }[];
}): Promise<ActionEngineState> {
  try {
    const { ctx } = await actionContext();
    const result = await updateActionTargets({ ctx, ...input });
    refresh();
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, request: result.request };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function retryFailedActionAction(requestId: string): Promise<ActionEngineState> {
  try {
    const { ctx } = await actionContext();
    const result = await retryFailedTargets(ctx, requestId);
    refresh();
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, request: "request" in result ? result.request : null };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function startAttentionActionAction(input: {
  type: string;
  entityId?: string;
}): Promise<ActionEngineState> {
  try {
    const { ctx } = await actionContext();
    const map: Record<string, { key: string; extra?: Record<string, unknown> }> = {
      estimate_not_followed_up: { key: "estimate.draft_followup", extra: input.entityId ? { recordIds: [input.entityId] } : {} },
      invoice_overdue: { key: "invoice.draft_payment_reminder", extra: input.entityId ? { recordIds: [input.entityId] } : {} },
      invoice_awaiting_payment: { key: "invoice.draft_payment_reminder", extra: input.entityId ? { recordIds: [input.entityId] } : {} },
      membership_needs_review: { key: "membership.draft_renewal", extra: input.entityId ? { recordIds: [input.entityId] } : {} },
      job_missing_technician: { key: "job.propose_assignment", extra: input.entityId ? { recordIds: [input.entityId] } : {} },
    };
    const selected = map[input.type];
    if (!selected) return { ok: false, error: "No prepared action is available for that item." };
    const result = await invokeRegisteredAction({
      ctx: { ...ctx, source: "attention" },
      actionKey: selected.key,
      rawInput: selected.extra ?? {},
    });
    refresh();
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, request: result.actionRequest ?? null };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function prepareDispatchMessageAction(customerId: string): Promise<ActionEngineState> {
  try {
    const { ctx } = await actionContext();
    const result = await invokeRegisteredAction({
      ctx: { ...ctx, source: "ui" },
      actionKey: "communication.draft_sms",
      rawInput: {
        recordIds: [customerId],
        purpose: "Your technician is running behind. We will update you as soon as we have a new arrival window.",
      },
    });
    refresh();
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, request: result.actionRequest ?? null };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function loadActionRequestAction(requestId: string): Promise<ActionEngineState> {
  try {
    const { ctx } = await actionContext();
    const request = await getActionRequestForCompany(ctx.companyId, requestId);
    if (!request) return { ok: false, error: "Action not found." };
    return { ok: true, request: toPublicActionRequest(request, { isDemo: ctx.isDemo }) };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
