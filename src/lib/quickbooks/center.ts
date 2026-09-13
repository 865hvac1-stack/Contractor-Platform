import type { PrismaClient } from "@prisma/client";
import { previewQuickBooksSync } from "@/lib/quickbooks/preview";
import { humanQuickBooksError } from "@/lib/quickbooks/errors";
import { diagnoseCompanyInvoicePayments, ENTITY_PAYMENT } from "@/lib/quickbooks/mappings";
import { paymentReviewLabel } from "@/lib/quickbooks/eligibility";
import { eventScopeWhere, mappingScopeWhere, type QuickBooksScope } from "@/lib/quickbooks/ownership";

export async function loadQuickBooksSyncCenter(prisma: PrismaClient, scope: QuickBooksScope) {
  const companyId = scope.companyId;
  const [preview, review, recent, customers, diagnosis] = await Promise.all([
    previewQuickBooksSync(prisma, scope),
    prisma.quickBooksMapping.findMany({
      where: { ...mappingScopeWhere(scope), status: { in: ["NEEDS_REVIEW", "FAILED"] } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.quickBooksSyncEvent.findMany({
      where: eventScopeWhere(scope),
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.quickBooksMapping.findMany({
      where: { ...mappingScopeWhere(scope), entityType: "CUSTOMER", status: "NEEDS_REVIEW" },
      take: 30,
    }),
    diagnoseCompanyInvoicePayments(prisma, scope),
  ]);

  const customerIds = customers.map((row) => row.internalId);
  const localCustomers = customerIds.length
    ? await prisma.customer.findMany({
        where: { companyId, id: { in: customerIds } },
        select: { id: true, firstName: true, lastName: true, businessName: true, email: true, phone: true },
      })
    : [];

  const computedPaymentReviews = preview.paymentReviews.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    internalId: row.internalId,
    status: row.status,
    label: paymentReviewLabel(row.state),
    error: row.error,
    href: row.href,
    hrefLabel: row.hrefLabel,
  }));
  const computedPaymentIds = new Set(computedPaymentReviews.map((row) => row.internalId));
  const mappingReviews = review
    .filter((row) => !(row.entityType === ENTITY_PAYMENT && computedPaymentIds.has(row.internalId)))
    .map((row) => ({
      id: row.id,
      entityType: row.entityType,
      internalId: row.internalId,
      status: row.status,
      label: row.status.replaceAll("_", " "),
      error: humanQuickBooksError({ message: row.lastSyncError }),
      href: null as string | null,
      hrefLabel: null as string | null,
    }));

  return {
    preview,
    review: [...computedPaymentReviews, ...mappingReviews],
    recent: recent.map((event) => ({
      ...event,
      errorMessage: event.errorMessage ? humanQuickBooksError({ message: event.errorMessage }) : null,
    })),
    customers: customers.map((row) => ({
      mapping: row,
      customer: localCustomers.find((item) => item.id === row.internalId) ?? null,
    })),
    diagnosis,
  };
}
