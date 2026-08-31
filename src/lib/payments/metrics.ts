import type { PrismaClient } from "@prisma/client";
import { collectedAmountCents } from "@/lib/payments/record";

const COLLECTED = new Set(["CONFIRMED", "SUCCEEDED", "RECORDED", "PARTIALLY_REFUNDED"]);

export function paymentCountsAsCollected(status: string) {
  return COLLECTED.has(status) || status === "REFUNDED";
}

export async function companyPaymentMetrics(prisma: PrismaClient, companyId: string, now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [payments, invoices] = await Promise.all([
    prisma.payment.findMany({
      where: { companyId, importMode: { not: "HISTORICAL" } },
      select: {
        amountCents: true,
        refundedCents: true,
        status: true,
        paidAt: true,
        method: true,
        provider: true,
      },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        importMode: { not: "HISTORICAL" },
      },
      _sum: { balanceCents: true },
    }),
  ]);

  const sumCollected = (from: Date) =>
    payments
      .filter((payment) => payment.paidAt >= from && paymentCountsAsCollected(payment.status))
      .reduce((sum, payment) => sum + collectedAmountCents(payment), 0);

  return {
    collectedTodayCents: sumCollected(startOfDay),
    collectedWeekCents: sumCollected(startOfWeek),
    collectedMonthCents: sumCollected(startOfMonth),
    outstandingCents: invoices._sum?.balanceCents ?? 0,
    processingCents: payments
      .filter((payment) => payment.status === "PROCESSING")
      .reduce((sum, payment) => sum + payment.amountCents, 0),
    failedCents: payments
      .filter((payment) => payment.status === "FAILED" && payment.paidAt >= startOfMonth)
      .reduce((sum, payment) => sum + payment.amountCents, 0),
    refundedMonthCents: payments
      .filter((payment) => payment.paidAt >= startOfMonth)
      .reduce((sum, payment) => sum + (payment.refundedCents ?? 0), 0),
    failedCountMonth: payments.filter((payment) => payment.status === "FAILED" && payment.paidAt >= startOfMonth)
      .length,
  };
}

export async function recentCompanyPayments(prisma: PrismaClient, companyId: string, take = 25) {
  return prisma.payment.findMany({
    where: { companyId },
    include: {
      invoice: { select: { invoiceNumber: true, customer: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { paidAt: "desc" },
    take,
  });
}
