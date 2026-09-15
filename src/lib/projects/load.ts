import { prisma } from "@/lib/db";
import { calculateProjectFinancials, calculateProjectHealth, projectAccessFilter } from "@/lib/projects/core";
import type { CompanyRole } from "@prisma/client";

export async function loadProject360(input: { companyId: string; projectId: string; role: CompanyRole; userId: string }) {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, companyId: input.companyId, ...projectAccessFilter(input.role, input.userId) },
    include: {
      customer: true,
      property: true,
      phases: { orderBy: { sortOrder: "asc" } },
      jobs: {
        orderBy: { scheduledStart: "asc" },
        include: { assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
      },
      laborEntries: {
        orderBy: { startedAt: "desc" },
        include: { employee: { select: { id: true, firstName: true, lastName: true } }, revisions: { orderBy: { createdAt: "desc" }, take: 10 } },
      },
      costs: { orderBy: { incurredAt: "desc" } },
      materials: { orderBy: { createdAt: "desc" }, include: { part: { select: { name: true, sku: true } } } },
      materialRequests: { orderBy: { createdAt: "desc" }, include: { part: { select: { name: true, sku: true } } } },
      assets: { orderBy: { createdAt: "desc" } },
      receipts: { orderBy: { createdAt: "desc" } },
      issues: { orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] },
      changeOrders: { orderBy: { requestedAt: "desc" } },
      billingMilestones: { orderBy: { createdAt: "asc" }, include: { invoice: true } },
      invoices: { where: { status: { not: "VOID" } }, orderBy: { issueDate: "desc" } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      activities: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!project) return null;

  const visitJobIds = project.jobs.map((job) => job.id);
  const visitCosts = visitJobIds.length
    ? await prisma.jobCost.findMany({ where: { companyId: input.companyId, jobId: { in: visitJobIds }, confirmed: true } })
    : [];
  const approvedChangeOrderRevenueCents = project.changeOrders
    .filter((row) => row.status === "APPROVED")
    .reduce((sum, row) => sum + row.revenueChangeCents, 0);
  const actualLaborCents = project.laborEntries.reduce((sum, row) => sum + (row.internalLaborCostCents || 0), 0);
  const actualLaborMinutes = project.laborEntries.reduce((sum, row) => sum + (row.totalMinutes || 0), 0);
  const actualDirectCostCents = project.costs.filter((row) => row.status === "ACTUAL").reduce((sum, row) => sum + row.amountCents, 0);
  const committedDirectCostCents =
    project.costs.filter((row) => row.status === "COMMITTED").reduce((sum, row) => sum + row.amountCents, 0) +
    project.changeOrders.filter((row) => row.status === "APPROVED").reduce((sum, row) => sum + row.estimatedCostChangeCents, 0);
  const actualVisitCostCents = visitCosts.reduce((sum, row) => sum + row.amountCents, 0);
  const actualInstalledMaterialCents = project.materials
    .filter((row) => row.status === "INSTALLED" && !row.linkedJobPartId && row.costTreatment === "INVENTORY_ALLOCATION")
    .reduce((sum, row) => sum + row.unitCostCents * row.quantity, 0);
  const committedMaterialCents = project.materials
    .filter((row) => ["ORDERED", "RECEIVED", "ALLOCATED", "LOADED"].includes(row.status) && !row.linkedJobPartId)
    .reduce((sum, row) => sum + row.unitCostCents * row.quantity, 0);
  const totalBudgetCents =
    (project.laborBudgetCostCents || 0) +
    (project.equipmentBudgetCents || 0) +
    (project.materialsBudgetCents || 0) +
    (project.otherBudgetCents || 0);
  const knownCostAndCommitments =
    actualLaborCents + actualDirectCostCents + actualVisitCostCents + actualInstalledMaterialCents +
    committedDirectCostCents + committedMaterialCents;
  const projectedRemainingCostCents = Math.max(0, totalBudgetCents - knownCostAndCommitments);
  const billedCents = project.invoices.reduce((sum, row) => sum + row.totalCents, 0);
  const collectedCents = project.invoices.reduce((sum, row) => sum + row.amountPaidCents, 0);
  const financials = calculateProjectFinancials({
    originalContractCents: project.originalContractCents,
    approvedChangeOrderRevenueCents,
    actualLaborCents,
    actualDirectCostCents,
    actualVisitCostCents,
    actualInstalledMaterialCents,
    committedDirectCostCents,
    committedMaterialCents,
    projectedRemainingCostCents,
    billedCents,
    collectedCents,
  });
  const now = new Date();
  const health = calculateProjectHealth({
    status: project.status,
    targetCompletion: project.targetCompletion,
    projectedMarginBps: financials.projectedMarginBps,
    projectValueCents: financials.currentValueCents,
    minimumMarginBps: project.minimumMarginBps,
    laborBudgetMinutes: project.laborBudgetMinutes,
    actualLaborMinutes,
    blockedPhases: project.phases.filter((row) => row.status === "BLOCKED").length,
    criticalIssues: project.issues.filter((row) => row.status !== "RESOLVED" && row.priority === "CRITICAL").length,
    overduePhases: project.phases.filter((row) => row.status !== "COMPLETE" && row.plannedCompletion && row.plannedCompletion < now).length,
    unbilledReadyMilestones: project.billingMilestones.filter((row) => row.status === "READY_TO_BILL").length,
    pastDueInvoices: project.invoices.filter((row) => row.balanceCents > 0 && row.dueDate && row.dueDate < now).length,
    materialBlockers: project.materialRequests.filter((row) => row.status === "OPEN" && row.urgency === "BLOCKING").length,
  }, now);
  const currentPhase = project.phases.find((row) => ["IN_PROGRESS", "WAITING", "BLOCKED"].includes(row.status))
    || project.phases.find((row) => row.status === "READY")
    || project.phases.find((row) => row.status !== "COMPLETE")
    || project.phases.at(-1)
    || null;
  const nextStep = project.nextStep || deterministicNextStep(project.status, currentPhase?.name, currentPhase?.status, health.reasons);
  const upcomingVisit = project.jobs.find((job) => job.scheduledStart && job.scheduledStart >= now && !["COMPLETED", "CANCELED"].includes(job.status));

  return {
    project,
    financials,
    health,
    currentPhase,
    nextStep,
    upcomingVisit,
    actualLaborMinutes,
    actualLaborCents,
    visitCosts,
  };
}

export async function loadProjectsDashboard(input: { companyId: string; role: CompanyRole; userId: string; q?: string; status?: string; type?: string }) {
  const projects = await prisma.project.findMany({
    where: {
      companyId: input.companyId,
      ...projectAccessFilter(input.role, input.userId),
      ...(input.status ? { status: input.status } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.q ? {
        OR: [
          { name: { contains: input.q, mode: "insensitive" } },
          { projectNumber: { contains: input.q, mode: "insensitive" } },
          { builderName: { contains: input.q, mode: "insensitive" } },
          { property: { address: { contains: input.q, mode: "insensitive" } } },
          { customer: { OR: [{ firstName: { contains: input.q, mode: "insensitive" } }, { lastName: { contains: input.q, mode: "insensitive" } }, { businessName: { contains: input.q, mode: "insensitive" } }] } },
        ],
      } : {}),
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const rows = (await Promise.all(projects.map((project) => loadProject360({ ...input, projectId: project.id })))).filter(Boolean);
  return rows;
}

function deterministicNextStep(projectStatus: string, phaseName?: string, phaseStatus?: string, reasons: string[] = []) {
  if (reasons[0]) return reasons[0];
  if (projectStatus === "COMPLETE") return "Project complete — preserve final record";
  if (!phaseName) return "Add the first project phase";
  if (phaseStatus === "WAITING" || phaseStatus === "BLOCKED") return `Resolve what is blocking ${phaseName}`;
  if (phaseStatus === "IN_PROGRESS") return `Complete ${phaseName}`;
  return `Start or schedule ${phaseName}`;
}
