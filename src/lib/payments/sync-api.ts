import type { PrismaClient } from "@prisma/client";
import {
  invoicePaymentSnapshot,
  loadAuthoritativeInvoice,
  loadAuthoritativePublicInvoice,
} from "@/lib/payments/sync";

export async function invoiceSnapshotForSession(
  prisma: PrismaClient,
  input: { companyId: string; invoiceId: string }
) {
  const invoice = await loadAuthoritativeInvoice(prisma, input.companyId, input.invoiceId);
  if (!invoice) return null;
  return invoicePaymentSnapshot(invoice);
}

export async function invoiceSnapshotForPublicToken(prisma: PrismaClient, token: string) {
  const invoice = await loadAuthoritativePublicInvoice(prisma, token);
  if (!invoice) return null;
  return invoicePaymentSnapshot(invoice);
}
