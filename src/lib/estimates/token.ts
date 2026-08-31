import { nanoid } from "nanoid";
import type { PrismaClient } from "@prisma/client";

export async function ensureEstimatePublicToken(prisma: PrismaClient, estimateId: string) {
  const current = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: { publicToken: true },
  });
  if (current?.publicToken) return current.publicToken;
  const token = nanoid(24);
  await prisma.estimate.update({ where: { id: estimateId }, data: { publicToken: token } });
  return token;
}

export async function ensureInvoicePublicToken(prisma: PrismaClient, invoiceId: string) {
  const current = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { publicToken: true },
  });
  if (current?.publicToken) return current.publicToken;
  const token = nanoid(24);
  await prisma.invoice.update({ where: { id: invoiceId }, data: { publicToken: token } });
  return token;
}
