import { prisma } from "@/lib/db";
import { loadJobFinancials } from "@/lib/costing/job";
import { JOB_COST_LABELS } from "@/lib/costing/categories";

export async function getCompanyProfitability(companyId: string) {
  const jobs = await prisma.job.findMany({
    where: { companyId, status: { not: "CANCELED" } },
    select: { id: true, jobNumber: true, jobType: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const rows = (
    await Promise.all(jobs.map((job) => loadJobFinancials(companyId, job.id)))
  ).filter((row): row is NonNullable<typeof row> => Boolean(row));

  const withRevenue = rows.filter((row) => row.revenueCents > 0);
  const margins = withRevenue
    .map((row) => row.grossMarginPercent)
    .filter((value): value is number => value != null);
  const byType = new Map<
    string,
    { jobType: string; jobs: number; revenueCents: number; costCents: number; profitCents: number }
  >();
  for (const row of rows) {
    const key = row.jobType?.trim() || "Unspecified";
    const current = byType.get(key) ?? {
      jobType: key,
      jobs: 0,
      revenueCents: 0,
      costCents: 0,
      profitCents: 0,
    };
    current.jobs += 1;
    current.revenueCents += row.revenueCents;
    current.costCents += row.directCostCents;
    current.profitCents += row.grossProfitCents;
    byType.set(key, current);
  }

  const typeRows = [...byType.values()].map((row) => ({
    ...row,
    averageMarginPercent:
      row.revenueCents === 0 ? null : Math.round((row.profitCents / row.revenueCents) * 1000) / 10,
  }));

  return {
    jobCount: rows.length,
    averageGrossMarginPercent:
      margins.length === 0 ? null : Math.round((margins.reduce((sum, value) => sum + value, 0) / margins.length) * 10) / 10,
    averageJobCostCents:
      rows.length === 0
        ? 0
        : Math.round(rows.reduce((sum, row) => sum + row.directCostCents, 0) / rows.length),
    byJobType: typeRows.sort((a, b) => b.profitCents - a.profitCents),
    mostProfitableTypes: [...typeRows].sort((a, b) => (b.averageMarginPercent ?? -999) - (a.averageMarginPercent ?? -999)).slice(0, 5),
    lowestMarginJobs: withRevenue
      .slice()
      .sort((a, b) => (a.grossMarginPercent ?? 0) - (b.grossMarginPercent ?? 0))
      .slice(0, 8)
      .map((row) => ({
        jobId: row.jobId,
        jobNumber: row.jobNumber,
        jobType: row.jobType,
        revenueCents: row.revenueCents,
        grossProfitCents: row.grossProfitCents,
        grossMarginPercent: row.grossMarginPercent,
      })),
    missingCosts: rows.filter((row) => row.missingCosts).slice(0, 12),
    unreviewedReceipts: rows.filter((row) => row.unconfirmedReceipts.length > 0).slice(0, 12),
  };
}

export async function getVehicleExpenseTotals(companyId: string, month = new Date()) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId, active: true },
    include: {
      receipts: {
        where: {
          processingStatus: "CONFIRMED",
          receiptDate: { gte: start, lt: end },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return vehicles.map((vehicle) => {
    const fuel = vehicle.receipts
      .filter((receipt) => receipt.category === "FUEL" || receipt.category === "VEHICLE")
      .reduce((sum, receipt) => sum + (receipt.totalCents ?? 0), 0);
    const maintenance = vehicle.receipts
      .filter((receipt) => receipt.category === "EQUIPMENT" || receipt.category === "TOOLS")
      .reduce((sum, receipt) => sum + (receipt.totalCents ?? 0), 0);
    const other = vehicle.receipts
      .filter((receipt) => receipt.category !== "FUEL" && receipt.category !== "VEHICLE" && receipt.category !== "EQUIPMENT" && receipt.category !== "TOOLS")
      .reduce((sum, receipt) => sum + (receipt.totalCents ?? 0), 0);
    return {
      id: vehicle.id,
      name: vehicle.name,
      unitNumber: vehicle.unitNumber,
      fuelCents: fuel,
      maintenanceCents: maintenance,
      otherCents: other,
      totalCents: fuel + maintenance + other,
      receiptCount: vehicle.receipts.length,
    };
  });
}

export { JOB_COST_LABELS };
