import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { DEMO_BLOCKED_MESSAGE, SUMMIT_COMPANY_NAME } from "@/lib/demo/constants";

export { DEMO_BLOCKED_MESSAGE };

export async function isDemoCompany(companyId: string | null | undefined, db: PrismaClient = defaultPrisma) {
  if (!companyId) return false;
  const company = await db.company.findFirst({
    where: { id: companyId },
    select: { isDemo: true },
  });
  return Boolean(company?.isDemo);
}

export async function demoOutboundBlock(companyId: string | null | undefined, db: PrismaClient = defaultPrisma) {
  if (await isDemoCompany(companyId, db)) {
    return { blocked: true as const, message: DEMO_BLOCKED_MESSAGE };
  }
  return { blocked: false as const };
}

/** Server actions should return this instead of calling a live provider. */
export async function refuseDemoExternal(companyId: string | null | undefined, db: PrismaClient = defaultPrisma) {
  const blocked = await demoOutboundBlock(companyId, db);
  if (blocked.blocked) return { ok: false as const, error: blocked.message };
  return null;
}

export function assertResettableDemoCompany(company: { isDemo: boolean; businessName: string; id: string } | null) {
  if (!company?.isDemo) {
    throw new Error("Demo reset is only allowed for the Summit Home Services demo tenant.");
  }
  if (company.businessName !== SUMMIT_COMPANY_NAME) {
    throw new Error("Demo reset refused: company name does not match the canonical demo tenant.");
  }
  return company;
}
