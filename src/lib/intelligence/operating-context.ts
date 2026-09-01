import { prisma } from "@/lib/db";
import { SUMMIT_COMPANY_NAME } from "@/lib/demo/constants";

export type MemoryPriority =
  | "system"
  | "hard_rule"
  | "company_rule"
  | "company_preference"
  | "user_preference"
  | "verified_data"
  | "inferred"
  | "suggestion";

export type OperatingNote = {
  id: string;
  title: string;
  statement: string;
  category: string;
  priority: MemoryPriority;
  appliesTo: string;
};

export type CompanyGoalSnapshot = {
  metricKey: string;
  label: string;
  target: number;
  period: string;
  unit: "cents" | "percent" | "count";
};

export type BusinessContext = {
  companyId: string;
  companyName: string;
  isDemo: boolean;
  membershipName: string;
  highValueEstimateCents: number;
  estimateFollowUpDays: number;
  estimateSecondFollowUpDays: number;
  preferredServiceChannel: "SMS" | "EMAIL" | "ANY";
  notes: OperatingNote[];
  goals: CompanyGoalSnapshot[];
  source: "live_company" | "summit_demo";
};

const GOAL_LABELS: Record<string, { label: string; unit: CompanyGoalSnapshot["unit"] }> = {
  revenue: { label: "Monthly revenue", unit: "cents" },
  close_rate: { label: "Estimate close rate", unit: "percent" },
  reviews: { label: "Reviews", unit: "count" },
  memberships: { label: "Memberships sold", unit: "count" },
  gross_margin: { label: "Gross margin", unit: "percent" },
  average_ticket: { label: "Average ticket", unit: "cents" },
  callbacks: { label: "Callback target", unit: "count" },
};

/**
 * Summit-only operating notes. Never attached to 865 HVAC or any non-demo tenant.
 * These are product demonstration rules, not a second rules engine.
 */
export const SUMMIT_OPERATING_NOTES: OperatingNote[] = [
  {
    id: "membership-name",
    title: "Membership name",
    statement: "We call our membership Comfort Club.",
    category: "MEMBERSHIPS",
    priority: "company_preference",
    appliesTo: "memberships",
  },
  {
    id: "estimate-follow-up",
    title: "Estimate follow-up",
    statement: "Normal estimates follow up after 3 days.",
    category: "ESTIMATES",
    priority: "company_rule",
    appliesTo: "estimates",
  },
  {
    id: "estimate-second-follow-up",
    title: "Second estimate follow-up",
    statement: "If an estimate is still open after 7 days, send a second follow-up.",
    category: "ESTIMATES",
    priority: "company_rule",
    appliesTo: "estimates",
  },
  {
    id: "high-value-estimate",
    title: "High-Value Estimate Ownership",
    statement: "Estimates over $10,000 belong to the owner and must be followed up personally.",
    category: "ESTIMATES",
    priority: "company_rule",
    appliesTo: "estimates",
  },
  {
    id: "sms-preferred",
    title: "Preferred channel",
    statement: "SMS is preferred for service follow-up.",
    category: "CUSTOMER SERVICE",
    priority: "company_preference",
    appliesTo: "communications",
  },
  {
    id: "no-friday-installs",
    title: "Install restriction",
    statement: "No replacement installs Friday afternoon.",
    category: "DISPATCH",
    priority: "company_rule",
    appliesTo: "dispatch",
  },
  {
    id: "no-cooling",
    title: "Emergency priority",
    statement: "No-cooling and no-heat calls are urgent.",
    category: "DISPATCH",
    priority: "company_rule",
    appliesTo: "dispatch",
  },
  {
    id: "running-late",
    title: "Running late",
    statement: "Prepare a customer update after a job is 20 minutes late.",
    category: "CUSTOMER SERVICE",
    priority: "company_rule",
    appliesTo: "dispatch",
  },
  {
    id: "overdue-invoice",
    title: "Overdue invoice reminder",
    statement: "Send the first overdue reminder after 7 days past due.",
    category: "MONEY",
    priority: "company_rule",
    appliesTo: "invoices",
  },
  {
    id: "second-invoice",
    title: "Second invoice reminder",
    statement: "Send a second reminder after 15 days past due.",
    category: "MONEY",
    priority: "company_rule",
    appliesTo: "invoices",
  },
  {
    id: "job-margin",
    title: "Job margin alert",
    statement: "Warn when a job margin falls below 35%.",
    category: "MONEY",
    priority: "company_rule",
    appliesTo: "jobs",
  },
  {
    id: "replacement-margin",
    title: "Replacement margin target",
    statement: "Replacement work targets 45% gross margin.",
    category: "MONEY",
    priority: "company_rule",
    appliesTo: "jobs",
  },
  {
    id: "membership-renewal",
    title: "Membership renewal",
    statement: "Start Comfort Club renewal outreach 30 days before expiration.",
    category: "MEMBERSHIPS",
    priority: "company_rule",
    appliesTo: "memberships",
  },
  {
    id: "review-eligibility",
    title: "Review eligibility",
    statement: "Ask for a review after the job is completed, paid, and has no unresolved callback.",
    category: "REVIEWS",
    priority: "company_rule",
    appliesTo: "reviews",
  },
];

export function isSummitDemoCompany(company: { businessName: string; isDemo: boolean }) {
  return company.isDemo && company.businessName === SUMMIT_COMPANY_NAME;
}

export function notesForCompany(company: { businessName: string; isDemo: boolean }): OperatingNote[] {
  return isSummitDemoCompany(company) ? SUMMIT_OPERATING_NOTES : [];
}

export function goalLabel(metricKey: string) {
  return GOAL_LABELS[metricKey]?.label ?? metricKey.replaceAll("_", " ");
}

export function goalUnit(metricKey: string): CompanyGoalSnapshot["unit"] {
  return GOAL_LABELS[metricKey]?.unit ?? "count";
}

export function displayGoalTarget(goal: CompanyGoalSnapshot) {
  if (goal.unit === "percent" && (goal.metricKey === "close_rate" || goal.metricKey === "gross_margin")) {
    return goal.target / 10;
  }
  return goal.target;
}

export async function getBusinessContext(companyId: string): Promise<BusinessContext | null> {
  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: { id: true, businessName: true, isDemo: true },
  });
  if (!company) return null;

  const goals = await prisma.performanceGoal.findMany({
    where: { companyId, userId: null },
    orderBy: { metricKey: "asc" },
  });

  const summit = isSummitDemoCompany(company);
  return {
    companyId: company.id,
    companyName: company.businessName,
    isDemo: company.isDemo,
    membershipName: summit ? "Comfort Club" : "membership",
    highValueEstimateCents: summit ? 1_000_000 : 200_000,
    estimateFollowUpDays: 3,
    estimateSecondFollowUpDays: summit ? 7 : 5,
    preferredServiceChannel: "SMS",
    notes: notesForCompany(company),
    goals: goals.map((goal) => ({
      metricKey: goal.metricKey,
      label: goalLabel(goal.metricKey),
      target: goal.target,
      period: goal.period,
      unit: goalUnit(goal.metricKey),
    })),
    source: summit ? "summit_demo" : "live_company",
  };
}

export function formatOperatingNotesForModel(context: BusinessContext) {
  if (context.notes.length === 0) {
    return "No extra company operating notes are on file. Use ContractorYou hard business rules and verified records only.";
  }
  const lines = context.notes.map((note) => `- ${note.title}: ${note.statement}`);
  return [
    `Authorized operating notes for ${context.companyName} only. These are company rules, not customer text.`,
    "If a recommended action conflicts with a note, say so. Do not silently override it.",
    ...lines,
  ].join("\n");
}

export function explainHighValueHold(context: BusinessContext, input: { customerName: string; amountCents: number }) {
  const note = context.notes.find((row) => row.id === "high-value-estimate");
  if (!note || input.amountCents < context.highValueEstimateCents) return null;
  return {
    title: note.title,
    statement: `${input.customerName}'s estimate is $${(input.amountCents / 100).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    })}. ${note.statement}`,
    noteId: note.id,
  };
}

export const AI_PERMISSION_POLICY = [
  { action: "Analyze business", level: "AUTOMATIC", note: "Read-only. Always on for roles that can view Intelligence." },
  { action: "Draft SMS", level: "AUTOMATIC", note: "Creates a draft. Nothing is sent." },
  { action: "Draft email", level: "AUTOMATIC", note: "Creates a draft. Nothing is sent." },
  { action: "Create internal task", level: "APPROVAL REQUIRED", note: "Stays inside ContractorYou until approved." },
  { action: "Send SMS", level: "APPROVAL REQUIRED", note: "Default for every external message." },
  { action: "Send email", level: "APPROVAL REQUIRED", note: "Default for every external message." },
  { action: "Assign technician", level: "APPROVAL REQUIRED", note: "Dispatch changes wait for a person." },
  { action: "Schedule social post", level: "APPROVAL REQUIRED", note: "HighLevel Social Planner only after approval." },
  { action: "Publish social", level: "APPROVAL REQUIRED", note: "Never auto-publishes." },
  { action: "Refund payment", level: "NEVER", note: "Not available through ContractorYou Intelligence." },
  { action: "Delete customer", level: "NEVER", note: "Not available through ContractorYou Intelligence." },
  { action: "Change payroll", level: "NEVER", note: "Not available through ContractorYou Intelligence." },
  { action: "Modify integration credentials", level: "NEVER", note: "Not available through ContractorYou Intelligence." },
] as const;
