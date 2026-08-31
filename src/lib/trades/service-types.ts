import type { Industry, Prisma, PrismaClient } from "@prisma/client";
import { serviceTypeStartersForTrade } from "@/lib/trades/templates";
import { getStarterTemplate } from "@/lib/playbooks/templates";

type Db = PrismaClient | Prisma.TransactionClient;

function playbookIdForStarter(
  playbooks: Array<{ id: string; name: string }>,
  playbookKey?: string | null
) {
  if (!playbookKey) return null;
  const name = PLAYBOOK_NAME_BY_KEY[playbookKey] ?? getStarterTemplate(playbookKey)?.name;
  return playbooks.find((playbook) => playbook.name === name)?.id ?? null;
}

const PLAYBOOK_NAME_BY_KEY: Record<string, string> = {
  residential_service: "Residential Service",
  residential_maintenance: "Residential Maintenance",
  commercial_maintenance: "Commercial Maintenance",
  residential_changeout: "Residential Changeout",
  estimate_sales: "Estimate / Sales Call",
};

export async function ensureCompanyServiceTypes(
  db: Db,
  companyId: string,
  trade: Industry | string | null | undefined
) {
  const existing = await db.serviceType.count({ where: { companyId } });
  if (existing > 0) {
    return { created: 0, skipped: true as const };
  }

  const playbooks = await db.playbook.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const starters = serviceTypeStartersForTrade(trade);

  await db.serviceType.createMany({
    data: starters.map((starter, index) => ({
      companyId,
      key: starter.key,
      name: starter.name,
      description: starter.description || null,
      playbookKey: starter.playbookKey ?? null,
      playbookId: playbookIdForStarter(playbooks, starter.playbookKey),
      sortOrder: index,
      active: true,
    })),
  });

  return { created: starters.length, skipped: false as const };
}

export async function listActiveServiceTypes(db: Db, companyId: string) {
  return db.serviceType.findMany({
    where: { companyId, active: true, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      key: true,
      description: true,
      playbookId: true,
      playbookKey: true,
      sortOrder: true,
      active: true,
    },
  });
}

export async function companyServiceType(db: Db, companyId: string, serviceTypeId: string | null | undefined) {
  if (!serviceTypeId) return null;
  return db.serviceType.findFirst({
    where: { id: serviceTypeId, companyId },
  });
}
