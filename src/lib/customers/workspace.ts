import { differenceInCalendarDays, differenceInMonths, format, subMonths } from "date-fns";
import type { CompanyRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getNeedsAttention } from "@/lib/attention";
import { factLabel, propertyImagePriority } from "@/lib/properties/enrichment";
import { JOB_PHOTO_KINDS } from "@/lib/tech/photos";

const OPEN_JOB = ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "ON_HOLD"];
const OPEN_ESTIMATE = ["DRAFT", "SENT", "VIEWED"];
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
    completedCount,
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
  ] = await Promise.all([
    prisma.equipment.findMany({
      where: { companyId: input.companyId, customerId: customer.id, ...(selected ? { propertyId: selected.id } : {}) },
      orderBy: { installDate: "asc" },
      take: 20,
    }),
    prisma.job.findMany({
      where: { companyId: input.companyId, customerId: customer.id, ...propertyFilter },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        property: { select: { address: true, city: true } },
        assignments: { include: { user: { select: { firstName: true, lastName: true } } }, take: 1 },
        invoices: { select: { totalCents: true, status: true }, take: 1 },
      },
    }),
    prisma.job.count({ where: { companyId: input.companyId, customerId: customer.id } }),
    prisma.job.count({
      where: { companyId: input.companyId, customerId: customer.id, status: "COMPLETED" },
    }),
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
      },
    }),
    canSeeMoney
      ? prisma.payment.findMany({
          where: { companyId: input.companyId, customerId: customer.id, status: { in: ["SUCCEEDED", "RECORDED", "CONFIRMED"] } },
          orderBy: { paidAt: "desc" },
          take: 8,
          select: { id: true, amountCents: true, paidAt: true, method: true, invoiceId: true },
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

  const activeJobs = recentJobs.filter((job) => OPEN_JOB.includes(job.status));
  const historyJobs = recentJobs.filter((job) => !OPEN_JOB.includes(job.status));
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
        { label: "Service history", value: `${completedCount} completed job${completedCount === 1 ? "" : "s"}`, source: "Company entered" },
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
  }).slice(0, 40);

  return {
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      displayName,
      phone: customer.phone,
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
          ...selected,
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
        property: job.property.address,
      })),
      estimates: openEstimates
        .filter((row) => OPEN_ESTIMATE.includes(row.status))
        .map((row) => ({
          ...row,
          daysOld: differenceInCalendarDays(new Date(), row.issueDate),
        })),
      invoices: canSeeMoney
        ? invoices.filter((row) => OPEN_INVOICE.includes(row.status) && row.balanceCents > 0)
        : [],
    },
    jobHistory: historyJobs.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      jobType: job.jobType,
      status: job.status,
      when: job.completedAt || job.scheduledStart || job.createdAt,
      technician: job.assignments[0]
        ? `${job.assignments[0].user.firstName} ${job.assignments[0].user.lastName}`
        : null,
      amountCents: canSeeMoney ? job.invoices[0]?.totalCents ?? null : null,
      property: job.property.address,
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
      })),
    },
    timeline,
    mapsConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_ROUTES_API_KEY),
  };
}

function buildCustomerInsights(input: {
  equipment: { ageYears: number | null; repairCount: number; name: string }[];
  completedCount: number;
  activeMembership: boolean;
  openReplacement: boolean;
  openEstimateValue: number;
  outstanding: number;
}) {
  const rows: { title: string; detail: string }[] = [];
  for (const item of input.equipment) {
    if (item.ageYears != null && item.ageYears >= 12) {
      rows.push({
        title: "Older equipment",
        detail: `${item.name} is about ${item.ageYears} years old based on the recorded install date.`,
      });
    }
    if (item.repairCount >= 2) {
      rows.push({
        title: "Repeated repairs",
        detail: `${item.name} has ${item.repairCount} documented repair-related jobs in the last 18 months.`,
      });
    }
  }
  if (!input.activeMembership && input.completedCount >= 3) {
    rows.push({
      title: "Membership opportunity",
      detail: `${input.completedCount} completed jobs and no active membership on file.`,
    });
  }
  if (input.openEstimateValue > 0) {
    rows.push({
      title: "Open estimate",
      detail: `Open estimates total $${(input.openEstimateValue / 100).toLocaleString("en-US")}.`,
    });
  }
  if (input.outstanding > 0) {
    rows.push({
      title: "Open balance",
      detail: `Outstanding invoices total $${(input.outstanding / 100).toLocaleString("en-US")}.`,
    });
  }
  return rows.slice(0, 5);
}

function buildTimeline(input: {
  customer: { createdAt: Date; firstName: string };
  properties: { createdAt: Date; address: string }[];
  jobs: { id: string; jobNumber: string; status: string; createdAt: Date; completedAt: Date | null; scheduledStart: Date | null }[];
  estimates: { id: string; estimateNumber: string; status: string; issueDate: Date }[];
  invoices: { id: string; invoiceNumber: string; status: string; createdAt: Date }[];
  payments: { id: string; amountCents: number; paidAt: Date | null }[];
  memberships: { id: string; saleDate: Date; plan: { name: string } }[];
  notes: { id: string; createdAt: Date }[];
  photos: { id: string; createdAt: Date; job: { jobNumber: string } }[];
  calls: { id: string; startedAt: Date; missed: boolean | null }[];
}) {
  const events: { id: string; at: Date; kind: string; title: string; href?: string }[] = [
    { id: "created", at: input.customer.createdAt, kind: "customer", title: "Customer created" },
  ];
  for (const property of input.properties) {
    events.push({ id: `prop-${property.address}`, at: property.createdAt, kind: "property", title: `Property added · ${property.address}` });
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
  for (const call of input.calls) {
    events.push({
      id: `call-${call.id}`,
      at: call.startedAt,
      kind: "communications",
      title: call.missed ? "Missed call" : "Call recorded",
    });
  }
  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export type Customer360 = NonNullable<Awaited<ReturnType<typeof getCustomer360>>>;
