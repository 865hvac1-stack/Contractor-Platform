import { invokeRegisteredAction } from "@/lib/actions/invoke";
import { excludeTargetsByName, getActionRequestForCompany } from "@/lib/actions/approvals";
import { planFromQuestion } from "@/lib/actions/planner";
import { loadLastResultSet } from "@/lib/actions/result-set";
import { toPublicActionRequest } from "@/lib/actions/public";
import type { ActionContext, AskKind, PublicActionRequest } from "@/lib/actions/types";
import type { InvokeResult } from "@/lib/actions/invoke";

export async function runActionPlan(input: {
  ctx: ActionContext;
  question: string;
}): Promise<{
  handled: boolean;
  sendExisting?: boolean;
  kind: AskKind;
  results: InvokeResult[];
  actionRequest: PublicActionRequest | null;
  error?: string;
}> {
  const last = await loadLastResultSet(input.ctx.companyId, input.ctx.conversationId);
  const plan = planFromQuestion(input.question, last);

  if (plan.excludeName) {
    const updated = await excludeTargetsByName({
      ctx: input.ctx,
      requestId: last?.actionRequestId,
      name: plan.excludeName,
    });
    if (!updated.ok) return { handled: true, kind: "ANSWER", results: [], actionRequest: null, error: updated.error };
    return { handled: true, kind: "ACTION_REQUIRES_APPROVAL", results: [], actionRequest: updated.request };
  }

  if (plan.sendExisting) {
    const requestId = last?.actionRequestId;
    if (!requestId) {
      return {
        handled: true,
        sendExisting: true,
        kind: "ANSWER",
        results: [],
        actionRequest: null,
        error: "I need an open approval before anything can be sent. Ask me to draft the messages first.",
      };
    }
    const request = await getActionRequestForCompany(input.ctx.companyId, requestId);
    return {
      handled: true,
      sendExisting: true,
      kind: request ? "ACTION_REQUIRES_APPROVAL" : "ANSWER",
      results: [],
      actionRequest: request ? toPublicActionRequest(request, { isDemo: input.ctx.isDemo }) : null,
    };
  }

  if (!plan.handled) {
    return { handled: false, kind: "ANSWER", results: [], actionRequest: null };
  }

  const results: InvokeResult[] = [];
  let actionRequest: PublicActionRequest | null = null;
  let kind: AskKind = "ANSWER";
  for (const step of plan.steps) {
    const result = await invokeRegisteredAction({
      ctx: { ...input.ctx, source: "planner" },
      actionKey: step.key,
      rawInput: step.input,
    });
    results.push(result);
    if (!result.ok) {
      return { handled: true, kind: "ACTION_FAILED", results, actionRequest, error: result.error };
    }
    if (result.actionRequest) {
      actionRequest = result.actionRequest;
      kind = result.kind;
    } else if (!actionRequest) {
      kind = result.kind;
    }
  }
  return { handled: true, kind, results, actionRequest };
}

export function deterministicActionAnswer(input: {
  kind: AskKind;
  results: InvokeResult[];
  actionRequest: PublicActionRequest | null;
  error?: string;
  sendExisting?: boolean;
}) {
  if (input.error && !input.actionRequest) return input.error;
  if (input.sendExisting && input.actionRequest) {
    return `I still have ${input.actionRequest.targetCount} ${input.actionRequest.title.toLowerCase()} waiting on your approval. Nothing has been sent.`;
  }
  const lastOk = [...input.results].reverse().find((row) => row.ok);
  if (lastOk && lastOk.ok) {
    const lines = [lastOk.result.summary];
    if (lastOk.result.kind === "PREPARE") {
      lines.push("DRAFT — NOTHING HAS BEEN SENT.");
      if (input.actionRequest) {
        lines.push("Review the messages, edit or exclude anyone, then approve if you want them sent.");
      }
    }
    if (lastOk.result.kind === "READ" && lastOk.result.criteria) {
      const criteria = lastOk.result.criteria;
      if (criteria.minDays != null) lines.push(`Criteria: at least ${criteria.minDays} days old, still open.`);
    }
    return lines.join("\n");
  }
  return "I looked at your ContractorYou records.";
}
