import { prisma } from "@/lib/db";
import { customerLabel } from "@/lib/tech/today";
import { formatDurationMinutes, formatLeadStamp, leadDisplayName } from "@/lib/leads/format";
import { leadNeedsFollowUp } from "@/lib/leads/follow-up";
import {
  buildLeadInsights,
  summarizeLeadFacts,
  type LeadVerifiedFacts,
} from "@/lib/leads/insights";
import { matchCustomerForLead } from "@/lib/leads/matching";

export type LeadTimelineItem = {
  id: string;
  at: Date;
  kind: string;
  title: string;
  body?: string | null;
  actor?: string | null;
  href?: string | null;
};

export async function loadLead360(companyId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
    include: {
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          phone: true,
          email: true,
        },
      },
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      estimate: {
        select: {
          id: true,
          estimateNumber: true,
          status: true,
          totalCents: true,
          issueDate: true,
          approvedAt: true,
          declinedAt: true,
          updatedAt: true,
        },
      },
      job: {
        select: {
          id: true,
          jobNumber: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
        },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 80,
        include: { actor: { select: { firstName: true, lastName: true } } },
      },
      attributionEvents: { orderBy: { createdAt: "desc" }, take: 10 },
      campaign: { select: { id: true, name: true } },
    },
  });
  if (!lead) return null;

  const [threads, calls, members] = await Promise.all([
    prisma.communicationThread.findMany({
      where: {
        companyId,
        OR: [
          { leadId: lead.id },
          ...(lead.customerId ? [{ customerId: lead.customerId }] : []),
          ...(lead.phone ? [{ phone: lead.phone }] : []),
          ...(lead.email ? [{ email: lead.email }] : []),
        ],
      },
      orderBy: { lastActivityAt: "desc" },
      take: 8,
      include: {
        messages: { orderBy: { occurredAt: "desc" }, take: 4 },
      },
    }),
    prisma.callRecord.findMany({
      where: {
        companyId,
        OR: [
          { leadId: lead.id },
          ...(lead.customerId ? [{ customerId: lead.customerId }] : []),
        ],
      },
      orderBy: { startedAt: "desc" },
      take: 8,
    }),
    prisma.membership.findMany({
      where: { companyId, status: "ACTIVE" },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const inboundUnanswered = threads.some((thread) => {
    const latest = thread.messages[0];
    return latest?.direction === "inbound" && !lead.firstRespondedAt;
  });
  const lastInbound = threads
    .flatMap((thread) => thread.messages)
    .filter((message) => message.direction === "inbound")
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

  const outboundTimes = [
    ...threads.flatMap((thread) =>
      thread.messages.filter((message) => message.direction === "outbound").map((message) => message.occurredAt)
    ),
    ...calls.filter((call) => call.direction === "outbound").map((call) => call.startedAt),
    lead.lastContactAt,
    lead.firstRespondedAt,
  ].filter((value): value is Date => Boolean(value));
  const firstContactAttempt = outboundTimes.length
    ? outboundTimes.reduce((earliest, value) => (value < earliest ? value : earliest))
    : null;

  const facts: LeadVerifiedFacts = {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    status: lead.status,
    source: lead.source,
    receivedAt: lead.receivedAt,
    firstRespondedAt: lead.firstRespondedAt,
    lastContactAt: lead.lastContactAt,
    nextAction: lead.nextAction,
    nextActionAt: lead.nextActionAt,
    assignedName: lead.assignedUser
      ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`.trim()
      : null,
    opportunityCents: lead.estimatedOpportunityCents,
    customerName: lead.customer ? customerLabel(lead.customer) : null,
    estimateNumber: lead.estimate?.estimateNumber ?? null,
    estimateStatus: lead.estimate?.status ?? null,
    estimateUpdatedAt: lead.estimate?.updatedAt ?? null,
    inboundUnanswered,
    lastInboundPreview: lastInbound?.body ?? null,
  };

  const followUp = leadNeedsFollowUp(facts);
  const match = lead.customerId
    ? null
    : await matchCustomerForLead(companyId, { email: lead.email, phone: lead.phone });

  const timeline = buildLeadTimeline({ lead, threads, calls });

  return {
    lead,
    threads,
    calls,
    members: members.map((membership) => ({
      id: membership.user.id,
      name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
    })),
    facts,
    insights: buildLeadInsights(facts),
    summary: summarizeLeadFacts(facts),
    followUp,
    match: match
      ? {
          id: match.customer.id,
          name: customerLabel(match.customer),
          matchedOn: match.matchedOn,
        }
      : null,
    timeline,
    speed: {
      createdAt: lead.receivedAt,
      firstContactAttempt,
      firstResponse: lead.firstRespondedAt,
      speedToLeadMs:
        firstContactAttempt != null ? firstContactAttempt.getTime() - lead.receivedAt.getTime() : null,
      noContactAttempt: firstContactAttempt == null,
    },
    lastCall: calls[0] ?? null,
    primaryThread: threads[0] ?? null,
  };
}

function actorName(actor?: { firstName: string; lastName: string } | null) {
  if (!actor) return null;
  return `${actor.firstName} ${actor.lastName}`.trim();
}

function buildLeadTimeline(input: {
  lead: {
    id: string;
    receivedAt: Date;
    source: string;
    sourceDetail?: string | null;
    assignedUser?: { firstName: string; lastName: string } | null;
    customer?: { id: string; firstName: string; lastName: string; businessName: string | null } | null;
    estimate?: { id: string; estimateNumber: string; status: string; approvedAt: Date | null } | null;
    job?: { id: string; jobNumber: string; scheduledStart: Date | null } | null;
    convertedAt?: Date | null;
    activities: {
      id: string;
      createdAt: Date;
      kind: string;
      body?: string | null;
      actor?: { firstName: string; lastName: string } | null;
    }[];
  };
  threads: {
    id: string;
    channel: string;
    messages: {
      id: string;
      occurredAt: Date;
      direction: string;
      kind: string;
      body?: string | null;
      channel: string;
    }[];
  }[];
  calls: {
    id: string;
    startedAt: Date;
    direction: string;
    missed?: boolean | null;
    answered?: boolean | null;
    recordingRef?: string | null;
    caller?: string | null;
  }[];
}): LeadTimelineItem[] {
  const items: LeadTimelineItem[] = [
    {
      id: "created",
      at: input.lead.receivedAt,
      kind: "SYSTEM",
      title: "Lead created",
      body: input.lead.sourceDetail ? `Source detail: ${input.lead.sourceDetail}` : `Source captured.`,
    },
  ];

  if (input.lead.assignedUser) {
    items.push({
      id: "assigned",
      at: input.lead.receivedAt,
      kind: "ASSIGNMENT",
      title: "Assigned",
      body: actorName(input.lead.assignedUser),
    });
  }

  for (const activity of input.lead.activities) {
    items.push({
      id: activity.id,
      at: activity.createdAt,
      kind: activity.kind,
      title: activity.kind.replaceAll("_", " "),
      body: activity.body,
      actor: actorName(activity.actor),
    });
  }

  for (const thread of input.threads) {
    for (const message of thread.messages) {
      const channel = message.channel || thread.channel;
      items.push({
        id: `msg-${message.id}`,
        at: message.occurredAt,
        kind: channel.toUpperCase(),
        title:
          message.direction === "inbound"
            ? "Customer reply"
            : channel === "email"
              ? "Email"
              : channel === "sms"
                ? "SMS"
                : channel,
        body: message.body,
        href: `/marketing/communications/${thread.id}`,
      });
    }
  }

  for (const call of input.calls) {
    items.push({
      id: `call-${call.id}`,
      at: call.startedAt,
      kind: "CALL",
      title: call.missed ? "Missed call" : call.answered ? "Call" : "Call",
      body: [call.direction, call.caller, call.recordingRef ? "Voicemail/recording on file" : null]
        .filter(Boolean)
        .join(" · "),
    });
  }

  if (input.lead.estimate) {
    items.push({
      id: `est-${input.lead.estimate.id}`,
      at: input.lead.estimate.approvedAt ?? input.lead.receivedAt,
      kind: "ESTIMATE",
      title:
        input.lead.estimate.status === "APPROVED"
          ? "Estimate approved"
          : input.lead.estimate.status === "SENT"
            ? "Estimate sent"
            : "Estimate created",
      body: input.lead.estimate.estimateNumber,
      href: `/estimates/${input.lead.estimate.id}`,
    });
  }

  if (input.lead.job) {
    items.push({
      id: `job-${input.lead.job.id}`,
      at: input.lead.job.scheduledStart ?? input.lead.receivedAt,
      kind: "APPOINTMENT",
      title: input.lead.job.scheduledStart ? "Appointment scheduled" : "Job created",
      body: input.lead.job.jobNumber,
      href: `/jobs/${input.lead.job.id}`,
    });
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, 60);
}

export function speedToLeadLabel(ms: number | null) {
  if (ms == null) return null;
  return formatDurationMinutes(Math.max(0, ms));
}

export function speedStamp(value: Date | null) {
  return value ? formatLeadStamp(value) : null;
}

export { leadDisplayName };
