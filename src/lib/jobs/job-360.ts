import type { CompanyRole, PrismaClient } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { loadJobFinancials, type JobFinancials } from "@/lib/costing/job";
import { can } from "@/lib/permissions";
import { loadJobImportSupplement, type JobImportSupplement } from "@/lib/jobs/imported-history";
import { buildWorkSummary, type WorkSummary } from "@/lib/jobs/work-summary";
import { buildJobTimeline, type JobTimelineItem } from "@/lib/jobs/timeline";
import { isHistoricalImport } from "@/lib/imports/safety";

export type Job360Line = {
  id: string;
  name: string;
  description: string | null;
  quantity: string;
  unitPriceCents: number;
  totalCents: number;
  source: "invoice" | "estimate";
};

export type Job360Photo = {
  id: string;
  kind: string;
  caption: string | null;
  href: string;
};

export type Job360 = {
  job: {
    id: string;
    jobNumber: string;
    status: string;
    priority: string;
    jobType: string | null;
    serviceTypeName: string | null;
    description: string | null;
    internalNotes: string | null;
    customerNotes: string | null;
    scheduledStart: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    importMode: string;
    historical: boolean;
    source: string | null;
  };
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    since: Date | null;
    jobCount: number;
    lastService: Date | null;
  };
  property: {
    id: string;
    name: string | null;
    address: string;
    line: string;
  };
  technicians: {
    assigned: { id: string; name: string }[];
    importedName: string | null;
  };
  import: JobImportSupplement;
  work: WorkSummary;
  financials: {
    estimateCents: number | null;
    invoiceCents: number;
    paidCents: number;
    balanceCents: number;
    refundedCents: number;
    importedTotalCents: number | null;
  };
  lines: Job360Line[];
  equipment: {
    id: string;
    name: string;
    equipmentType: string | null;
    manufacturer: string | null;
    model: string | null;
    serialNumber: string | null;
    installDate: Date | null;
  }[];
  photos: Job360Photo[];
  relatedJobs: { id: string; jobNumber: string; label: string; status: string; when: Date | null }[];
  timeline: JobTimelineItem[];
  estimates: { id: string; estimateNumber: string; status: string; totalCents: number }[];
  invoices: { id: string; invoiceNumber: string; status: string; totalCents: number; balanceCents: number }[];
  costing: JobFinancials | null;
};

function displayName(customer: { businessName: string | null; firstName: string; lastName: string }) {
  return customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();
}

export async function loadJob360(
  prisma: PrismaClient,
  input: { companyId: string; jobId: string; role: CompanyRole; access: Record<string, unknown> }
): Promise<Job360 | null> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId, ...input.access },
    include: {
      customer: true,
      property: true,
      serviceType: { select: { name: true } },
      assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      estimates: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { lineItems: { orderBy: { sortOrder: "asc" }, take: 40 } },
      },
      estimate: { include: { lineItems: { orderBy: { sortOrder: "asc" }, take: 40 } } },
      invoices: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          lineItems: { orderBy: { sortOrder: "asc" }, take: 40 },
          payments: { orderBy: { paidAt: "desc" }, take: 40 },
        },
      },
      photos: { orderBy: { createdAt: "desc" }, take: 40 },
      workflowEvents: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });
  if (!job) return null;

  const [supplement, equipment, related, customerStats, costing] = await Promise.all([
    loadJobImportSupplement(prisma, {
      companyId: input.companyId,
      jobId: job.id,
      importMode: job.importMode,
      importSessionId: job.importSessionId,
      sourceSystem: job.sourceSystem,
      externalId: job.externalId,
      importedSnapshot: job.importedSnapshot,
      importedOccurredAt: job.importedOccurredAt,
      importedTotalCents: job.importedTotalCents,
      importedTechnicianName: job.importedTechnicianName,
      description: job.description,
      internalNotes: job.internalNotes,
      createdAt: job.createdAt,
    }),
    prisma.equipment.findMany({
      where: { companyId: input.companyId, propertyId: job.propertyId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.job.findMany({
      where: { companyId: input.companyId, propertyId: job.propertyId, id: { not: job.id } },
      orderBy: [{ completedAt: "desc" }, { scheduledStart: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        jobNumber: true,
        status: true,
        jobType: true,
        serviceType: { select: { name: true } },
        completedAt: true,
        scheduledStart: true,
        importedOccurredAt: true,
        createdAt: true,
      },
    }),
    prisma.job.aggregate({
      where: { companyId: input.companyId, customerId: job.customerId },
      _count: { id: true },
      _min: { createdAt: true, importedOccurredAt: true, scheduledStart: true },
      _max: { completedAt: true, scheduledStart: true, importedOccurredAt: true },
    }),
    can(input.role, "job_costs:view") ? loadJobFinancials(input.companyId, job.id) : Promise.resolve(null),
  ]);

  const estimates = [
    ...(job.estimate ? [job.estimate] : []),
    ...job.estimates.filter((row) => row.id !== job.estimateId),
  ];
  const lines: Job360Line[] = [];
  for (const invoice of job.invoices) {
    for (const item of invoice.lineItems) {
      const qty = Number(item.quantity);
      lines.push({
        id: item.id,
        name: item.name,
        description: item.description,
        quantity: String(item.quantity),
        unitPriceCents: item.unitPriceCents,
        totalCents: Math.round(qty * item.unitPriceCents),
        source: "invoice",
      });
    }
  }
  if (lines.length === 0) {
    for (const estimate of estimates) {
      for (const item of estimate.lineItems) {
        const qty = Number(item.quantity);
        lines.push({
          id: item.id,
          name: item.name,
          description: item.description,
          quantity: String(item.quantity),
          unitPriceCents: item.unitPriceCents,
          totalCents: Math.round(qty * item.unitPriceCents),
          source: "estimate",
        });
      }
    }
  }

  const invoiceCents = job.invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const paidCents = job.invoices.reduce((sum, invoice) => sum + invoice.amountPaidCents, 0);
  const balanceCents = job.invoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0);
  const refundedCents = job.invoices.reduce(
    (sum, invoice) => sum + invoice.payments.reduce((inner, payment) => inner + payment.refundedCents, 0),
    0
  );
  const estimateCents = estimates.length ? estimates.reduce((sum, row) => sum + row.totalCents, 0) : null;
  const assigned = job.assignments.map((row) => ({
    id: row.user.id,
    name: `${row.user.firstName} ${row.user.lastName}`.trim(),
  }));

  const lastService =
    customerStats._max.completedAt ?? customerStats._max.scheduledStart ?? customerStats._max.importedOccurredAt;
  const since =
    [customerStats._min.importedOccurredAt, customerStats._min.scheduledStart, customerStats._min.createdAt]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? job.customer.createdAt;

  return {
    job: {
      id: job.id,
      jobNumber: job.jobNumber,
      status: job.status,
      priority: job.priority,
      jobType: job.jobType,
      serviceTypeName: job.serviceType?.name ?? null,
      description: job.description,
      internalNotes: job.internalNotes,
      customerNotes: job.customerNotes,
      scheduledStart: job.scheduledStart,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      importMode: job.importMode,
      historical: isHistoricalImport(job.importMode),
      source: job.source,
    },
    customer: {
      id: job.customer.id,
      name: displayName(job.customer),
      phone: job.customer.phone,
      email: job.customer.email,
      since,
      jobCount: customerStats._count.id,
      lastService,
    },
    property: {
      id: job.property.id,
      name: job.property.name,
      address: job.property.address,
      line: `${job.property.address}, ${job.property.city}, ${job.property.state} ${job.property.zip}`,
    },
    technicians: {
      assigned,
      importedName: job.importedTechnicianName,
    },
    import: supplement,
    work: buildWorkSummary({
      jobType: job.jobType,
      serviceTypeName: job.serviceType?.name ?? null,
      description: job.description,
      customerNotes: job.customerNotes,
      internalNotes: job.internalNotes,
      importDescription: supplement.description,
      importNotes: supplement.notes,
      importFields: [...supplement.workFields, ...supplement.fields],
    }),
    financials: {
      estimateCents,
      invoiceCents,
      paidCents,
      balanceCents,
      refundedCents,
      importedTotalCents: supplement.totalCents,
    },
    lines,
    equipment: equipment.map((row) => ({
      id: row.id,
      name: row.name,
      equipmentType: row.equipmentType,
      manufacturer: row.manufacturer,
      model: row.model,
      serialNumber: row.serialNumber,
      installDate: row.installDate,
    })),
    photos: job.photos.map((photo) => ({
      id: photo.id,
      kind: photo.kind,
      caption: photo.caption,
      href: `/api/job-photos/${photo.id}`,
    })),
    relatedJobs: related.map((row) => ({
      id: row.id,
      jobNumber: row.jobNumber,
      label: row.serviceType?.name || row.jobType || "Job",
      status: row.status,
      when: row.completedAt ?? row.scheduledStart ?? row.importedOccurredAt ?? row.createdAt,
    })),
    timeline: buildJobTimeline({
      createdAt: job.createdAt,
      importedAt: supplement.importedAt,
      occurredAt: supplement.occurredAt,
      scheduledStart: job.scheduledStart,
      completedAt: job.completedAt,
      historical: supplement.historical,
      assignedNames: assigned.map((row) => row.name),
      importedTechnicianName: job.importedTechnicianName,
      estimates: estimates.map((row) => ({
        estimateNumber: row.estimateNumber,
        createdAt: row.createdAt,
        approvedAt: row.approvedAt,
        importMode: row.importMode,
      })),
      invoices: job.invoices.map((row) => ({
        invoiceNumber: row.invoiceNumber,
        createdAt: row.createdAt,
        importMode: row.importMode,
      })),
      payments: job.invoices.flatMap((invoice) =>
        invoice.payments.map((payment) => ({
          amountLabel: formatMoney(payment.amountCents),
          paidAt: payment.paidAt,
          importMode: payment.importMode,
        }))
      ),
      workflow: job.workflowEvents.map((event) => ({
        kind: event.kind,
        note: event.note,
        createdAt: event.createdAt,
      })),
    }),
    estimates: estimates.map((row) => ({
      id: row.id,
      estimateNumber: row.estimateNumber,
      status: row.status,
      totalCents: row.totalCents,
    })),
    invoices: job.invoices.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      status: row.status,
      totalCents: row.totalCents,
      balanceCents: row.balanceCents,
    })),
    costing,
  };
}
