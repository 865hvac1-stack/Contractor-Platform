import type { EstimateStatus, ExpenseCategory, InvoiceStatus, JobStatus, PaymentMethod } from "@prisma/client";

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const JOB_STATUS: Record<string, JobStatus> = {
  completed: "COMPLETED",
  complete: "COMPLETED",
  finished: "COMPLETED",
  closed: "COMPLETED",
  done: "COMPLETED",
  canceled: "CANCELED",
  cancelled: "CANCELED",
  void: "CANCELED",
  scheduled: "SCHEDULED",
  booked: "SCHEDULED",
  dispatched: "DISPATCHED",
  "en route": "DISPATCHED",
  "in progress": "IN_PROGRESS",
  started: "IN_PROGRESS",
  "on site": "IN_PROGRESS",
  "on hold": "ON_HOLD",
  paused: "ON_HOLD",
  new: "NEW",
  open: "NEW",
  unscheduled: "UNSCHEDULED",
};

const ESTIMATE_STATUS: Record<string, EstimateStatus> = {
  draft: "DRAFT",
  sent: "SENT",
  viewed: "VIEWED",
  approved: "APPROVED",
  accepted: "APPROVED",
  won: "APPROVED",
  declined: "DECLINED",
  rejected: "DECLINED",
  lost: "DECLINED",
  expired: "EXPIRED",
  canceled: "CANCELED",
  cancelled: "CANCELED",
};

const INVOICE_STATUS: Record<string, InvoiceStatus> = {
  draft: "DRAFT",
  sent: "SENT",
  open: "SENT",
  partial: "PARTIALLY_PAID",
  "partially paid": "PARTIALLY_PAID",
  paid: "PAID",
  closed: "PAID",
  overdue: "OVERDUE",
  "past due": "OVERDUE",
  void: "VOID",
  canceled: "VOID",
};

const PAY_METHOD: Record<string, PaymentMethod> = {
  cash: "CASH",
  check: "CHECK",
  cheque: "CHECK",
  card: "CREDIT_CARD",
  "credit card": "CREDIT_CARD",
  visa: "CREDIT_CARD",
  mastercard: "CREDIT_CARD",
  ach: "ACH",
  bank: "ACH",
};

const EXPENSE_CAT: Record<string, ExpenseCategory> = {
  materials: "MATERIALS",
  parts: "MATERIALS",
  equipment: "EQUIPMENT",
  fuel: "FUEL",
  gas: "FUEL",
  subcontractor: "SUBCONTRACTOR",
  permits: "PERMITS",
  tools: "TOOLS",
  vehicle: "VEHICLE",
  office: "OFFICE",
  advertising: "ADVERTISING",
  insurance: "INSURANCE",
};

export function mapJobStatus(raw: string): { status: JobStatus; recognized: boolean } {
  const key = norm(raw);
  if (!key) return { status: "NEW", recognized: true };
  const status = JOB_STATUS[key];
  return status ? { status, recognized: true } : { status: "NEW", recognized: false };
}

export function mapEstimateStatus(raw: string): { status: EstimateStatus; recognized: boolean } {
  const key = norm(raw);
  if (!key) return { status: "DRAFT", recognized: true };
  const status = ESTIMATE_STATUS[key];
  return status ? { status, recognized: true } : { status: "DRAFT", recognized: false };
}

export function mapInvoiceStatus(raw: string): { status: InvoiceStatus; recognized: boolean } {
  const key = norm(raw);
  if (!key) return { status: "DRAFT", recognized: true };
  const status = INVOICE_STATUS[key];
  return status ? { status, recognized: true } : { status: "DRAFT", recognized: false };
}

export function mapPaymentMethod(raw: string): PaymentMethod {
  return PAY_METHOD[norm(raw)] ?? "OTHER";
}

export function mapExpenseCategory(raw: string): ExpenseCategory {
  return EXPENSE_CAT[norm(raw)] ?? "OTHER";
}
