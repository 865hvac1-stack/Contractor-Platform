import { addDays, startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  draftEstimateFollowup,
  draftGenericSms,
  draftInvoiceReminder,
  draftMembershipRenewal,
  draftReviewRequest,
  draftSocialPost,
} from "@/lib/actions/draft-copy";
import {
  customerDisplayName,
  daysSince,
  daysUntil,
  estimateStillOpen,
  invoiceStillCollectible,
  isSmsOptedOut,
  smsRecipient,
} from "@/lib/actions/eligibility";
import {
  identifyEstimateFollowups,
  identifyMembershipRenewals,
  identifyOverdueInvoices,
} from "@/lib/actions/read";
import { getBusinessContext } from "@/lib/intelligence/operating-context";
import type { ActionContext, ActionTargetDraft, PrepareActionResult } from "@/lib/actions/types";

const DRAFT_LABEL = "DRAFT — NOTHING HAS BEEN SENT" as const;

function prepareResult(partial: Omit<PrepareActionResult, "kind" | "draftLabel">): PrepareActionResult {
  return { kind: "PREPARE", draftLabel: DRAFT_LABEL, ...partial };
}

export async function handlePrepareAction(
  ctx: ActionContext,
  actionKey: string,
  input: Record<string, unknown>
): Promise<PrepareActionResult> {
  switch (actionKey) {
    case "estimate.draft_followup":
      return draftEstimateFollowups(ctx, input);
    case "invoice.draft_payment_reminder":
      return draftInvoiceReminders(ctx, input);
    case "membership.draft_renewal":
      return draftMembershipRenewals(ctx, input);
    case "communication.draft_sms":
      return draftGenericMessages(ctx, input);
    case "review.draft_request":
      return draftReviews(ctx, input);
    case "social.create_draft":
      return draftSocial(ctx, input);
    case "job.propose_assignment":
      return proposeAssignments(ctx, input);
    case "task.prepare_bulk":
      return prepareTasks(ctx, input);
    default:
      throw new Error("Unregistered prepare action.");
  }
}

async function draftEstimateFollowups(ctx: ActionContext, input: Record<string, unknown>) {
  const identified = await identifyEstimateFollowups(ctx, input);
  const ids = identified.recordIds ?? [];
  if (ids.length === 0) {
    return prepareResult({
      executeActionKey: "estimate.send_followup",
      title: "Estimate follow-up",
      summary: "No open estimates currently meet the follow-up criteria.",
      targets: [],
      estimatedImpactCents: 0,
      criteria: identified.criteria,
      preview: { empty: true },
      grounding: identified.grounding,
    });
  }
  const rows = await prisma.estimate.findMany({
    where: { companyId: ctx.companyId, id: { in: ids } },
    select: {
      id: true,
      estimateNumber: true,
      totalCents: true,
      status: true,
      issueDate: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true,
          secondaryPhone: true,
          tags: true,
          preferredContactMethod: true,
        },
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const context = await getBusinessContext(ctx.companyId);
  const ownerHoldCents = context?.notes.some((note) => note.id === "high-value-estimate")
    ? context.highValueEstimateCents
    : null;
  const held: string[] = [];
  const targets: ActionTargetDraft[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !estimateStillOpen(row.status)) continue;
    if (ownerHoldCents && row.totalCents >= ownerHoldCents) {
      held.push(
        `${customerDisplayName(row.customer)} — ${formatMoney(row.totalCents)} stays with the owner under High-Value Estimate Ownership.`
      );
      continue;
    }
    const recipient = smsRecipient(row.customer);
    targets.push({
      recordType: "ESTIMATE",
      recordId: row.id,
      customerId: row.customer.id,
      customerName: customerDisplayName(row.customer),
      amountCents: row.totalCents,
      daysValue: daysSince(row.issueDate),
      channel: "SMS",
      recipient,
      draftMessage: draftEstimateFollowup({
        companyName: ctx.companyName,
        customer: row.customer,
        estimateNumber: row.estimateNumber,
        totalCents: row.totalCents,
        issueDate: row.issueDate,
      }),
      reason: `${row.estimateNumber} is still ${row.status.toLowerCase()} and ${daysSince(row.issueDate)} days old.`,
      payload: { estimateNumber: row.estimateNumber, optedOut: isSmsOptedOut(row.customer) },
    });
  }
  const total = targets.reduce((sum, target) => sum + (target.amountCents ?? 0), 0);
  const heldNote = held.length ? ` ${held.join(" ")}` : "";
  return prepareResult({
    executeActionKey: "estimate.send_followup",
    title: "Estimate follow-up",
    summary:
      targets.length === 0 && held.length > 0
        ? `No drafts were prepared. ${held.join(" ")}`
        : `ContractorYou prepared ${targets.length} personalized follow-up${targets.length === 1 ? "" : "s"}. ${formatMoney(total)} open opportunity.${heldNote}`,
    targets,
    estimatedImpactCents: total,
    criteria: { ...identified.criteria, ownerHeld: held },
    preview: { count: targets.length, opportunityCents: total, ownerHeld: held },
    grounding: { sources: ["estimates", "customers", "company_operating_notes"] },
  });
}

async function draftInvoiceReminders(ctx: ActionContext, input: Record<string, unknown>) {
  const identified = await identifyOverdueInvoices(ctx, input);
  const ids = identified.recordIds ?? [];
  const rows = await prisma.invoice.findMany({
    where: { companyId: ctx.companyId, id: { in: ids } },
    select: {
      id: true,
      invoiceNumber: true,
      balanceCents: true,
      status: true,
      dueDate: true,
      customer: {
        select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, secondaryPhone: true, tags: true },
      },
    },
  });
  const targets: ActionTargetDraft[] = [];
  for (const row of rows) {
    if (!invoiceStillCollectible(row.status, row.balanceCents)) continue;
    targets.push({
      recordType: "INVOICE",
      recordId: row.id,
      customerId: row.customer.id,
      customerName: customerDisplayName(row.customer),
      amountCents: row.balanceCents,
      daysValue: daysSince(row.dueDate),
      channel: "SMS",
      recipient: smsRecipient(row.customer),
      draftMessage: draftInvoiceReminder({
        companyName: ctx.companyName,
        customer: row.customer,
        invoiceNumber: row.invoiceNumber,
        balanceCents: row.balanceCents,
        daysOverdue: daysSince(row.dueDate),
      }),
      reason: `${row.invoiceNumber} is ${daysSince(row.dueDate)} days overdue.`,
      payload: { invoiceNumber: row.invoiceNumber, optedOut: isSmsOptedOut(row.customer) },
    });
  }
  const total = targets.reduce((sum, target) => sum + (target.amountCents ?? 0), 0);
  return prepareResult({
    executeActionKey: "invoice.send_payment_reminder",
    title: "Payment reminders",
    summary: `ContractorYou prepared ${targets.length} reminder${targets.length === 1 ? "" : "s"}. ${formatMoney(total)} outstanding.`,
    targets,
    estimatedImpactCents: total,
    criteria: identified.criteria,
    preview: { count: targets.length, outstandingCents: total },
    grounding: { sources: ["invoices", "customers"] },
  });
}

async function draftMembershipRenewals(ctx: ActionContext, input: Record<string, unknown>) {
  const identified = await identifyMembershipRenewals(ctx, input);
  const ids = identified.recordIds ?? [];
  const rows = await prisma.customerMembership.findMany({
    where: { companyId: ctx.companyId, id: { in: ids } },
    select: {
      id: true,
      priceCents: true,
      renewalDate: true,
      status: true,
      plan: { select: { name: true } },
      customer: {
        select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, secondaryPhone: true, tags: true },
      },
    },
  });
  const targets: ActionTargetDraft[] = rows.map((row) => ({
    recordType: "MEMBERSHIP" as const,
    recordId: row.id,
    customerId: row.customer.id,
    customerName: customerDisplayName(row.customer),
    amountCents: row.priceCents,
    daysValue: daysUntil(row.renewalDate) ?? 0,
    channel: "SMS",
    recipient: smsRecipient(row.customer),
    draftMessage: draftMembershipRenewal({
      companyName: ctx.companyName,
      customer: row.customer,
      planName: row.plan.name,
      renewalDate: row.renewalDate,
      priceCents: row.priceCents,
    }),
    reason: `${row.plan.name} renews ${row.renewalDate ? daysUntil(row.renewalDate) + " days from now" : "soon"}.`,
    payload: { planName: row.plan.name, optedOut: isSmsOptedOut(row.customer) },
  }));
  const total = targets.reduce((sum, target) => sum + (target.amountCents ?? 0), 0);
  return prepareResult({
    executeActionKey: "membership.send_renewal",
    title: "Membership renewals",
    summary: `ContractorYou prepared ${targets.length} renewal message${targets.length === 1 ? "" : "s"}.`,
    targets,
    estimatedImpactCents: total,
    criteria: identified.criteria,
    preview: { count: targets.length },
    grounding: { sources: ["customer_memberships"] },
  });
}

async function draftGenericMessages(ctx: ActionContext, input: Record<string, unknown>) {
  let ids = Array.isArray(input.recordIds) ? (input.recordIds as string[]) : [];
  const purposeHint = String(input.purpose || "");
  if (ids.length === 0 && /running behind|running late|behind schedule/i.test(purposeHint)) {
    const now = new Date();
    const late = await prisma.job.findMany({
      where: {
        companyId: ctx.companyId,
        status: { in: ["SCHEDULED", "DISPATCHED"] },
        scheduledStart: { lt: now, gte: startOfDay(now) },
      },
      select: { customerId: true },
      take: 15,
    });
    ids = [...new Set(late.map((row) => row.customerId))];
  }
  const customers = await prisma.customer.findMany({
    where: { companyId: ctx.companyId, id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, secondaryPhone: true, tags: true },
  });
  const purpose = String(input.purpose || "Just checking in — reply if you need anything from our office.");
  const targets: ActionTargetDraft[] = customers.map((customer) => ({
    recordType: "CUSTOMER",
    recordId: customer.id,
    customerId: customer.id,
    customerName: customerDisplayName(customer),
    channel: "SMS",
    recipient: smsRecipient(customer),
    draftMessage: draftGenericSms({ companyName: ctx.companyName, customer, purpose }),
    reason: "Requested SMS draft.",
    payload: { optedOut: isSmsOptedOut(customer) },
  }));
  return prepareResult({
    executeActionKey: "communication.send_sms",
    title: "Draft texts",
    summary: `ContractorYou prepared ${targets.length} text${targets.length === 1 ? "" : "s"}.`,
    targets,
    preview: { count: targets.length },
    grounding: { sources: ["customers"] },
  });
}

async function draftReviews(ctx: ActionContext, input: Record<string, unknown>) {
  const ids = Array.isArray(input.recordIds) ? (input.recordIds as string[]) : [];
  const jobs = await prisma.job.findMany({
    where: { companyId: ctx.companyId, id: { in: ids }, status: "COMPLETED" },
    select: {
      id: true,
      jobNumber: true,
      customer: {
        select: { id: true, firstName: true, lastName: true, businessName: true, phone: true, secondaryPhone: true, tags: true },
      },
    },
  });
  const targets: ActionTargetDraft[] = jobs.map((job) => ({
    recordType: "REVIEW",
    recordId: job.id,
    customerId: job.customer.id,
    customerName: customerDisplayName(job.customer),
    channel: "SMS",
    recipient: smsRecipient(job.customer),
    draftMessage: draftReviewRequest({ companyName: ctx.companyName, customer: job.customer }),
    reason: `${job.jobNumber} is completed and meets the review-request rules.`,
    payload: { jobNumber: job.jobNumber, optedOut: isSmsOptedOut(job.customer) },
  }));
  return prepareResult({
    executeActionKey: "review.send_request",
    title: "Review requests",
    summary: `ContractorYou prepared ${targets.length} review request${targets.length === 1 ? "" : "s"}. HighLevel Reviews must be authorized before anything can be sent.`,
    targets,
    preview: { count: targets.length, reviewsAuthorizedRequired: true },
    grounding: { sources: ["jobs"] },
  });
}

async function draftSocial(ctx: ActionContext, input: Record<string, unknown>) {
  const channel = typeof input.channel === "string" ? input.channel : "FACEBOOK";
  const body =
    typeof input.body === "string" && input.body.trim()
      ? input.body.trim()
      : draftSocialPost({ companyName: ctx.companyName, topic: typeof input.topic === "string" ? input.topic : null });
  const scheduledAt = typeof input.scheduledAt === "string" ? input.scheduledAt : null;
  const post = await prisma.socialPost.create({
    data: {
      companyId: ctx.companyId,
      channel,
      provider: "draft",
      status: "DRAFT",
      body,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    },
  });
  return prepareResult({
    executeActionKey: "social.schedule_post",
    title: "Social post draft",
    summary: `Draft ready for ${channel.replaceAll("_", " ")}. Nothing has been published.`,
    targets: [
      {
        recordType: "SOCIAL",
        recordId: post.id,
        draftMessage: body,
        reason: scheduledAt ? `Suggested time: ${scheduledAt}` : "Draft only until you approve a schedule.",
        payload: { channel, scheduledAt },
      },
    ],
    preview: { channel, scheduledAt, body },
    grounding: { sources: ["social_posts"] },
  });
}

async function proposeAssignments(ctx: ActionContext, input: Record<string, unknown>) {
  const when = input.when === "today" || input.when === "tomorrow" ? input.when : "tomorrow";
  const now = new Date();
  const day = when === "today" ? now : addDays(now, 1);
  const requested = Array.isArray(input.recordIds) ? (input.recordIds as string[]) : [];
  const jobs = await prisma.job.findMany({
    where: {
      companyId: ctx.companyId,
      status: { in: ["NEW", "UNSCHEDULED", "SCHEDULED"] },
      assignments: { none: {} },
      ...(requested.length ? { id: { in: requested } } : { scheduledStart: { gte: startOfDay(day), lte: endOfDay(day) } }),
    },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      scheduledStart: true,
      customer: { select: { firstName: true, lastName: true } },
    },
    take: 15,
  });
  const techs = await prisma.membership.findMany({
    where: { companyId: ctx.companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  const load = await prisma.jobAssignment.findMany({
    where: {
      userId: { in: techs.map((tech) => tech.userId) },
      job: { companyId: ctx.companyId, scheduledStart: { gte: startOfDay(day), lte: endOfDay(day) } },
    },
    select: { userId: true },
  });
  const counts = new Map<string, number>();
  for (const row of load) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  const targets: ActionTargetDraft[] = jobs.map((job) => {
    const ranked = [...techs].sort((a, b) => (counts.get(a.userId) ?? 0) - (counts.get(b.userId) ?? 0));
    const pick = ranked[0];
    const name = pick ? `${pick.user.firstName} ${pick.user.lastName}` : null;
    if (pick) counts.set(pick.userId, (counts.get(pick.userId) ?? 0) + 1);
    return {
      recordType: "JOB" as const,
      recordId: job.id,
      customerName: customerDisplayName(job.customer),
      reason: pick
        ? `${name} has the lightest ${when} board among available technicians${job.jobType ? ` and can take ${job.jobType}` : ""}.`
        : "No active technician is available to recommend.",
      payload: {
        technicianUserId: pick?.userId ?? null,
        technicianName: name,
        jobNumber: job.jobNumber,
        jobType: job.jobType,
        scheduledStart: job.scheduledStart,
      },
    };
  });
  return prepareResult({
    executeActionKey: "job.assign",
    title: "Proposed dispatch changes",
    summary:
      targets.length === 0
        ? `No unassigned jobs for ${when}.`
        : `${targets.length} unassigned job${targets.length === 1 ? "" : "s"} with recommended technicians. Nothing has been moved.`,
    targets,
    preview: { when, count: targets.length },
    grounding: { sources: ["jobs", "job_assignments"] },
  });
}

async function prepareTasks(ctx: ActionContext, input: Record<string, unknown>) {
  const limit = typeof input.limit === "number" ? input.limit : 5;
  const recordType = typeof input.recordType === "string" ? input.recordType : "ESTIMATE";
  let assigneeId = typeof input.assignedToUserId === "string" ? input.assignedToUserId : null;
  const assigneeQuery = typeof input.assigneeQuery === "string" ? input.assigneeQuery.trim() : "";
  if (!assigneeId && assigneeQuery) {
    const member = await prisma.membership.findFirst({
      where: {
        companyId: ctx.companyId,
        status: "ACTIVE",
        user: {
          OR: [
            { firstName: { contains: assigneeQuery, mode: "insensitive" } },
            { lastName: { contains: assigneeQuery, mode: "insensitive" } },
          ],
        },
      },
      select: { userId: true, user: { select: { firstName: true, lastName: true } } },
    });
    assigneeId = member?.userId ?? null;
  }
  const assignee = assigneeId
    ? await prisma.user.findFirst({
        where: { id: assigneeId, memberships: { some: { companyId: ctx.companyId } } },
        select: { id: true, firstName: true, lastName: true },
      })
    : null;
  let sourceIds = Array.isArray(input.recordIds) ? (input.recordIds as string[]) : [];
  let labels: { id: string; title: string; amountCents?: number; customerName?: string }[] = [];
  if (recordType === "ESTIMATE") {
    const identified = sourceIds.length ? null : await identifyEstimateFollowups(ctx, {});
    sourceIds = sourceIds.length ? sourceIds : (identified?.recordIds ?? []).slice(0, limit);
    const rows = await prisma.estimate.findMany({
      where: { companyId: ctx.companyId, id: { in: sourceIds } },
      select: {
        id: true,
        estimateNumber: true,
        totalCents: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { totalCents: "desc" },
      take: limit,
    });
    labels = rows.map((row) => ({
      id: row.id,
      title: `Call ${customerDisplayName(row.customer)} about ${row.estimateNumber}`,
      amountCents: row.totalCents,
      customerName: customerDisplayName(row.customer),
    }));
  }
  const dueAt = typeof input.dueAt === "string" ? input.dueAt : addDays(new Date(), 1).toISOString();
  const targets: ActionTargetDraft[] = labels.map((row) => ({
    recordType: "TASK",
    recordId: row.id,
    customerName: row.customerName,
    amountCents: row.amountCents,
    draftMessage: row.title,
    reason: `Internal follow-up task${assignee ? ` for ${assignee.firstName} ${assignee.lastName}` : ""}.`,
    payload: {
      assignedToUserId: assignee?.id ?? null,
      assigneeName: assignee ? `${assignee.firstName} ${assignee.lastName}` : null,
      dueAt,
      relatedType: recordType,
      relatedId: row.id,
    },
  }));
  return prepareResult({
    executeActionKey: "task.create",
    title: "Office task plan",
    summary:
      targets.length === 0
        ? "No tasks to create from the current records."
        : `${targets.length} internal task${targets.length === 1 ? "" : "s"} ready. Nothing is created until you approve.`,
    targets,
    estimatedImpactCents: targets.reduce((sum, target) => sum + (target.amountCents ?? 0), 0),
    preview: { count: targets.length, assignee: assignee ? `${assignee.firstName} ${assignee.lastName}` : null },
    grounding: { sources: ["estimates"] },
  });
}
