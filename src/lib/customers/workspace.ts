import { differenceInCalendarDays, differenceInMonths, format, subMonths } from "date-fns";
import type { CompanyRole, EstimateStatus, JobStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getNeedsAttention } from "@/lib/attention";
import { factLabel, propertyImagePriority } from "@/lib/properties/enrichment";
import { JOB_PHOTO_KINDS } from "@/lib/tech/photos";

const OPEN_JOB: JobStatus[] = ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD"];
const OPEN_ESTIMATE: EstimateStatus[] = ["DRAFT", "SENT", "VIEWED"];
const OPEN_INVOICE = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

function nameOf(customer: { firstName: string; lastName: string; businessName: string | null }) {
  return customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();
}

export type Customer360Options = {
  companyId: string;
  customerId: string;
  propertyId?: string | null;
  role: CompanyRole;
  userId: string;
};

export async function getCustomer360(input: Customer360Options) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId },
    include: {
      properties: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      customerMemberships: {
        include: { plan: { select: { name: true, benefits: true, includedVisits: true } } },
        orderBy: { saleDate: "desc" },
      },
    },
  });
  if (!customer) return null;

  const selected =
    customer.properties.find((row) => row.id === input.propertyId) ??
    customer.properties.find((row) => row.isPrimary) ??
    customer.properties[0] ??
    null;

  const canSeeMoney = can(input.role, "invoices:view") && !can(input.role, "jobs:assigned_only");
  const propertyFilter = selected ? { propertyId: selected.id } : {};

  const [
    equipment,
    recentJobs,
    jobCount,
    openJobCount,
    openEstimateCount,
    completedCount,
    completedAtProperty,
    openEstimates,
    invoices,
    payments,
    photos,
    notes,
    threads,
    calls,
    attentionAll,
    invoiceTotals,
    overdueTotals,
    collectedTotals,
    waitingRecords,
  ] = await Promise.all([
    prisma.equipment.findMany({
      where: { companyId: input.companyId, customerId: customer.id, ...(selected ? { propertyId: selected.id } : {}) },
      orderBy: { installDate: "asc" },
      take: 20,
    }),
    prisma.job.findMany({
      where: { companyId: input.companyId, customerId: customer.id, ...propertyFilter },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        property: { select: { address: true, city: true } },
        assignments: { include: { user: { select: { firstName: true, lastName: true } } }, take: 1 },
        invoices: { select: { totalCents: true, status: true }, take: 1 },
      },
    }),
    prisma.job.count({ where: { companyId: input.companyId, customerId: customer.id } }),
    prisma.job.count({
      where: { companyId: input.companyId, customerId: customer.id, status: { in: OPEN_JOB } },
    }),
    prisma.estimate.count({
      where: { companyId: input.companyId, customerId: customer.id, status: { in: OPEN_ESTIMATE } },
    }),
    prisma.job.count({
      where: { companyId: input.companyId, customerId: customer.id, status: "COMPLETED" },
    }),
    selected
      ? prisma.job.count({
          where: {
            companyId: input.companyId,
            customerId: customer.id,
            propertyId: selected.id,
            status: "COMPLETED",
          },
        })
      : Promise.resolve(0),
    prisma.estimate.findMany({
      where: { companyId: input.companyId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        estimateNumber: true,
        status: true,
        totalCents: true,
        issueDate: true,
        updatedAt: true,
        propertyId: true,
      },
    }),
    prisma.invoice.findMany({
      where: { companyId: input.companyId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalCents: true,
        balanceCents: true,
        dueDate: true,
        createdAt: true,
        propertyId: true,
        importMode: true,
        sourceSystem: true,
      },
    }),
    canSeeMoney
      ? prisma.payment.findMany({
          where: { companyId: input.companyId, customerId: customer.id, status: { in: ["SUCCEEDED", "RECORDED", "CONFIRMED"] } },
          orderBy: { paidAt: "desc" },
          take: 8,
          select: { id: true, amountCents: true, paidAt: true, method: true, invoiceId: true, sourceSystem: true, importMode: true },
        })
      : Promise.resolve([]),
    prisma.jobPhoto.findMany({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        job: { customerId: customer.id, companyId: input.companyId, ...(selected ? { propertyId: selected.id } : {}) },
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true,
        kind: true,
        caption: true,
        createdAt: true,
        jobId: true,
        equipmentId: true,
        uploadedBy: { select: { firstName: true, lastName: true } },
        job: { select: { jobNumber: true, propertyId: true } },
      },
    }),
    prisma.customerNote.findMany({
      where: { companyId: input.companyId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { author: { select: { firstName: true, lastName: true } } },
    }),
    prisma.communicationThread.findMany({
      where: { companyId: input.companyId, customerId: customer.id },
      orderBy: { lastActivityAt: "desc" },
      take: 6,
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true, createdAt: true } },
      },
    }),
    prisma.callRecord.findMany({
      where: { companyId: input.companyId, customerId: customer.id },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    getNeedsAttention(input.companyId),
    canSeeMoney
      ? prisma.invoice.aggregate({
          where: { companyId: input.companyId, customerId: customer.id },
          _sum: { totalCents: true, balanceCents: true },
        })
      : Promise.resolve({ _sum: { totalCents: 0, balanceCents: 0 } }),
    canSeeMoney
      ? prisma.invoice.aggregate({
          where: {
            companyId: input.companyId,
            customerId: customer.id,
            balanceCents: { gt: 0 },
            dueDate: { lt: new Date() },
          },
          _sum: { balanceCents: true },
        })
      : Promise.resolve({ _sum: { balanceCents: 0 } }),
    canSeeMoney
      ? prisma.payment.aggregate({
          where: {
            companyId: input.companyId,
            customerId: customer.id,
            status: { in: ["SUCCEEDED", "RECORDED", "CONFIRMED"] },
          },
          _sum: { amountCents: true },
        })
      : Promise.resolve({ _sum: { amountCents: 0 } }),
    prisma.waitingRecord.findMany({
      where: { companyId: input.companyId, customerId: customer.id },
      include: {
        column: true,
        job: { select: { id: true, jobNumber: true } },
        transitions: { orderBy: { createdAt: "asc" }, take: 20 },
        communications: { orderBy: { createdAt: "asc" }, take: 20, select: { id: true, sentAt: true, kind: true } },
      },
      orderBy: { enteredAt: "desc" },
      take: 20,
    }),
  ]);

  const jobIds = new Set(recentJobs.map((job) => job.id));
  const estimateIds = new Set(openEstimates.map((row) => row.id));
  const invoiceIds = new Set(invoices.map((row) => row.id));
  const displayName = nameOf(customer);
  const attention = attentionAll
    .filter(
      (item) =>
        item.entityId === customer.id ||
        jobIds.has(item.entityId) ||
        estimateIds.has(item.entityId) ||
        invoiceIds.has(item.entityId) ||
        item.customerName === displayName
    )
    .slice(0, 6);

  const lifetimeInvoiced = invoiceTotals._sum.totalCents ?? 0;
  const outstanding = invoiceTotals._sum.balanceCents ?? 0;
  const overdue = overdueTotals._sum.balanceCents ?? 0;
  const lifetimeCollected = collectedTotals._sum.amountCents ?? 0;
  const openEstimateValue = openEstimates
    .filter((row) => OPEN_ESTIMATE.includes(row.status))
    .reduce((sum, row) => sum + row.totalCents, 0);

  const activeJobs = recentJobs.filter((job) => OPEN_JOB.includes(job.status) && job.importMode !== "HISTORICAL" && job.importMode !== "REFERENCE");
  const historyJobs = recentJobs.filter((job) => !OPEN_JOB.includes(job.status) || job.importMode === "HISTORICAL" || job.importMode === "REFERENCE");
  const activeMembership = customer.customerMemberships.find((row) => row.status === "ACTIVE") ?? null;

  const eighteenMonthsAgo = subMonths(new Date(), 18);
  const propertyJobs = selected
    ? await prisma.job.findMany({
        where: {
          companyId: input.companyId,
          customerId: customer.id,
          propertyId: selected.id,
          status: "COMPLETED",
          completedAt: { gte: eighteenMonthsAgo },
        },
        select: { id: true, jobType: true, completedAt: true, description: true },
        orderBy: { completedAt: "desc" },
        take: 40,
      })
    : [];

  const equipmentCards = equipment.map((item) => {
    const ageMonths = item.installDate ? differenceInMonths(new Date(), item.installDate) : null;
    const repairs = propertyJobs.filter((job) => {
      const hay = `${job.jobType ?? ""} ${job.description ?? ""}`.toLowerCase();
      const needle = (item.equipmentType || item.name).toLowerCase();
      return hay.includes("repair") || hay.includes(needle.split(" ")[0] ?? "x");
    });
    return {
      id: item.id,
      name: item.name,
      equipmentType: item.equipmentType,
      manufacturer: item.manufacturer,
      model: item.model,
      serialNumber: item.serialNumber,
      location: item.location,
      installDate: item.installDate,
      ageYears: ageMonths != null ? Math.floor(ageMonths / 12) : null,
      ageApproximate: Boolean(item.installDate),
      warrantyExpiresAt: item.warrantyExpiresAt,
      warrantyNotes: item.warrantyNotes,
      notes: item.notes,
      lastService: propertyJobs[0]?.completedAt ?? null,
      repairCount: repairs.length,
      repairs: repairs.slice(0, 4).map((job) => ({
        id: job.id,
        label: job.jobType || "Job",
        at: job.completedAt,
      })),
    };
  });

  const insights = buildCustomerInsights({
    equipment: equipmentCards,
    completedCount,
    activeMembership: Boolean(activeMembership),
    openReplacement: openEstimates.some(
      (row) => OPEN_ESTIMATE.includes(row.status) && /replace|install/i.test(row.estimateNumber)
    ),
    openEstimateValue: canSeeMoney ? openEstimateValue : 0,
    outstanding: canSeeMoney ? outstanding : 0,
  });

  const image = selected ? propertyImagePriority(selected) : { path: null, source: "NONE" as const, label: "No property on file" };
  const provenance = (selected?.factProvenance ?? {}) as Record<string, string>;

  const snapshot = selected
    ? [
        selected.yearBuilt
          ? {
              label: "Built",
              value: String(selected.yearBuilt),
              source: factLabel(provenance.yearBuilt || (selected.enrichmentStatus === "DEMO" ? "DEMO" : "COMPANY_ENTERED")),
            }
          : null,
        selected.squareFeet
          ? {
              label: "Size",
              value: `${selected.squareFeet.toLocaleString()} sq ft`,
              source: factLabel(provenance.squareFeet || (selected.enrichmentStatus === "DEMO" ? "DEMO" : "COMPANY_ENTERED")),
            }
          : null,
        selected.lastSalePriceCents
          ? {
              label: "Last recorded sale",
              value: `$${(selected.lastSalePriceCents / 100).toLocaleString("en-US")} · ${selected.lastSaleDate ? format(selected.lastSaleDate, "yyyy") : "date unknown"}`,
              source: factLabel(
                provenance.lastSalePriceCents || (selected.enrichmentStatus === "DEMO" ? "DEMO" : "COMPANY_ENTERED")
              ),
            }
          : null,
        { label: "Equipment", value: `${equipmentCards.length} asset${equipmentCards.length === 1 ? "" : "s"}`, source: "Company entered" },
        {
          label: "Service history",
          value: `${completedAtProperty} completed job${completedAtProperty === 1 ? "" : "s"}`,
          source: "Company entered",
        },
        canSeeMoney ? { label: "Lifetime collected", value: `$${(lifetimeCollected / 100).toLocaleString("en-US")}`, source: "Company entered" } : null,
      ].filter(Boolean)
    : [];

  const timeline = buildTimeline({
    customer,
    properties: customer.properties,
    jobs: recentJobs,
    estimates: openEstimates,
    invoices,
    payments,
    memberships: customer.customerMemberships,
    notes,
    photos,
    calls,
    threads,
    waiting: waitingRecords,
  }).slice(0, 40);

  return {
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      businessName: customer.businessName,
      displayName,
      phone: customer.phone,
      secondaryPhone: customer.secondaryPhone,
      email: customer.email,
      preferredContactMethod: customer.preferredContactMethod,
      status: customer.status,
      tags: customer.tags,
      source: customer.source,
      notes: customer.notes,
      createdAt: customer.createdAt,
    },
    properties: customer.properties.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      propertyType: row.propertyType,
      isPrimary: row.isPrimary,
      propertyClass: row.propertyClass,
      accessNotes: row.accessNotes,
    })),
    selectedProperty: selected
      ? {
          id: selected.id,
          name: selected.name,
          address: selected.address,
          city: selected.city,
          state: selected.state,
          zip: selected.zip,
          propertyType: selected.propertyType,
          isPrimary: selected.isPrimary,
          propertyClass: selected.propertyClass,
          accessNotes: selected.accessNotes,
          image,
          enrichmentLabel:
            selected.enrichmentStatus === "DEMO"
              ? "Synthetic demo facts — not from a live property provider"
              : selected.enrichmentStatus === "NONE" || !selected.enrichmentStatus
                ? "No property data provider connected"
                : `${selected.enrichmentProvider || "Provider"} · last updated ${
                    selected.enrichmentRetrievedAt ? format(selected.enrichmentRetrievedAt, "MMM d, yyyy") : "unknown"
                  }`,
        }
      : null,
    snapshot,
    glance: {
      openJobs: openJobCount,
      openEstimates: openEstimateCount,
      openEstimateCents: canSeeMoney ? openEstimateValue : null,
      balanceDueCents: canSeeMoney ? outstanding : null,
      lifetimeValueCents: canSeeMoney ? lifetimeCollected : null,
      membershipName: activeMembership?.plan.name ?? null,
    },
    membership: activeMembership
      ? {
          planName: activeMembership.plan.name,
          status: activeMembership.status,
          since: activeMembership.startDate || activeMembership.saleDate,
          renewal: activeMembership.renewalDate,
          visitsUsed: activeMembership.visitsUsed,
          includedVisits: activeMembership.plan.includedVisits,
          benefits: activeMembership.plan.benefits,
        }
      : null,
    maintenance: await (async () => {
      try {
        const { getCustomerMaintenanceSummary } = await import("@/lib/scheduling/maintenance");
        const summary = await getCustomerMaintenanceSummary(input.companyId, customer.id);
        return summary.next
          ? {
              planName: summary.next.planName,
              status: summary.next.status,
              label: summary.next.label,
              dueStart: summary.next.dueStart,
              dueEnd: summary.next.dueEnd,
              scheduledDate: summary.next.scheduledDate,
              jobId: summary.next.jobId,
              href: summary.next.jobId ? `/jobs/${summary.next.jobId}` : `/maintenance?status=${summary.next.status === "SCHEDULED" ? "scheduled" : "unscheduled"}`,
            }
          : activeMembership
            ? { planName: activeMembership.plan.name, status: "ACTIVE", href: "/maintenance" }
            : null;
      } catch {
        return null;
      }
    })(),
    membershipOpportunity:
      !activeMembership && completedCount >= 3
        ? { visits: completedCount, href: "/memberships" }
        : null,
    value: canSeeMoney
      ? {
          customerSince: customer.createdAt,
          lifetimeInvoiced,
          lifetimeCollected,
          outstanding,
          overdue,
          openEstimateValue,
          jobsCompleted: completedCount,
          properties: customer.properties.length,
          memberships: customer.customerMemberships.filter((row) => row.status === "ACTIVE").length,
        }
      : {
          customerSince: customer.createdAt,
          jobsCompleted: completedCount,
          properties: customer.properties.length,
          memberships: customer.customerMemberships.filter((row) => row.status === "ACTIVE").length,
        },
    canSeeMoney,
    attention,
    activeWaiting: waitingRecords
      .filter((row) => row.state === "ACTIVE")
      .map((row) => ({
        id: row.id,
        columnName: row.column.name,
        waitingFor: row.reason,
        enteredAt: row.enteredAt,
        nextCustomerUpdateAt: row.nextCustomerUpdateAt,
        jobNumber: row.job.jobNumber,
      })),
    insights,
    equipment: equipmentCards,
    activeWork: {
      jobs: activeJobs.map((job) => ({
        id: job.id,
        jobNumber: job.jobNumber,
        jobType: job.jobType,
        status: job.status,
        when: job.scheduledStart,
        technician: job.assignments[0]
          ? `${job.assignments[0].user.firstName} ${job.assignments[0].user.lastName}`
          : null,
        property: job.property?.address ?? "Unknown property",
      })),
      estimates: openEstimates
        .filter((row) => OPEN_ESTIMATE.includes(row.status))
        .map((row) => ({
          ...row,
          daysOld: differenceInCalendarDays(new Date(), row.issueDate),
        })),
      invoices: canSeeMoney
        ? invoices.filter(
            (row) =>
              OPEN_INVOICE.includes(row.status) &&
              row.balanceCents > 0 &&
              row.importMode !== "HISTORICAL" &&
              row.importMode !== "REFERENCE"
          )
        : [],
    },
    jobHistory: historyJobs.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      jobType: job.jobType,
      status: job.importMode === "HISTORICAL" || job.importMode === "REFERENCE" ? "HISTORICAL" : job.status,
      when: job.importedOccurredAt || job.completedAt || job.scheduledStart || job.createdAt,
      technician:
        job.importedTechnicianName ||
        (job.assignments[0] ? `${job.assignments[0].user.firstName} ${job.assignments[0].user.lastName}` : null),
      amountCents: canSeeMoney ? job.importedTotalCents ?? job.invoices[0]?.totalCents ?? null : null,
      property: job.property?.address ?? "Unknown property",
      historical: job.importMode === "HISTORICAL" || job.importMode === "REFERENCE",
      sourceSystem: job.sourceSystem,
    })),
    jobCount,
    estimates: openEstimates,
    invoices: canSeeMoney ? invoices : [],
    payments,
    photos: photos.map((photo) => ({
      ...photo,
      kindLabel: JOB_PHOTO_KINDS.find((kind) => kind.value === photo.kind)?.label ?? photo.kind,
    })),
    notes: notes.map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt,
      author: note.author ? `${note.author.firstName} ${note.author.lastName}` : "Team",
      propertyId: note.propertyId,
    })),
    communications: {
      threads: threads.map((thread) => ({
        id: thread.id,
        channel: thread.channel,
        last: thread.messages[0]?.body ?? null,
        at: thread.lastActivityAt,
      })),
      calls: calls.map((call) => ({
        id: call.id,
        missed: call.missed,
        at: call.startedAt,
        caller: call.caller,
        durationSeconds: call.durationSeconds,
      })),
    },
    timeline,
    mapsConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_ROUTES_API_KEY),
  };
}

function buildCustomerInsights(input: {
  equipment: { id: string; ageYears: number | null; repairCount: number; name: string }[];
  completedCount: number;
  activeMembership: boolean;
  openReplacement: boolean;
  openEstimateValue: number;
  outstanding: number;
}) {
  const rows: { id: string; title: string; detail: string }[] = [];
  for (const item of input.equipment) {
    if (item.ageYears != null && item.ageYears >= 12) {
      rows.push({
        id: `older-${item.id}`,
        title: "Older equipment",
        detail: `${item.name} is about ${item.ageYears} years old based on the recorded install date.`,
      });
    }
    if (item.repairCount >= 2) {
      rows.push({
        id: `repairs-${item.id}`,
        title: "Repeated repairs",
        detail: `${item.name} has ${item.repairCount} documented repair-related jobs in the last 18 months.`,
      });
    }
  }
  if (!input.activeMembership && input.completedCount >= 3) {
    rows.push({
      id: "membership-opportunity",
      title: "Membership opportunity",
      detail: `${input.completedCount} completed jobs and no active membership on file.`,
    });
  }
  if (input.openEstimateValue > 0) {
    rows.push({
      id: "open-estimate",
      title: "Open estimate",
      detail: `Open estimates total $${(input.openEstimateValue / 100).toLocaleString("en-US")}.`,
    });
  }
  if (input.outstanding > 0) {
    rows.push({
      id: "open-balance",
      title: "Open balance",
      detail: `Outstanding invoices total $${(input.outstanding / 100).toLocaleString("en-US")}.`,
    });
  }
  return rows.slice(0, 5);
}

function buildTimeline(input: {
  customer: { id: string; createdAt: Date; firstName: string };
  properties: { id: string; createdAt: Date; address: string }[];
  jobs: { id: string; jobNumber: string; status: string; createdAt: Date; completedAt: Date | null; scheduledStart: Date | null }[];
  estimates: { id: string; estimateNumber: string; status: string; issueDate: Date }[];
  invoices: { id: string; invoiceNumber: string; status: string; createdAt: Date }[];
  payments: { id: string; amountCents: number; paidAt: Date | null; invoiceId: string | null }[];
  memberships: { id: string; saleDate: Date; plan: { name: string } }[];
  notes: { id: string; createdAt: Date }[];
  photos: { id: string; createdAt: Date; job: { jobNumber: string } }[];
  calls: { id: string; startedAt: Date; missed: boolean | null }[];
  threads?: Array<{ id: string; channel: string; lastActivityAt: Date; messages?: Array<{ body: string | null }> }>;
  waiting?: Array<{
    id: string;
    enteredAt: Date;
    resolvedAt: Date | null;
    actualArrivalAt: Date | null;
    lastCustomerUpdateAt: Date | null;
    state: string;
    reason: string;
    metadata?: unknown;
    column: { name: string; key?: string };
    job: { id?: string; jobNumber: string };
    transitions?: Array<{ createdAt: Date; actions: unknown; note: string | null }>;
    communications?: Array<{ id: string; sentAt: Date | null; kind: string }>;
  }>;
}) {
  const events: { id: string; at: Date; kind: string; title: string; href?: string }[] = [
    { id: "created", at: input.customer.createdAt, kind: "customer", title: "Customer created", href: `/customers/${input.customer.id}` },
  ];
  for (const property of input.properties) {
    events.push({
      id: `prop-${property.id}`,
      at: property.createdAt,
      kind: "property",
      title: `Property added · ${property.address}`,
      href: `/customers/${input.customer.id}?propertyId=${property.id}`,
    });
  }
  for (const job of input.jobs) {
    events.push({
      id: `job-${job.id}`,
      at: job.completedAt || job.scheduledStart || job.createdAt,
      kind: "jobs",
      title: `${job.status === "COMPLETED" ? "Job completed" : "Job"} · ${job.jobNumber}`,
      href: `/jobs/${job.id}`,
    });
  }
  for (const estimate of input.estimates) {
    events.push({
      id: `est-${estimate.id}`,
      at: estimate.issueDate,
      kind: "sales",
      title: `Estimate ${estimate.status.toLowerCase()} · ${estimate.estimateNumber}`,
      href: `/estimates/${estimate.id}`,
    });
  }
  for (const invoice of input.invoices) {
    events.push({
      id: `inv-${invoice.id}`,
      at: invoice.createdAt,
      kind: "money",
      title: `Invoice ${invoice.status.toLowerCase()} · ${invoice.invoiceNumber}`,
      href: `/invoices/${invoice.id}`,
    });
  }
  for (const payment of input.payments) {
    if (!payment.paidAt) continue;
    events.push({
      id: `pay-${payment.id}`,
      at: payment.paidAt,
      kind: "money",
      title: `Payment received · $${(payment.amountCents / 100).toLocaleString("en-US")}`,
      href: payment.invoiceId ? `/invoices/${payment.invoiceId}` : "/payments",
    });
  }
  for (const membership of input.memberships) {
    events.push({
      id: `mem-${membership.id}`,
      at: membership.saleDate,
      kind: "memberships",
      title: `${membership.plan.name} started`,
      href: "/memberships",
    });
  }
  for (const note of input.notes) {
    events.push({ id: `note-${note.id}`, at: note.createdAt, kind: "communications", title: "Note added" });
  }
  for (const photo of input.photos) {
    events.push({ id: `photo-${photo.id}`, at: photo.createdAt, kind: "jobs", title: `Photo uploaded · ${photo.job.jobNumber}` });
  }
  for (const thread of input.threads ?? []) {
    events.push({
      id: `thread-${thread.id}`,
      at: thread.lastActivityAt,
      kind: "communications",
      title: `${thread.channel} · ${thread.messages?.[0]?.body ? thread.messages[0].body.slice(0, 80) : "Conversation"}`,
      href: `/marketing/communications/${thread.id}`,
    });
  }
  for (const call of input.calls) {
    events.push({
      id: `call-${call.id}`,
      at: call.startedAt,
      kind: "communications",
      title: call.missed ? "Missed call" : "Call recorded",
      href: `/marketing/communications?filter=${call.missed ? "missed" : "today"}`,
    });
  }
  for (const waiting of input.waiting ?? []) {
    const href = `/operations/waiting?record=${waiting.id}`;
    events.push({
      id: `wait-${waiting.id}`,
      at: waiting.enteredAt,
      kind: "jobs",
      title: `Waiting started · ${waiting.column.name} · ${waiting.job.jobNumber}`,
      href,
    });
    const meta = waiting.metadata && typeof waiting.metadata === "object" ? (waiting.metadata as Record<string, unknown>) : {};
    const part = meta.part && typeof meta.part === "object" ? (meta.part as Record<string, unknown>) : {};
    const orderedRaw = typeof part.orderedAt === "string" ? part.orderedAt : typeof meta.dateOrdered === "string" ? meta.dateOrdered : null;
    const orderedAt = orderedRaw ? new Date(orderedRaw) : null;
    if (orderedAt && !Number.isNaN(orderedAt.getTime())) {
      events.push({
        id: `wait-ordered-${waiting.id}`,
        at: orderedAt,
        kind: "jobs",
        title: `Part ordered · ${waiting.job.jobNumber}`,
        href,
      });
    }
    for (const communication of waiting.communications ?? []) {
      if (!communication.sentAt) continue;
      events.push({
        id: `wait-update-${communication.id}`,
        at: communication.sentAt,
        kind: "communications",
        title: `Waiting update sent · ${waiting.job.jobNumber}`,
        href,
      });
    }
    if (waiting.actualArrivalAt) {
      events.push({
        id: `wait-arrived-${waiting.id}`,
        at: waiting.actualArrivalAt,
        kind: "jobs",
        title: `Part arrived · ${waiting.job.jobNumber}`,
        href,
      });
      events.push({
        id: `wait-ready-${waiting.id}`,
        at: waiting.actualArrivalAt,
        kind: "jobs",
        title: `Ready to schedule · ${waiting.job.jobNumber}`,
        href: waiting.job.id ? `/jobs/${waiting.job.id}#schedule` : href,
      });
    }
    if (waiting.resolvedAt) {
      const scheduled = (waiting.transitions ?? []).some((row) => {
        const actions = row.actions && typeof row.actions === "object" ? (row.actions as Record<string, unknown>) : {};
        return actions.appointmentScheduled === true || row.note === "Appointment scheduled";
      });
      events.push({
        id: `wait-resolved-${waiting.id}`,
        at: waiting.resolvedAt,
        kind: "jobs",
        title: scheduled
          ? `Appointment scheduled · ${waiting.job.jobNumber}`
          : `Waiting resolved · ${waiting.job.jobNumber}`,
        href,
      });
    }
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export type Customer360 = NonNullable<Awaited<ReturnType<typeof getCustomer360>>>;
