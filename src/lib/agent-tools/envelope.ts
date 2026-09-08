import { withStudioFields } from "@/lib/agent-tools/studio-fields";

export type AgentToolAction = "check_availability" | "book_appointment" | "select_offered_slot";

export type AgentToolError = {
  code: string;
  message: string;
};

export type AgentToolEnvelope<T> = {
  success: boolean;
  action: AgentToolAction;
  data: T | null;
  customer_message_context?: Record<string, unknown>;
  error: AgentToolError | null;
};

export function toolOk<T>(
  action: AgentToolAction,
  data: T,
  customerMessageContext?: Record<string, unknown>
) {
  return withStudioFields({
    success: true,
    action,
    data,
    customer_message_context: customerMessageContext,
    error: null,
  });
}

export function toolError(
  action: AgentToolAction,
  code: string,
  message: string,
  data: Record<string, unknown> | null = null,
  customerMessageContext?: Record<string, unknown>
) {
  return withStudioFields({
    success: false,
    action,
    data,
    customer_message_context: customerMessageContext,
    error: { code, message },
  });
}

export function httpStatusForCode(code: string) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "LOCATION_MISMATCH" || code === "FORBIDDEN") return 403;
  if (code === "RATE_LIMITED") return 429;
  if (code === "SLOT_NO_LONGER_AVAILABLE" || code === "DUPLICATE_MAINTENANCE") return 409;
  if (
    code === "SERVICE_ADDRESS_REQUIRED" ||
    code === "PROPERTY_SELECTION_REQUIRED" ||
    code === "CUSTOMER_NAME_REQUIRED" ||
    code === "SERVICE_TYPE_REQUIRED" ||
    code === "SLOT_TOKEN_INVALID"
  ) {
    return 422;
  }
  if (code === "INVALID_REQUEST") return 400;
  if (code === "INTERNAL_ERROR") return 500;
  return 400;
}
