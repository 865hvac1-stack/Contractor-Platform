import type { QboTransport } from "@/lib/quickbooks/client";
import { isQuickBooksWriteMethod, QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE } from "@/lib/quickbooks/writeback";

export function readOnlyQuickBooksTransport(transport: QboTransport): QboTransport {
  const wrapped: QboTransport = async (input) => {
    if (isQuickBooksWriteMethod(input.method)) {
      throw new Error(`${QUICKBOOKS_WRITEBACK_DISABLED_MESSAGE} Read-only QuickBooks transport blocked ${input.method} ${input.path}.`);
    }
    return transport(input);
  };
  wrapped.context = transport.context;
  return wrapped;
}

type QueryResponse = { QueryResponse?: Record<string, unknown> & { totalCount?: number; maxResults?: number } };

export function queryTotal(json: unknown): number {
  const response = (json as QueryResponse).QueryResponse;
  if (typeof response?.totalCount === "number") return response.totalCount;
  if (typeof response?.maxResults === "number") return response.maxResults;
  return 0;
}

export function queryRows<T>(json: unknown, key: string): T[] {
  const rows = (json as QueryResponse).QueryResponse?.[key];
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function qboCount(transport: QboTransport, entity: string, where?: string) {
  const clause = where ? ` where ${where}` : "";
  const result = await transport({
    method: "GET",
    path: "/query",
    query: `select count(*) from ${entity}${clause}`,
  });
  if (!result.ok) return { ok: false as const, status: result.status, count: 0 };
  return { ok: true as const, status: result.status, count: queryTotal(result.json) };
}

export async function qboPage<T>(
  transport: QboTransport,
  entity: string,
  key: string,
  start = 1,
  max = 50,
  where?: string
) {
  const clause = where ? ` where ${where}` : "";
  const result = await transport({
    method: "GET",
    path: "/query",
    query: `select * from ${entity}${clause} STARTPOSITION ${start} MAXRESULTS ${max}`,
  });
  if (!result.ok) {
    return { ok: false as const, status: result.status, rows: [] as T[] };
  }
  return { ok: true as const, status: result.status, rows: queryRows<T>(result.json, key) };
}

export function dollarsToCents(value?: number | string | null) {
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function parseQboDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type QboAddress = {
  Line1?: string;
  Line2?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
};

export function usableServiceAddress(address?: QboAddress | null) {
  const street = (address?.Line1 || "").trim();
  const city = (address?.City || "").trim();
  const zip = (address?.PostalCode || "").trim();
  if (!street || !city || !zip) return null;
  return {
    address: [street, address?.Line2].filter(Boolean).join(" ").trim(),
    city,
    state: (address?.CountrySubDivisionCode || "").trim().slice(0, 2).toUpperCase() || "NA",
    zip: zip.slice(0, 16),
  };
}

export function addressesLookTheSame(a?: QboAddress | null, b?: QboAddress | null) {
  if (!a || !b) return false;
  const key = (addr: QboAddress) =>
    `${(addr.Line1 || "").toLowerCase().replace(/[^a-z0-9]/g, "")}|${(addr.City || "").toLowerCase()}|${(addr.PostalCode || "").replace(/\D/g, "").slice(0, 5)}`;
  const left = key(a);
  const right = key(b);
  return Boolean(left.replace(/\|/g, "") && left === right);
}
