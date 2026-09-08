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

  const company = await db.company.findFirst({
    where: { id: companyId },
    select: { timezone: true },
  });
  return { timezone: company?.timezone || "America/New_York" };
}
