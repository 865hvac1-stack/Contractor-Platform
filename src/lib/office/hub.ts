import { startOfDay, endOfDay, isToday } from "date-fns";
import { prisma } from "@/lib/db";
import { getNeedsAttention } from "@/lib/attention";
import { prioritizeAttention } from "@/lib/attention-priority";
import { getScheduleJobs } from "@/lib/dashboard";
import { isHighLevelConnected } from "@/lib/highlevel/connection";
import { formatMoney } from "@/lib/money";
import { customerLabel } from "@/lib/tech/today";
import { buildOfficeAttentionCategories, officeAttentionTypes } from "@/lib/office/attention-categories";
import { buildOfficeIntelligence } from "@/lib/office/intelligence";
import { buildOfficePipeline } from "@/lib/office/pipeline";

export type OfficeScorecard = {
  label: string;
  value: string;
  context?: string;
  href: string;
};

export type OfficeRecentCustomer = {
  id: string;
  name: string;
  phone: string | null;
  property: { id: string; label: string } | null;
  membership: { id: string; planName: string; href: string } | null;
  context: { text: string; href: string; kind: "job" | "estimate" | "invoice" | "activity" } | null;
};

export type OfficeUpcomingJob = {
  id: string;
  status: string;
  jobType: string | null;
  jobNumber: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  customer: { id: string; name: string };
  property: { id: string; label: string } | null;
  technician: { id: string; name: string } | null;
  dispatchHref: string;
};

export type OfficeCommunicationItem = {
  id: string;
  name: string;
  preview: string | null;
  lastActivityAt: Date;
  unread: boolean;
  customerId: string | null;
  href: string;
};

export async function getOfficeHubData(companyId: string) {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const followUpCutoff = new Date();
  followUpCutoff.setDate(followUpCutoff.getDate() - 3);

  const [
    callsToday,
    missedCallsOpen,
    newLeadsToday,
    jobsBookedToday,
    followUpEstimates,
    openEstimatesAgg,
    approvedNotScheduledAgg,
    overdueInvoicesAgg,
    unansweredLeads,
    pipelineNewLeads,
    pipelineContacted,
    pipelineBooked,
    upcomingJobs,
    attention,
    highlevelConnected,
    recentCustomersRaw,
    commThreads,
    unreadThreads,
    missedCallThreads,
  ] = await Promise.all([
    prisma.callRecord.count({
      where: { companyId, startedAt: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.callRecord.count({
      where: { companyId, missed: true, booked: { not: true } },
    }),
    prisma.lead.count({
      where: { companyId, receivedAt: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.job.count({
      where: {
        companyId,
        createdAt: { gte: dayStart, lte: dayEnd },
        status: { not: "CANCELED" },
      },
    }),
    prisma.estimate.findMany({
      where: {
        companyId,
        status: { in: ["SENT", "VIEWED"] },
        OR: [{ followUpAt: { lte: now } }, { followUpAt: null, issueDate: { lte: followUpCutoff } }],
      },
      select: { totalCents: true },
    }),
    prisma.estimate.aggregate({
      where: { companyId, status: { in: ["DRAFT", "SENT", "VIEWED"] } },
      _count: true,
      _sum: { totalCents: true },
    }),
    prisma.estimate.aggregate({
      where: {
        companyId,
        status: "APPROVED",
        OR: [
          { linkedJob: null, jobId: null },
          { linkedJob: { status: { in: ["NEW", "UNSCHEDULED"] } } },
          { job: { status: { in: ["NEW", "UNSCHEDULED"] } } },
        ],
      },
      _count: true,
      _sum: { totalCents: true },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
        dueDate: { lt: now },
      },
      _count: true,
      _sum: { balanceCents: true },
    }),
    prisma.lead.count({
      where: {
        companyId,
        firstRespondedAt: null,
        status: { in: ["NEW", "CONTACTED"] },
      },
    }),
    prisma.lead.count({ where: { companyId, status: "NEW" } }),
    prisma.lead.count({ where: { companyId, status: "CONTACTED" } }),
    prisma.lead.count({ where: { companyId, status: "BOOKED" } }),
    getScheduleJobs(companyId, "today"),
    getNeedsAttention(companyId),
    isHighLevelConnected(prisma, companyId),
    prisma.customer.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        businessName: true,
        phone: true,
        updatedAt: true,
        properties: {
          take: 1,
          orderBy: [{ isPrimary: "desc" }, { address: "asc" }],
          select: { id: true, address: true, city: true, state: true, zip: true },
        },
        customerMemberships: {
          where: { status: "ACTIVE" },
          take: 1,
          select: { id: true, plan: { select: { name: true } } },
        },
        jobs: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            jobNumber: true,
            status: true,
            jobType: true,
            completedAt: true,
            scheduledStart: true,
            updatedAt: true,
          },
        },
        estimates: {
          where: { status: { in: ["SENT", "VIEWED"] } },
          orderBy: { totalCents: "desc" },
          take: 1,
          select: { id: true, estimateNumber: true, totalCents: true, status: true },
        },
        invoices: {
          where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, balanceCents: { gt: 0 } },
          orderBy: { balanceCents: "desc" },
          take: 1,
          select: { id: true, invoiceNumber: true, balanceCents: true, status: true },
        },
      },
    }),
    prisma.communicationThread.findMany({
      where: { companyId },
      orderBy: { lastActivityAt: "desc" },
      take: 5,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.communicationThread.count({ where: { companyId, unread: true } }),
    prisma.callRecord.count({
      where: { companyId, missed: true, booked: { not: true }, startedAt: { gte: dayStart, lte: dayEnd } },
    }),
  ]);

  const rankedAttention = prioritizeAttention(attention);
  const officeAttention = rankedAttention.filter((item) => officeAttentionTypes().has(item.type));
  const attentionCategories = buildOfficeAttentionCategories(officeAttention);

  const followUpCount = followUpEstimates.length;
  const followUpValueCents = followUpEstimates.reduce((sum, row) => sum + row.totalCents, 0);
  const approvedNotScheduled = approvedNotScheduledAgg._count ?? 0;
  const approvedValueCents = approvedNotScheduledAgg._sum?.totalCents ?? 0;
  const overdueCount = overdueInvoicesAgg._count ?? 0;
  const overdueBalanceCents = overdueInvoicesAgg._sum?.balanceCents ?? 0;
  const openEstimateCount = openEstimatesAgg._count ?? 0;
  const openEstimateValueCents = openEstimatesAgg._sum?.totalCents ?? 0;

  const todayDate = dayStart.toISOString().slice(0, 10);
  const scorecards: OfficeScorecard[] = [
    {
      label: "Calls today",
      value: String(callsToday),
      context: missedCallThreads > 0 ? `${missedCallThreads} missed today` : "Recorded call activity",
      href: "/marketing/communications?filter=today",
    },
    {
      label: "New leads",
      value: String(newLeadsToday),
      context: "Received today",
      href: "/marketing/leads?status=NEW",
    },
    {
      label: "Jobs booked",
      value: String(jobsBookedToday),
      context: "Created today",
      href: "/jobs?when=today",
    },
    {
      label: "Follow-ups due",
      value: String(followUpCount),
      context: followUpValueCents > 0 ? `${formatMoney(followUpValueCents)} opportunity` : "Estimates awaiting follow-up",
      href: "/attention?filter=follow_ups",
    },
    {
      label: "Open estimates",
      value: String(openEstimateCount),
      context: openEstimateValueCents > 0 ? formatMoney(openEstimateValueCents) : "Awaiting decision",
      href: "/estimates?status=open",
    },
    {
      label: "Approved — not scheduled",
      value: String(approvedNotScheduled),
      context: approvedValueCents > 0 ? formatMoney(approvedValueCents) : "Needs scheduling",
      href: "/estimates?status=approved",
    },
    {
      label: "Overdue A/R",
      value: overdueCount > 0 ? formatMoney(overdueBalanceCents) : "$0",
      context: `${overdueCount} invoice${overdueCount === 1 ? "" : "s"}`,
      href: "/invoices?status=overdue",
    },
    {
      label: "Missed / unanswered",
      value: String(missedCallsOpen + unansweredLeads),
      context: [
        missedCallsOpen > 0 ? `${missedCallsOpen} missed call${missedCallsOpen === 1 ? "" : "s"}` : null,
        unansweredLeads > 0 ? `${unansweredLeads} unanswered lead${unansweredLeads === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "No missed calls or unanswered leads",
      href: missedCallsOpen > 0 ? "/marketing/communications?filter=missed" : "/marketing/leads?status=NEW",
    },
    {
      label: "Upcoming jobs",
      value: String(upcomingJobs.length),
      context: "Scheduled today",
      href: `/dispatch?date=${todayDate}`,
    },
  ];

  const pipeline = buildOfficePipeline({
    newLeads: pipelineNewLeads,
    contactedLeads: pipelineContacted,
    bookedLeads: pipelineBooked,
    estimateFollowUp: followUpCount,
    approvedNotScheduled,
    paymentFollowUp: overdueCount,
  });

  const intelligence = buildOfficeIntelligence({
    followUpCount,
    followUpValueCents,
    approvedNotScheduled,
    approvedValueCents,
    overdueBalanceCents,
    overdueCount,
    unansweredLeads,
  });

  const recentCustomers: OfficeRecentCustomer[] = recentCustomersRaw.map((customer) => {
    const property = customer.properties[0];
    const membership = customer.customerMemberships[0];
    const job = customer.jobs[0];
    const estimate = customer.estimates[0];
    const invoice = customer.invoices[0];

    let context: OfficeRecentCustomer["context"] = null;
    if (job?.completedAt && isToday(job.completedAt)) {
      context = { text: "Job completed today", href: `/jobs/${job.id}`, kind: "job" };
    } else if (job?.scheduledStart && isToday(job.scheduledStart)) {
      context = {
        text: `${job.jobType || job.jobNumber} scheduled today`,
        href: `/jobs/${job.id}`,
        kind: "job",
      };
    } else if (estimate) {
      context = {
        text: `Estimate awaiting decision · ${formatMoney(estimate.totalCents)}`,
        href: `/estimates/${estimate.id}`,
        kind: "estimate",
      };
    } else if (invoice) {
      context = {
        text: `Open balance · ${formatMoney(invoice.balanceCents)}`,
        href: `/invoices/${invoice.id}`,
        kind: "invoice",
      };
    } else {
      context = {
        text: `Active ${customer.updatedAt.toLocaleDateString()}`,
        href: `/office/customers/${customer.id}`,
        kind: "activity",
      };
    }

    return {
      id: customer.id,
      name: customerLabel(customer),
      phone: customer.phone,
      property: property
        ? {
            id: property.id,
            label: `${property.address}, ${property.city}`,
          }
        : null,
      membership: membership
        ? { id: membership.id, planName: membership.plan.name, href: `/memberships?customerId=${customer.id}` }
        : null,
      context,
    };
  });

  const todayUpcoming: OfficeUpcomingJob[] = upcomingJobs.slice(0, 8).map((job) => {
    const tech = job.assignments[0]?.user;
    return {
      id: job.id,
      status: job.status,
      jobType: job.jobType,
      jobNumber: job.jobNumber,
      scheduledStart: job.scheduledStart,
      scheduledEnd: job.scheduledEnd,
      customer: {
        id: job.customer.id,
        name: customerLabel(job.customer),
      },
      property: job.property
        ? {
            id: job.property.id,
            label: `${job.property.address}, ${job.property.city}`,
          }
        : null,
      technician: tech
        ? { id: tech.id, name: `${tech.firstName} ${tech.lastName}`.trim() }
        : null,
      dispatchHref: `/dispatch?date=${job.scheduledStart ? job.scheduledStart.toISOString().slice(0, 10) : todayDate}`,
    };
  });

  const communications: OfficeCommunicationItem[] = commThreads.map((thread) => {
    const name = thread.customer
      ? customerLabel(thread.customer)
      : thread.lead
        ? `${thread.lead.firstName} ${thread.lead.lastName}`.trim()
        : thread.contactName || thread.phone || "Conversation";
    return {
      id: thread.id,
      name,
      preview: thread.lastPreview,
      lastActivityAt: thread.lastActivityAt,
      unread: thread.unread,
      customerId: thread.customerId,
      href: `/marketing/communications/${thread.id}`,
    };
  });

  return {
    generatedAt: now,
    scorecards,
    attentionCategories,
    attentionItems: officeAttention.slice(0, 8),
    pipeline,
    recentCustomers,
    todayUpcoming,
    communications,
    intelligence,
    incomingCall: {
      active: false as const,
      highlevelConnected,
      missedCallsOpen,
    },
    commsSummary: {
      unreadThreads,
      missedCallsOpen,
      recentCount: communications.length,
    },
  };
}
