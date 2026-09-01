import type { PrismaClient } from "@prisma/client";
import { demoUserEmail, SUMMIT_COMPANY_NAME } from "@/lib/demo/constants";
import { resetSummitDemoCompany } from "@/lib/demo/seed-summit";

const SUMMIT_LOCK = 865_202_601;

export async function findSummitDemoOwner(prisma: PrismaClient) {
  const email = demoUserEmail("Jake", "Bennett");
  const company = await prisma.company.findFirst({
    where: { isDemo: true, businessName: SUMMIT_COMPANY_NAME },
    select: { id: true, isDemo: true, businessName: true },
  });
  if (!company?.isDemo || company.businessName !== SUMMIT_COMPANY_NAME) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) return null;
  const membership = await prisma.membership.findFirst({
    where: { companyId: company.id, userId: user.id, status: "ACTIVE", role: "COMPANY_OWNER" },
    select: { id: true },
  });
  if (!membership) return null;
  return { companyId: company.id, userId: user.id, email: user.email };
}

/** Creates Summit only when the demo tenant is missing. Never resets an existing demo. Never touches other companies. */
export async function provisionSummitDemoIfMissing(prisma: PrismaClient) {
  await prisma.$executeRaw`SELECT pg_advisory_lock(${SUMMIT_LOCK})`;
  try {
    const existing = await findSummitDemoOwner(prisma);
    if (existing) {
      return { ...existing, created: false as const };
    }
    const otherDemo = await prisma.company.findFirst({
      where: { isDemo: true, businessName: SUMMIT_COMPANY_NAME },
      select: { id: true },
    });
    if (otherDemo) {
      throw new Error("Summit Home Services exists but the demo owner account is missing. Use Reset Demo Company.");
    }
    const result = await resetSummitDemoCompany(prisma);
    const owner = await findSummitDemoOwner(prisma);
    if (!owner) {
      throw new Error("Summit demo was created but the owner login is missing.");
    }
    return { ...owner, created: true as const, companyId: result.companyId };
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(${SUMMIT_LOCK})`;
  }
}
