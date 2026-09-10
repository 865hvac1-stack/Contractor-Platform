import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_APPOINTMENT_WINDOWS } from "@/lib/scheduling/windows";

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureSchedulingSetup(db: Db, companyId: string) {
  const [windowCount, policy] = await Promise.all([
    db.appointmentWindow.count({ where: { companyId } }),
    db.schedulingPolicy.findUnique({ where: { companyId } }),
  ]);

  if (!policy) {
    await db.schedulingPolicy.create({
      data: { companyId },
    });
  }

  if (windowCount === 0) {
    await db.appointmentWindow.createMany({
      data: DEFAULT_APPOINTMENT_WINDOWS.map((window) => ({
        companyId,
        name: window.name,
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
        daypart: window.daypart,
        sortOrder: window.sortOrder,
        active: true,
      })),
    });
  }

  const [serviceTypes, existingRules] = await Promise.all([
    db.serviceType.findMany({
      where: { companyId, active: true, archivedAt: null },
      select: { id: true, name: true },
    }),
    db.serviceTypeSchedulingRule.findMany({
      where: { companyId },
      select: { serviceTypeId: true },
    }),
  ]);
  const ruled = new Set(existingRules.map((row) => row.serviceTypeId));
  const missingRules = serviceTypes.filter((type) => !ruled.has(type.id));
  if (missingRules.length) {
    // Preserve the previous implicit default: no saved rule meant auto-book when policy is on.
    await db.serviceTypeSchedulingRule.createMany({
      data: missingRules.map((type) => ({
        companyId,
        serviceTypeId: type.id,
        autoBookAllowed: true,
        requiresOfficeApproval: false,
        isMaintenance: /maintenance/i.test(type.name),
      })),
    });
  }

  const company = await db.company.findFirst({
    where: { id: companyId },
    select: { timezone: true },
  });
  return { timezone: company?.timezone || "America/New_York" };
}
