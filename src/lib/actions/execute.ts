import { prisma } from "@/lib/db";
import { DEMO_BLOCKED_MESSAGE } from "@/lib/demo/constants";
import { isDemoCompany } from "@/lib/demo/guard";
import { resolveCommunicationProvider, sendCompanyCommunication } from "@/lib/comms/provider";
import { publishThroughHighLevel } from "@/lib/highlevel/social";
import { highlevelCapabilities } from "@/lib/highlevel/capabilities";
import { isHighLevelConnected, loadHighLevelAccess } from "@/lib/highlevel/connection";
import {
  estimateStillOpen,
  invoiceStillCollectible,
  isSmsOptedOut,
  smsRecipient,
} from "@/lib/actions/eligibility";
import { recordOutboundSms } from "@/lib/actions/record-comms";
import type { ActionContext, ExecuteActionResult, TargetExecutionResult } from "@/lib/actions/types";
import type { AIActionTarget } from "@prisma/client";

function payloadOf(target: AIActionTarget) {
  return target.payload && typeof target.payload === "object" && !Array.isArray(target.payload)
    ? (target.payload as Record<string, unknown>)
    : {};
}

export async function handleExecuteAction(
  ctx: ActionContext,
  actionKey: string,
  targets: AIActionTarget[],
  requestId: string
): Promise<ExecuteActionResult> {
  const demo = await isDemoCompany(ctx.companyId);
  switch (actionKey) {
    case "communication.send_sms":
    case "estimate.send_followup":
    case "invoice.send_payment_reminder":
    case "membership.send_renewal":
      return executeSmsBatch(ctx, actionKey, targets, requestId, demo);
    case "review.send_request":
      return executeReviewRequests(ctx, targets, demo);
    case "social.schedule_post":
      return executeSocialSchedule(ctx, targets, demo);
    case "task.create":
      return executeTasks(ctx, targets, requestId);
    case "job.assign":
      return executeAssignments(ctx, targets);
    default:
      throw new Error("Unregistered execute action.");
  }
}

async function executeSmsBatch(
  ctx: ActionContext,
  actionKey: string,
  targets: AIActionTarget[],
  requestId: string,
  demo: boolean
): Promise<ExecuteActionResult> {
  const results: TargetExecutionResult[] = [];
  let providerUsed: string | null = demo ? "demo" : await resolveCommunicationProvider(ctx.companyId);

  for (const target of targets) {
    if (target.status === "EXCLUDED") continue;
    if (target.status === "EXECUTED") {
      results.push({
        targetId: target.id,
        status: "SKIPPED",
        skipReason: "Already sent for this approval.",
        provider: target.provider ?? undefined,
      });
      continue;
    }

    const recheck = await revalidateSmsTarget(ctx.companyId, actionKey, target);
    if (!recheck.ok) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: recheck.reason });
      continue;
    }

    const body = (target.draftMessage || "").trim();
    const to = recheck.recipient;
    if (!body) {
      results.push({ targetId: target.id, status: "FAILED", failureReason: "Draft message is empty." });
      continue;
    }
    if (!to) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "No valid mobile number on file." });
      continue;
    }

    if (demo) {
      await recordOutboundSms({
        companyId: ctx.companyId,
        customerId: target.customerId,
        customerName: target.customerName,
        to,
        body,
        provider: "demo",
        providerResultId: `demo-${target.id}`,
        simulated: true,
        actionRequestId: requestId,
        targetId: target.id,
      });
      await afterSuccessfulSms(ctx.companyId, actionKey, target);
      results.push({
        targetId: target.id,
        status: "EXECUTED",
        provider: "demo",
        providerResultId: `demo-${target.id}`,
        simulated: true,
      });
      continue;
    }

    const sent = await sendCompanyCommunication({
      companyId: ctx.companyId,
      channel: "SMS",
      to,
      body,
      customerId: target.customerId,
    });
    if (sent.provider === "demo") {
      results.push({
        targetId: target.id,
        status: "SKIPPED",
        skipReason: ("error" in sent && sent.error) || DEMO_BLOCKED_MESSAGE,
        provider: "demo",
      });
      continue;
    }
    if (!sent.ok) {
      results.push({
        targetId: target.id,
        status: "FAILED",
        failureReason: sent.error || "Provider rejected the message.",
        provider: sent.provider,
      });
      continue;
    }
    providerUsed = sent.provider;
    await recordOutboundSms({
      companyId: ctx.companyId,
      customerId: target.customerId,
      customerName: target.customerName,
      to,
      body,
      provider: sent.provider,
      providerResultId: sent.providerId ?? `msg-${target.id}`,
      actionRequestId: requestId,
      targetId: target.id,
    });
    await afterSuccessfulSms(ctx.companyId, actionKey, target);
    results.push({
      targetId: target.id,
      status: "EXECUTED",
      provider: sent.provider,
      providerResultId: sent.providerId,
    });
  }

  const sentCount = results.filter((row) => row.status === "EXECUTED").length;
  const skipped = results.filter((row) => row.status === "SKIPPED").length;
  const failed = results.filter((row) => row.status === "FAILED").length;
  return {
    kind: "EXECUTE",
    title: "Messages",
    summary: demo
      ? `DEMO MODE. ${sentCount} message${sentCount === 1 ? "" : "s"} simulated. No external action was performed.`
      : `${sentCount} sent${providerUsed && providerUsed !== "none" ? ` through ${providerUsed === "highlevel" ? "HighLevel" : providerUsed}` : ""}${skipped ? ` · ${skipped} skipped` : ""}${failed ? ` · ${failed} failed` : ""}.`,
    results,
    provider: providerUsed,
    executionMode: demo ? "demo" : "live",
    grounding: { sources: ["communication_messages"] },
  };
}

async function revalidateSmsTarget(companyId: string, actionKey: string, target: AIActionTarget) {
  if (target.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: target.customerId, companyId },
      select: { id: true, phone: true, secondaryPhone: true, tags: true, preferredContactMethod: true, status: true },
    });
    if (!customer) return { ok: false as const, reason: "Customer is no longer in this company." };
    if (customer.status !== "ACTIVE") return { ok: false as const, reason: "Customer is not active." };
    if (isSmsOptedOut(customer)) return { ok: false as const, reason: "Customer is opted out of text messages." };
    const recipient = smsRecipient(customer);
    if (!recipient) return { ok: false as const, reason: "No valid mobile number on file." };

    if (actionKey === "estimate.send_followup") {
      const estimate = await prisma.estimate.findFirst({
        where: { id: target.recordId, companyId },
        select: { status: true },
      });
      if (!estimate) return { ok: false as const, reason: "Estimate was not found." };
      if (!estimateStillOpen(estimate.status)) {
        return { ok: false as const, reason: `Estimate was ${estimate.status.toLowerCase()} before execution.` };
      }
    }
    if (actionKey === "invoice.send_payment_reminder") {
      const invoice = await prisma.invoice.findFirst({
        where: { id: target.recordId, companyId },
        select: { status: true, balanceCents: true },
      });
      if (!invoice) return { ok: false as const, reason: "Invoice was not found." };
      if (invoice.status === "PAID" || invoice.balanceCents <= 0) {
        return { ok: false as const, reason: "Invoice already paid." };
      }
      if (!invoiceStillCollectible(invoice.status, invoice.balanceCents)) {
        return { ok: false as const, reason: `Invoice is ${invoice.status.toLowerCase()} and is no longer collectible.` };
      }
    }
    if (actionKey === "membership.send_renewal") {
      const membership = await prisma.customerMembership.findFirst({
        where: { id: target.recordId, companyId },
        select: { status: true },
      });
      if (!membership) return { ok: false as const, reason: "Membership was not found." };
      if (membership.status === "CANCELLED" || membership.status === "EXPIRED") {
        return { ok: false as const, reason: "Membership is no longer active." };
      }
    }
    return { ok: true as const, recipient };
  }
  return { ok: false as const, reason: "Target is missing a customer." };
}

async function afterSuccessfulSms(companyId: string, actionKey: string, target: AIActionTarget) {
  if (actionKey === "estimate.send_followup") {
    await prisma.estimate.updateMany({
      where: { id: target.recordId, companyId, status: { in: ["SENT", "VIEWED"] } },
      data: { followUpAt: new Date() },
    });
  }
}

async function executeReviewRequests(
  ctx: ActionContext,
  targets: AIActionTarget[],
  demo: boolean
): Promise<ExecuteActionResult> {
  const access = await loadHighLevelAccess(prisma, ctx.companyId);
  const connected = await isHighLevelConnected(prisma, ctx.companyId);
  const caps = highlevelCapabilities({
    connected,
    scopes: access?.connection.scopes ?? [],
  });
  const reviews = caps.find((cap) => cap.key === "reviews");
  const authorized = reviews?.status === "CONNECTED" || reviews?.status === "AVAILABLE";
  if (!authorized) {
    return {
      kind: "EXECUTE",
      title: "Review requests",
      summary: "HighLevel Reviews access is not currently authorized.",
      results: targets.map((target) => ({
        targetId: target.id,
        status: "FAILED" as const,
        failureReason: "HighLevel Reviews access is not currently authorized.",
      })),
      provider: "highlevel",
      executionMode: demo ? "demo" : "live",
      grounding: { sources: ["review_requests"] },
    };
  }
  if (demo) {
    return {
      kind: "EXECUTE",
      title: "Review requests",
      summary: `${DEMO_BLOCKED_MESSAGE} Review drafts were left unsent.`,
      results: targets.map((target) => ({
        targetId: target.id,
        status: "EXECUTED" as const,
        provider: "demo",
        simulated: true,
      })),
      provider: "demo",
      executionMode: "demo",
      grounding: { sources: ["review_requests"] },
    };
  }
  return {
    kind: "EXECUTE",
    title: "Review requests",
    summary: "HighLevel Reviews is authorized, but sending review requests is not enabled in this phase.",
    results: targets.map((target) => ({
      targetId: target.id,
      status: "FAILED" as const,
      failureReason: "Review sending is not enabled until HighLevel Reviews execution is separately implemented.",
    })),
    provider: "highlevel",
    executionMode: "live",
    grounding: { sources: ["review_requests"] },
  };
}

async function executeSocialSchedule(
  ctx: ActionContext,
  targets: AIActionTarget[],
  demo: boolean
): Promise<ExecuteActionResult> {
  const results: TargetExecutionResult[] = [];
  for (const target of targets) {
    const payload = payloadOf(target);
    const post = await prisma.socialPost.findFirst({
      where: { id: target.recordId, companyId: ctx.companyId },
    });
    if (!post) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "Draft post was not found." });
      continue;
    }
    const scheduledAt =
      (typeof payload.scheduledAt === "string" && payload.scheduledAt ? new Date(payload.scheduledAt) : null) ||
      post.scheduledAt ||
      new Date(Date.now() + 60 * 60 * 1000);
    if (demo) {
      await prisma.socialPost.update({
        where: { id: post.id },
        data: { status: "SCHEDULED", scheduledAt, provider: "demo" },
      });
      results.push({ targetId: target.id, status: "EXECUTED", provider: "demo", simulated: true });
      continue;
    }
    const access = await loadHighLevelAccess(prisma, ctx.companyId);
    if (!access) {
      results.push({
        targetId: target.id,
        status: "FAILED",
        failureReason: "HighLevel is not connected. The draft was not published.",
      });
      continue;
    }
    const accounts = await prisma.integrationAccount.findMany({
      where: { companyId: ctx.companyId, connectionId: access.connection.id, selected: true },
      select: { externalId: true, kind: true },
    });
    const published = await publishThroughHighLevel(prisma, {
      companyId: ctx.companyId,
      accountIds: accounts.map((account) => account.externalId),
      body: target.draftMessage || post.body,
      status: "scheduled",
      scheduleDate: scheduledAt,
      channels: [post.channel],
    });
    if (!published.ok) {
      results.push({ targetId: target.id, status: "FAILED", failureReason: published.error, provider: "highlevel" });
      continue;
    }
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "SCHEDULED", scheduledAt, provider: "highlevel", externalId: published.externalId },
    });
    results.push({
      targetId: target.id,
      status: "EXECUTED",
      provider: "highlevel",
      providerResultId: published.externalId,
    });
  }
  return {
    kind: "EXECUTE",
    title: "Social post",
    summary: demo ? `${DEMO_BLOCKED_MESSAGE} The post was scheduled inside the demo only.` : "Approved social schedule processed.",
    results,
    provider: demo ? "demo" : "highlevel",
    executionMode: demo ? "demo" : "live",
    grounding: { sources: ["social_posts"] },
  };
}

async function executeTasks(
  ctx: ActionContext,
  targets: AIActionTarget[],
  requestId: string
): Promise<ExecuteActionResult> {
  const results: TargetExecutionResult[] = [];
  for (const target of targets) {
    if (target.status === "EXECUTED") {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "Task already created." });
      continue;
    }
    const payload = payloadOf(target);
    const assignedToUserId = typeof payload.assignedToUserId === "string" ? payload.assignedToUserId : null;
    if (assignedToUserId) {
      const member = await prisma.membership.findFirst({
        where: { companyId: ctx.companyId, userId: assignedToUserId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!member) {
        results.push({ targetId: target.id, status: "SKIPPED", skipReason: "Assignee is not on this company." });
        continue;
      }
    }
    const existing = await prisma.companyTask.findFirst({
      where: { companyId: ctx.companyId, actionRequestId: requestId, relatedId: String(payload.relatedId || target.recordId) },
    });
    if (existing) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "Task already created for this approval." });
      continue;
    }
    await prisma.companyTask.create({
      data: {
        companyId: ctx.companyId,
        assignedToUserId,
        createdByUserId: ctx.userId,
        actionRequestId: requestId,
        title: target.draftMessage || "Follow up",
        details: target.reason,
        dueAt: typeof payload.dueAt === "string" ? new Date(payload.dueAt) : null,
        relatedType: typeof payload.relatedType === "string" ? payload.relatedType : target.recordType,
        relatedId: typeof payload.relatedId === "string" ? payload.relatedId : target.recordId,
      },
    });
    results.push({ targetId: target.id, status: "EXECUTED", provider: "contractoryou" });
  }
  return {
    kind: "EXECUTE",
    title: "Office tasks",
    summary: `${results.filter((row) => row.status === "EXECUTED").length} internal task${results.filter((row) => row.status === "EXECUTED").length === 1 ? "" : "s"} created.`,
    results,
    provider: "contractoryou",
    executionMode: "live",
    grounding: { sources: ["company_tasks"] },
  };
}

async function executeAssignments(ctx: ActionContext, targets: AIActionTarget[]): Promise<ExecuteActionResult> {
  const results: TargetExecutionResult[] = [];
  for (const target of targets) {
    const payload = payloadOf(target);
    const technicianUserId = typeof payload.technicianUserId === "string" ? payload.technicianUserId : null;
    const job = await prisma.job.findFirst({
      where: { id: target.recordId, companyId: ctx.companyId },
      include: { assignments: true },
    });
    if (!job) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "Job was not found." });
      continue;
    }
    if (!technicianUserId) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "No technician was recommended." });
      continue;
    }
    if (job.assignments.some((row) => row.userId === technicianUserId)) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "Job is already assigned to that technician." });
      continue;
    }
    const member = await prisma.membership.findFirst({
      where: {
        companyId: ctx.companyId,
        userId: technicianUserId,
        status: "ACTIVE",
        role: { in: ["TECHNICIAN", "INSTALLER"] },
      },
    });
    if (!member) {
      results.push({ targetId: target.id, status: "SKIPPED", skipReason: "Technician is not on this company." });
      continue;
    }
    await prisma.jobAssignment.deleteMany({ where: { jobId: job.id } });
    await prisma.jobAssignment.create({ data: { jobId: job.id, userId: technicianUserId } });
    if ((job.status === "NEW" || job.status === "UNSCHEDULED") && job.scheduledStart) {
      await prisma.job.update({ where: { id: job.id }, data: { status: "SCHEDULED" } });
    }
    results.push({ targetId: target.id, status: "EXECUTED", provider: "contractoryou" });
  }
  return {
    kind: "EXECUTE",
    title: "Dispatch assignments",
    summary: `${results.filter((row) => row.status === "EXECUTED").length} job${results.filter((row) => row.status === "EXECUTED").length === 1 ? "" : "s"} assigned.`,
    results,
    provider: "contractoryou",
    executionMode: "live",
    grounding: { sources: ["job_assignments"] },
  };
}
