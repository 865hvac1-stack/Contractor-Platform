import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { loadSchedulingCustomerContext, resolveSchedulingCustomer } from "@/lib/scheduling/conversation-identity";
import type { ReceptionistV2Action, VerifiedFacts } from "@/lib/intelligence/receptionist/v2/types";

const MUTATING_ACTIONS = new Set<ReceptionistV2Action>([
  "checkAvailability",
  "startScheduling",
  "selectOfferedSlot",
  "bookAppointment",
  "requestHumanHandoff",
]);

export function isMutatingReceptionistAction(action: ReceptionistV2Action) {
  return MUTATING_ACTIONS.has(action);
}

export async function runReceptionistTool(input: {
  companyId: string;
  action: ReceptionistV2Action;
  phone?: string | null;
  customerId?: string | null;
  contactId?: string | null;
  threadId?: string | null;
  shadow: boolean;
}): Promise<{ action: ReceptionistV2Action; facts: Partial<VerifiedFacts>; skipped?: string }> {
  if (input.shadow && isMutatingReceptionistAction(input.action)) {
    return { action: input.action, facts: {}, skipped: "shadow_no_mutation" };
  }

  const identity = await resolveSchedulingCustomer(prisma, {
    companyId: input.companyId,
    customerId: input.customerId,
    phone: input.phone,
    threadId: input.threadId,
    contactId: input.contactId,
  });
  const context = identity.customerId
    ? await loadSchedulingCustomerContext(prisma, { companyId: input.companyId, customerId: identity.customerId })
    : null;

  const facts: Partial<VerifiedFacts> = {
    customerId: context?.customerId ?? null,
    customerFirstName: context?.firstName || null,
    properties: context?.properties.map((row) => ({
      id: row.id,
      address: [row.address, row.city, row.state, row.zip].filter(Boolean).join(", "),
      isPrimary: row.isPrimary,
    })),
  };

  if (!context) return { action: input.action, facts };

  if (input.action === "getCustomerJobs" || input.action === "getAppointmentStatus") {
    const appointment = await loadVerifiedActiveAppointment({
      companyId: input.companyId,
      customerId: context.customerId,
    });
    if (appointment.hasActiveAppointment) {
      facts.hasActiveAppointment = true;
      facts.jobId = appointment.jobId;
      facts.bookingId = appointment.bookingId;
      facts.jobStatus = appointment.jobStatus;
    } else {
      const job = await prisma.job.findFirst({
        where: { companyId: input.companyId, customerId: context.customerId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          status: true,
          jobNumber: true,
          scheduledStart: true,
          schedulingBooking: { select: { id: true } },
        },
      });
      if (job) {
        facts.jobId = job.id;
        facts.bookingId = job.schedulingBooking?.id ?? null;
        facts.jobStatus = `Job ${job.jobNumber} is ${job.status.toLowerCase().replaceAll("_", " ")}.`;
      }
    }
  }

  if (input.action === "getInvoiceBalance") {
    const invoice = await prisma.invoice.findFirst({
      where: { companyId: input.companyId, customerId: context.customerId, balanceCents: { gt: 0 } },
      orderBy: { dueDate: "asc" },
      select: { invoiceNumber: true, balanceCents: true },
    });
    facts.invoiceBalance = invoice ? `${formatMoney(invoice.balanceCents)} on invoice ${invoice.invoiceNumber}` : null;
  }

  if (input.action === "getEstimateStatus") {
    const estimate = await prisma.estimate.findFirst({
      where: { companyId: input.companyId, customerId: context.customerId },
      orderBy: { updatedAt: "desc" },
      select: { estimateNumber: true, status: true, totalCents: true },
    });
    facts.estimateStatus = estimate
      ? `Estimate ${estimate.estimateNumber} is ${estimate.status.toLowerCase()} for ${formatMoney(estimate.totalCents)}.`
      : null;
  }

  if (input.action === "getMembershipStatus") {
    const membership = await prisma.customerMembership.findFirst({
      where: { companyId: input.companyId, customerId: context.customerId, status: "ACTIVE" },
      select: { status: true },
    });
    facts.hasActiveMembership = Boolean(membership);
    facts.membershipStatus = membership
      ? `I show a ${membership.status.toLowerCase().replaceAll("_", " ")} maintenance plan on your account.`
      : "I don't see an active maintenance plan on your account right now.";
  }

  if (input.action === "getWaitingStatus") {
    const waiting = await prisma.waitingRecord.findFirst({
      where: { companyId: input.companyId, customerId: context.customerId, state: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      select: { reason: true, column: { select: { name: true } } },
    });
    facts.waitingStatus = waiting
      ? `You’re on our waiting board for ${waiting.reason}${waiting.column?.name ? ` (${waiting.column.name})` : ""}.`
      : null;
  }

  return { action: input.action, facts };
}

export async function loadVerifiedActiveAppointment(input: { companyId: string; customerId: string }) {
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const job = await prisma.job.findFirst({
    where: {
      companyId: input.companyId,
      customerId: input.customerId,
      status: { in: ["SCHEDULED", "DISPATCHED", "IN_PROGRESS"] },
      OR: [{ scheduledStart: { gte: since } }, { scheduledStart: null }],
    },
    orderBy: { scheduledStart: "asc" },
    select: {
      id: true,
      status: true,
      jobNumber: true,
      scheduledStart: true,
      schedulingBooking: { select: { id: true } },
    },
  });
  if (!job) {
    return {
      hasActiveAppointment: false as const,
      jobId: null,
      bookingId: null,
      jobStatus: null,
      scheduledStart: null,
    };
  }
  return {
    hasActiveAppointment: true as const,
    jobId: job.id,
    bookingId: job.schedulingBooking?.id ?? null,
    jobStatus: `Job ${job.jobNumber} is ${job.status.toLowerCase().replaceAll("_", " ")}.`,
    scheduledStart: job.scheduledStart,
  };
}

export function actionForIntent(intent: string): ReceptionistV2Action {
  if (intent === "INVOICE_BALANCE" || intent === "PAYMENT_QUESTION") return "getInvoiceBalance";
  if (intent === "ESTIMATE_STATUS") return "getEstimateStatus";
  if (intent === "MEMBERSHIP" || intent === "MAINTENANCE") return "getMembershipStatus";
  if (intent === "WAITING_PART_STATUS") return "getWaitingStatus";
  if (intent === "JOB_STATUS") return "getAppointmentStatus";
  if (intent === "SCHEDULING" || intent === "RESCHEDULE") return "startScheduling";
  if (intent === "HUMAN_REQUEST" || intent === "COMPLAINT" || intent === "EMERGENCY") return "requestHumanHandoff";
  if (intent === "SERVICE_QUESTION" || intent === "GENERAL_QUESTION") return "answer_from_knowledge";
  if (intent === "SERVICE_CONCERN") return "continue_workflow";
  return "continue_workflow";
}
