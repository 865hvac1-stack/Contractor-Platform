import { NextResponse } from "next/server";
import { authenticateAgentToolRequest } from "@/lib/agent-tools/auth";
import { recordAgentToolCall } from "@/lib/agent-tools/audit";
import { normalizeAgentToolBody } from "@/lib/agent-tools/booking-contract";
import { httpStatusForCode, toolError, type AgentToolAction } from "@/lib/agent-tools/envelope";
import { checkAgentToolRateLimit } from "@/lib/agent-tools/rate-limit";

export async function handleAgentToolPost(input: {
  request: Request;
  action: AgentToolAction;
  run: (auth: { companyId: string; credentialId: string; body: unknown; idempotencyKey: string | null }) => Promise<{
    status: number;
    body: { success: boolean; error?: { code: string } | null };
    customerId?: string | null;
    propertyId?: string | null;
    serviceTypeId?: string | null;
    jobId?: string | null;
    bookingId?: string | null;
  }>;
}) {
  const started = Date.now();
  const auth = await authenticateAgentToolRequest(input.request);
  if (!auth.ok) {
    return NextResponse.json(toolError(input.action, auth.code, auth.message), { status: auth.status });
  }
  if (!checkAgentToolRateLimit(auth.credentialId).ok) {
    await recordAgentToolCall({
      companyId: auth.companyId,
      credentialId: auth.credentialId,
      tool: input.action,
      success: false,
      errorCode: "RATE_LIMITED",
      httpStatus: 429,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(toolError(input.action, "RATE_LIMITED", "Too many Agent Tool requests. Try again shortly."), {
      status: 429,
    });
  }

  let body: unknown = {};
  try {
    body = await input.request.json();
  } catch {
    return NextResponse.json(toolError(input.action, "INVALID_REQUEST", "Request body must be JSON."), { status: 400 });
  }

  const snapshot = normalizeAgentToolBody(body);
  try {
    const result = await input.run({
      companyId: auth.companyId,
      credentialId: auth.credentialId,
      body: snapshot,
      idempotencyKey: input.request.headers.get("idempotency-key"),
    });
    const errorCode = result.body.error?.code ?? null;
    await recordAgentToolCall({
      companyId: auth.companyId,
      credentialId: auth.credentialId,
      tool: input.action,
      success: result.body.success,
      errorCode,
      httpStatus: result.status,
      locationId: typeof snapshot.location_id === "string" ? snapshot.location_id : null,
      contactId: typeof snapshot.contact_id === "string" ? snapshot.contact_id : null,
      conversationId: typeof snapshot.conversation_id === "string" ? snapshot.conversation_id : null,
      customerId: result.customerId ?? null,
      propertyId: result.propertyId ?? null,
      serviceTypeId: result.serviceTypeId ?? null,
      jobId: result.jobId ?? null,
      bookingId: result.bookingId ?? null,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(result.body, { status: result.status || httpStatusForCode(errorCode || "") });
  } catch {
    await recordAgentToolCall({
      companyId: auth.companyId,
      credentialId: auth.credentialId,
      tool: input.action,
      success: false,
      errorCode: "INTERNAL_ERROR",
      httpStatus: 500,
      durationMs: Date.now() - started,
    });
    return NextResponse.json(toolError(input.action, "INTERNAL_ERROR", "The scheduling tool could not complete that request."), {
      status: 500,
    });
  }
}
