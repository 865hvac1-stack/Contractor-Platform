import type { CompanyRole, Prisma } from "@prisma/client";

export const PROJECT_TYPES = [
  "NEW_CONSTRUCTION",
  "REPLACEMENT_INSTALL",
  "COMMERCIAL_PROJECT",
  "REMODEL",
  "MULTI_DAY_REPAIR",
  "CUSTOM_PROJECT",
] as const;

export const PROJECT_STATUSES = ["PLANNING", "READY", "IN_PROGRESS", "WAITING", "PUNCH_FINAL", "COMPLETE"] as const;
export const PHASE_STATUSES = ["NOT_STARTED", "READY", "IN_PROGRESS", "WAITING", "COMPLETE", "BLOCKED"] as const;

export const PROJECT_PHASE_TEMPLATES: Record<(typeof PROJECT_TYPES)[number], string[]> = {
  NEW_CONSTRUCTION: ["Planning", "Equipment / Preconstruction", "Rough-In", "Waiting on Construction", "Trim-Out", "Startup", "Punch List", "Final Inspection"],
  REPLACEMENT_INSTALL: ["Planning", "Equipment & Materials", "Installation", "Startup", "Punch / Final"],
  COMMERCIAL_PROJECT: ["Planning", "Submittals / Procurement", "Rough-In", "Equipment Set", "Controls / Startup", "Punch / Closeout"],
  REMODEL: ["Planning", "Site Preparation", "Rough-In", "Trim-Out", "Startup", "Final"],
  MULTI_DAY_REPAIR: ["Planning", "Diagnosis / Scope", "Materials", "Repair", "Testing", "Final"],
  CUSTOM_PROJECT: ["Planning", "Work", "Punch / Final"],
};

export type ProjectFinancialInput = {
  originalContractCents: number;
  approvedChangeOrderRevenueCents: number;
  actualLaborCents: number;
  actualDirectCostCents: number;
  actualVisitCostCents: number;
  actualInstalledMaterialCents: number;
  committedDirectCostCents: number;
  committedMaterialCents: number;
  projectedRemainingCostCents: number;
  billedCents: number;
  collectedCents: number;
};

export function calculateProjectFinancials(input: ProjectFinancialInput) {
  const currentValueCents = input.originalContractCents + input.approvedChangeOrderRevenueCents;
  const costToDateCents =
    input.actualLaborCents +
    input.actualDirectCostCents +
    input.actualVisitCostCents +
    input.actualInstalledMaterialCents;
  const committedCostCents = input.committedDirectCostCents + input.committedMaterialCents;
  const projectedFinalCostCents = costToDateCents + committedCostCents + input.projectedRemainingCostCents;
  const projectedGrossProfitCents = currentValueCents - projectedFinalCostCents;
  const projectedMarginBps = currentValueCents > 0 ? Math.round(projectedGrossProfitCents * 10_000 / currentValueCents) : 0;
  return {
    currentValueCents,
    costToDateCents,
    committedCostCents,
    projectedRemainingCostCents: input.projectedRemainingCostCents,
    projectedFinalCostCents,
    projectedGrossProfitCents,
    projectedMarginBps,
    billedCents: input.billedCents,
    collectedCents: input.collectedCents,
    remainingToBillCents: Math.max(0, currentValueCents - input.billedCents),
    outstandingBalanceCents: Math.max(0, input.billedCents - input.collectedCents),
  };
}

export type ProjectHealthInput = {
  status: string;
  targetCompletion: Date | null;
  projectedMarginBps: number;
  projectValueCents: number;
  minimumMarginBps: number;
  laborBudgetMinutes: number | null;
  actualLaborMinutes: number;
  blockedPhases: number;
  criticalIssues: number;
  overduePhases: number;
  unbilledReadyMilestones: number;
  pastDueInvoices: number;
  materialBlockers: number;
};

export function calculateProjectHealth(input: ProjectHealthInput, now = new Date()) {
  const reasons: string[] = [];
  if (input.laborBudgetMinutes != null && input.actualLaborMinutes > input.laborBudgetMinutes) reasons.push("Labor is over budget");
  if (input.targetCompletion && input.targetCompletion < now && input.status !== "COMPLETE") reasons.push("Project is past target completion");
  if (input.blockedPhases) reasons.push(`${input.blockedPhases} phase${input.blockedPhases === 1 ? " is" : "s are"} blocked`);
  if (input.criticalIssues) reasons.push(`${input.criticalIssues} critical issue${input.criticalIssues === 1 ? "" : "s"} open`);
  if (input.overduePhases) reasons.push(`${input.overduePhases} phase${input.overduePhases === 1 ? " is" : "s are"} overdue`);
  if (input.unbilledReadyMilestones) reasons.push(`${input.unbilledReadyMilestones} milestone${input.unbilledReadyMilestones === 1 ? " is" : "s are"} ready to bill`);
  if (input.pastDueInvoices) reasons.push(`${input.pastDueInvoices} invoice${input.pastDueInvoices === 1 ? " is" : "s are"} past due`);
  if (input.materialBlockers) reasons.push(`${input.materialBlockers} material blocker${input.materialBlockers === 1 ? "" : "s"}`);
  if (input.projectValueCents > 0 && input.projectedMarginBps < input.minimumMarginBps) reasons.push("Projected margin is below target");
  return {
    status: reasons.some((reason) => /critical|past target|blocked|below target/i.test(reason))
      ? "AT_RISK"
      : reasons.length ? "NEEDS_ATTENTION" : "ON_TRACK",
    reasons,
  };
}

export function projectAccessFilter(role: CompanyRole, userId: string): Prisma.ProjectWhereInput {
  if (role === "TECHNICIAN" || role === "INSTALLER") {
    return { jobs: { some: { assignments: { some: { userId } } } } };
  }
  return {};
}

export function minutesBetween(start: Date, end: Date, breakMinutes = 0) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000) - Math.max(0, breakMinutes));
}

export function laborCostCents(totalMinutes: number, hourlyRateCents: number) {
  return Math.round(totalMinutes * hourlyRateCents / 60);
}

export function friendlyProject(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const PROJECT_EVENT_TYPES = [
  "PROJECT_CREATED", "PROJECT_PHASE_READY", "PROJECT_PHASE_STARTED", "PROJECT_PHASE_COMPLETED",
  "PROJECT_BLOCKED", "PROJECT_VISIT_SCHEDULED", "PROJECT_VISIT_COMPLETED",
  "PROJECT_LABOR_OVER_BUDGET", "PROJECT_MATERIAL_REQUIRED", "PROJECT_MATERIAL_RECEIVED",
  "PROJECT_ISSUE_CREATED", "PROJECT_ISSUE_RESOLVED", "PROJECT_BILLING_MILESTONE_READY",
  "PROJECT_CHANGE_ORDER_APPROVED", "PROJECT_COMPLETED",
] as const;
