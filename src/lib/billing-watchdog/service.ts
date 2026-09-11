import type { PrismaClient } from "@prisma/client";
import { isHistoricalImport } from "@/lib/imports/safety";
import { analyzeBillingHealth, summarizeFindings, type DetectJob } from "@/lib/billing-watchdog/detect";
import { getBillingWatchdogSettings } from "@/lib/billing-watchdog/settings";
import { persistWatchdogFindings } from "@/lib/billing-watchdog/persist";
import { FILTER_TYPES, TYPE_LABELS } from "@/lib/billing-watchdog/labels";
import type { BillingWatchdogFindingView, BillingWatchdogSummary } from "@/lib/billing-watchdog/types";
import { getJobBillingReadiness, type ReadinessJob } from "@/lib/billing-watchdog/readiness";

function customerLabel(customer: { businessName: string | null; firstName: string; lastName: string }) {
  return customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();
}

export async function refreshBillingWatchdog(prisma: PrismaClient, companyId: string, asOf = new Date()) {
  const settings = await getBillingWatchdogSettings(prisma, companyId, asOf);
  const lookback = new Date(settings.startDate);
  const [jobs, invoices, payments, qboSettings, qboMaps, exclusions] = await Promise.all([
    prisma.job.findMany({
      where: {
        companyId,
        importMode: { notIn: ["HISTORICAL", "REFERENCE"] },
        status: { in: ["DISPATCHED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] },
        OR: [
          { completedAt: { gte: lookback } },
          { checkedInAt: { gte: lookback } },
          { scheduledStart: { gte: lookback } },
          { createdAt: { gte: lookback } },
        ],
      },
      select: {
        id: true,
        companyId: true,
        jobNumber: true,
        status: true,
        jobType: true,
        importMode: true,
        customerId: true,
        scheduledStart: true,
        scheduledEnd: true,
        checkedInAt: true,
        checkedOutAt: true,
        completedAt: true,
        createdAt: true,
        importedTotalCents: true,
        serviceType: { select: { name: true } },
        estimate: { select: { totalCents: true, status: true } },
        assignments: { select: { userId: true }, take: 1, orderBy: { assignedAt: "desc" } },
        photos: { where: { deletedAt: null }, select: { id: true }, take: 3 },
        playbookSnapshot: { select: { definition: true } },
      },
      take: 400,
    }),
    prisma.invoice.findMany({
      where: {
        companyId,
        importMode: { notIn: ["HISTORICAL", "REFERENCE"] },
        status: { not: "VOID" },
        OR: [{ createdAt: { gte: lookback } }, { issueDate: { gte: lookback } }, { dueDate: { gte: lookback } }],
      },
      select: {
        id: true,
        companyId: true,
        invoiceNumber: true,
        status: true,
        jobId: true,
        customerId: true,
        totalCents: true,
        amountPaidCents: true,
        balanceCents: true,
        issueDate: true,
        dueDate: true,
        createdAt: true,
        updatedAt: true,
        sentAt: true,
        deliveryStatus: true,
        lastDeliveryError: true,
        importMode: true,
      },
      take: 500,
    }),
    prisma.payment.findMany({
      where: {
        companyId,
        importMode: { notIn: ["HISTORICAL", "REFERENCE"] },
        status: { in: ["CONFIRMED", "SUCCEEDED", "RECORDED", "PARTIALLY_REFUNDED"] },
        paidAt: { gte: lookback },
      },
      select: {
        id: true,
        invoiceId: true,
        customerId: true,
        amountCents: true,
        refundedCents: true,
        status: true,
        paidAt: true,
        importMode: true,
      },
      take: 500,
    }),
    prisma.quickBooksSettings.findUnique({ where: { companyId }, select: { syncActivated: true } }),
    prisma.quickBooksMapping.findMany({
      where: { companyId, entityType: { in: ["INVOICE", "PAYMENT"] } },
      select: { entityType: true, internalId: true, status: true, lastSyncedAt: true },
    }),
    prisma.billingWatchdogFinding.findMany({
      where: { companyId, status: "EXCLUDED" },
      select: { fingerprint: true, jobId: true },
    }),
  ]);

  const customerIds = new Set<string>();
  for (const job of jobs) customerIds.add(job.customerId);
  for (const invoice of invoices) customerIds.add(invoice.customerId);
  const customers = customerIds.size
    ? await prisma.customer.findMany({
        where: { companyId, id: { in: [...customerIds] } },
        select: { id: true, firstName: true, lastName: true, businessName: true, email: true, phone: true },
      })
    : [];

  const remainingByJob = new Map<string, string[]>();
  for (const job of jobs) {
    const definition = job.playbookSnapshot?.definition;
    if (!definition || typeof definition !== "object") continue;
    const stages = (definition as { stages?: Array<{ steps?: Array<{ actionKey?: string; required?: boolean }> }> }).stages ?? [];
    const keys = stages.flatMap((stage) =>
      (stage.steps ?? []).filter((step) => step.required && step.actionKey).map((step) => String(step.actionKey))
    );
    if (keys.length) remainingByJob.set(job.id, keys);
  }

  const detected = analyzeBillingHealth({
    companyId,
    asOf,
    settings,
    jobs: jobs.map((job): DetectJob => ({
      id: job.id,
      companyId: job.companyId,
      jobNumber: job.jobNumber,
      status: job.status,
      jobType: job.jobType,
      serviceTypeName: job.serviceType?.name,
      importMode: job.importMode,
      customerId: job.customerId,
      scheduledStart: job.scheduledStart,
      scheduledEnd: job.scheduledEnd,
      checkedInAt: job.checkedInAt,
      checkedOutAt: job.checkedOutAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      importedTotalCents: job.importedTotalCents,
      estimateTotalCents: job.estimate?.status === "APPROVED" ? job.estimate.totalCents : job.estimate?.totalCents ?? null,
      technicianId: job.assignments[0]?.userId ?? null,
      photoCount: job.photos.length,
      remainingPlaybookKeys: remainingByJob.get(job.id) ?? [],
    })),
    invoices,
    payments,
    customers: customers.map((row) => ({
      id: row.id,
      name: customerLabel(row),
      email: row.email,
      phone: row.phone,
    })),
    qboConnected: Boolean(qboSettings?.syncActivated),
    qboInvoiceMaps: qboMaps.filter((row) => row.entityType === "INVOICE"),
    qboPaymentMaps: qboMaps.filter((row) => row.entityType === "PAYMENT"),
    excludedFingerprints: new Set(exclusions.map((row) => row.fingerprint)),
    excludedJobIds: new Set(exclusions.map((row) => row.jobId).filter((id): id is string => Boolean(id))),
  });

  await persistWatchdogFindings(prisma, companyId, detected, asOf);
  return loadBillingWatchdog(prisma, companyId);
}

export async function loadBillingWatchdog(
  prisma: PrismaClient,
  companyId: string,
  input?: { filter?: string; range?: string }
) {
  const rows = await prisma.billingWatchdogFinding.findMany({
    where: { companyId },
    include: {
      job: { select: { jobNumber: true, status: true } },
      invoice: { select: { invoiceNumber: true, totalCents: true, balanceCents: true } },
    },
    orderBy: [{ status: "asc" }, { severity: "asc" }, { lastDetectedAt: "desc" }],
    take: 200,
  });
  const filter = input?.filter || "all";
  const filterDef = FILTER_TYPES.find((row) => row.key === filter);
  const rangeDays = input?.range === "today" ? 0 : input?.range === "yesterday" ? 1 : input?.range === "7d" ? 7 : input?.range === "30d" ? 30 : null;
  const now = new Date();
  const findings: BillingWatchdogFindingView[] = rows
    .filter((row) => {
      if (filter === "resolved") return row.status !== "OPEN";
      if (row.status !== "OPEN") return false;
      if (filter !== "all" && filterDef && "types" in filterDef && filterDef.types) {
        if (!filterDef.types.includes(row.type as never)) return false;
      }
      if (rangeDays === 0) {
        return row.lastDetectedAt.toDateString() === now.toDateString();
      }
      if (rangeDays != null) {
        const start = new Date(now);
        start.setDate(start.getDate() - rangeDays);
        return row.lastDetectedAt >= start;
      }
      return true;
    })
    .map((row) => {
      const metadata = (row.metadata || {}) as Record<string, unknown>;
      return {
        id: row.id,
        companyId: row.companyId,
        fingerprint: row.fingerprint,
        type: row.type as BillingWatchdogFindingView["type"],
        severity: row.severity,
        status: row.status,
        jobId: row.jobId,
        invoiceId: row.invoiceId,
        paymentId: row.paymentId,
        customerId: row.customerId,
        technicianId: row.technicianId,
        amountAtRiskCents: row.amountAtRiskCents,
        amountUnknown: row.amountUnknown,
        reason: row.reason,
        recommendedAction: row.recommendedAction,
        title: String(metadata.title || row.job?.jobNumber || row.invoice?.invoiceNumber || TYPE_LABELS[row.type as keyof typeof TYPE_LABELS] || row.type),
        subtitle: row.job?.jobNumber || row.invoice?.invoiceNumber || "",
        actions: actionsFor(row),
        metadata,
        detectedAt: row.detectedAt,
        firstDetectedAt: row.firstDetectedAt,
        lastDetectedAt: row.lastDetectedAt,
        resolvedAt: row.resolvedAt,
        exclusionCode: row.exclusionCode,
        exclusionReason: row.exclusionReason,
      };
    });

  const openRows = rows.filter((row) => row.status === "OPEN");
  const summary: BillingWatchdogSummary = {
    ...summarizeFindings(openRows),
  };
  return { findings, allOpen: openRows, summary };
}

function actionsFor(row: {
  type: string;
  jobId: string | null;
  invoiceId: string | null;
  customerId: string | null;
}) {
  if (row.type === "COMPLETED_NO_INVOICE" && row.jobId) {
    return [
      { label: "Create invoice", href: `/invoices/new?jobId=${row.jobId}` },
      { label: "Open job", href: `/jobs/${row.jobId}` },
    ];
  }
  if ((row.type === "TECH_CHECKOUT_INCOMPLETE" || row.type === "READY_TO_INVOICE_CHECKOUT_INCOMPLETE") && row.jobId) {
    return [
      { label: "Review job", href: `/jobs/${row.jobId}` },
      { label: "Contact technician", href: "/team" },
    ];
  }
  if (row.type === "CUSTOMER_MISSING_EMAIL" && row.customerId && row.invoiceId) {
    return [
      { label: "Add email", href: `/customers/${row.customerId}` },
      { label: "Text payment link", href: `/invoices/${row.invoiceId}` },
      { label: "Open invoice", href: `/invoices/${row.invoiceId}` },
    ];
  }
  if (row.type === "ACCOUNTING_OUT_OF_SYNC") {
    return [
      { label: "Review QuickBooks sync", href: "/settings/quickbooks/manage" },
      ...(row.invoiceId ? [{ label: "Open invoice", href: `/invoices/${row.invoiceId}` }] : []),
    ];
  }
  if (row.invoiceId) return [{ label: "Open invoice", href: `/invoices/${row.invoiceId}` }];
  if (row.jobId) return [{ label: "Open job", href: `/jobs/${row.jobId}` }];
  return [];
}

export async function loadJobBillingReadinessForJob(
  prisma: PrismaClient,
  input: { companyId: string; jobId: string }
) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    include: {
      serviceType: { select: { name: true } },
      invoices: { where: { status: { not: "VOID" } }, select: { id: true, invoiceNumber: true, status: true, totalCents: true } },
      estimate: { select: { totalCents: true } },
    },
  });
  if (!job) return null;
  const excluded = await prisma.billingWatchdogFinding.findFirst({
    where: { companyId: input.companyId, jobId: job.id, status: "EXCLUDED", type: "COMPLETED_NO_INVOICE" },
    select: { exclusionCode: true },
  });
  const snapshot: ReadinessJob = {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    jobType: job.jobType,
    serviceTypeName: job.serviceType?.name,
    importMode: job.importMode,
    customerId: job.customerId,
    checkedInAt: job.checkedInAt,
    checkedOutAt: job.checkedOutAt,
    completedAt: job.completedAt,
    invoices: job.invoices,
    estimateTotalCents: job.estimate?.totalCents ?? null,
    importedTotalCents: job.importedTotalCents,
    excluded: Boolean(excluded),
    exclusionCode: excluded?.exclusionCode ?? null,
  };
  return getJobBillingReadiness(snapshot);
}

export { isHistoricalImport };
