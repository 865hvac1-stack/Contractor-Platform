import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export async function recordAgentToolCall(input: {
  companyId: string;
  credentialId?: string | null;
  tool: "check_availability" | "book_appointment";
  success: boolean;
  errorCode?: string | null;
  httpStatus: number;
  locationId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
  serviceTypeId?: string | null;
  jobId?: string | null;
  bookingId?: string | null;
  durationMs: number;
}) {
  await prisma.agentToolCall.create({
    data: {
      companyId: input.companyId,
      credentialId: input.credentialId ?? null,
      tool: input.tool,
      success: input.success,
      errorCode: input.errorCode ?? null,
      httpStatus: input.httpStatus,
      locationId: input.locationId ?? null,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      customerId: input.customerId ?? null,
      propertyId: input.propertyId ?? null,
      serviceTypeId: input.serviceTypeId ?? null,
      jobId: input.jobId ?? null,
      bookingId: input.bookingId ?? null,
      durationMs: input.durationMs,
    },
  });
  await writeAudit({
    companyId: input.companyId,
    action: input.success ? `agent_tools.${input.tool}` : `agent_tools.${input.tool}_failed`,
    entityType: "AgentToolCall",
    entityId: input.jobId || input.customerId || input.companyId,
    metadata: {
      tool: input.tool,
      errorCode: input.errorCode ?? null,
      locationId: input.locationId ?? null,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      customerId: input.customerId ?? null,
      propertyId: input.propertyId ?? null,
      jobId: input.jobId ?? null,
      bookingId: input.bookingId ?? null,
      durationMs: input.durationMs,
    },
  });
}
