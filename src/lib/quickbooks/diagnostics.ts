export type QboFaultInfo = {
  type: string | null;
  code: string | null;
  message: string | null;
};

export class QboApiError extends Error {
  status: number;
  intuitTid: string | null;
  fault: QboFaultInfo | null;

  constructor(input: { message: string; status: number; intuitTid?: string | null; fault?: QboFaultInfo | null }) {
    super(input.message);
    this.name = "QboApiError";
    this.status = input.status;
    this.intuitTid = input.intuitTid ?? null;
    this.fault = input.fault ?? null;
  }
}

export function readIntuitTid(headers: Headers | { get(name: string): string | null }): string | null {
  const value =
    headers.get("intuit_tid") ||
    headers.get("Intuit-Tid") ||
    headers.get("intuit-tid") ||
    headers.get("INTUIT_TID");
  const tid = value?.trim();
  return tid || null;
}

export function parseQboFault(json: unknown): QboFaultInfo | null {
  if (!json || typeof json !== "object") return null;
  const fault = (json as { Fault?: { type?: unknown; Error?: unknown } }).Fault;
  if (!fault || typeof fault !== "object") return null;
  const errors = Array.isArray(fault.Error) ? fault.Error : [];
  const first = errors[0] && typeof errors[0] === "object" ? (errors[0] as { Message?: unknown; code?: unknown }) : null;
  const type = typeof fault.type === "string" ? fault.type : null;
  const code = first && typeof first.code === "string" ? first.code : first && typeof first.code === "number" ? String(first.code) : null;
  const message = first && typeof first.Message === "string" ? first.Message : null;
  if (!type && !code && !message) return null;
  return { type, code, message };
}

export function formatQboDiagnostic(input: {
  fallback: string;
  status?: number;
  intuitTid?: string | null;
  fault?: QboFaultInfo | null;
}) {
  const parts = [input.fallback];
  if (input.fault?.type || input.fault?.code || input.fault?.message) {
    const label = [input.fault.type, input.fault.code].filter(Boolean).join(" ");
    const detail = input.fault.message || "QuickBooks returned a validation or API error.";
    parts.push(label ? `${label}: ${detail}` : detail);
  } else if (input.status && input.status >= 400) {
    parts.push(`HTTP ${input.status}`);
  }
  if (input.intuitTid) parts.push(`intuit_tid=${input.intuitTid}`);
  return parts.join(" · ");
}

export function qboFailure(result: {
  ok: boolean;
  status: number;
  json: unknown;
  intuitTid?: string | null;
}, fallback: string) {
  const fault = parseQboFault(result.json);
  const intuitTid = result.intuitTid ?? null;
  return new QboApiError({
    message: formatQboDiagnostic({ fallback, status: result.status, intuitTid, fault }),
    status: result.status,
    intuitTid,
    fault,
  });
}

const SENSITIVE = /authorization|bearer |access_token|refresh_token|client_secret|password/i;

export function logQuickBooksDiagnostic(input: {
  method: string;
  path: string;
  status: number;
  intuitTid: string | null;
  fault?: QboFaultInfo | null;
}) {
  const path = input.path.split("?")[0];
  const payload = {
    source: "quickbooks",
    method: input.method,
    path,
    status: input.status,
    intuitTid: input.intuitTid,
    faultType: input.fault?.type ?? null,
    faultCode: input.fault?.code ?? null,
    faultMessage: input.fault?.message ?? null,
  };
  const serialized = JSON.stringify(payload);
  if (SENSITIVE.test(serialized)) return;
  console.info(serialized);
}
