import type { PrismaClient } from "@prisma/client";
import { qboCompanyInfo } from "@/lib/quickbooks/client";
import { loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";

export async function verifyQuickBooksCompany(prisma: PrismaClient, companyId: string) {
  const loaded = await loadQuickBooksTransport(companyId);
  if (!loaded.ok) {
    return { ok: false as const, error: loaded.error, reauth: loaded.reauth };
  }
  const info = await qboCompanyInfo(loaded.transport, loaded.realmId);
  if (!info?.name) {
    await prisma.integrationConnection.updateMany({
      where: { companyId, providerKey: QUICKBOOKS_PROVIDER_KEY },
      data: {
        status: "ERROR",
        errorMessage: "QuickBooks did not return a verified company name.",
        healthMessage: "Connected login is present, but company verification failed.",
      },
    });
    return { ok: false as const, error: "QuickBooks did not return a verified company name." };
  }
  await prisma.quickBooksSettings.upsert({
    where: { companyId },
    create: {
      companyId,
      invoiceSyncTrigger: "MANUAL_ONLY",
      qboCompanyName: info.name,
      qboCompanyVerifiedAt: new Date(),
    },
    update: { qboCompanyName: info.name, qboCompanyVerifiedAt: new Date() },
  });
  await prisma.integrationConnection.updateMany({
    where: { companyId, providerKey: QUICKBOOKS_PROVIDER_KEY },
    data: {
      status: "CONNECTED",
      accountLabel: info.name,
      errorMessage: null,
      healthMessage: "QuickBooks company verified.",
    },
  });
  return { ok: true as const, name: info.name, realmId: loaded.realmId };
}
