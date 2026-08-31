import { neutralizeCell } from "@/lib/imports/security";

const STATE_MAP: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const US_ABBREVS = new Set(Object.values(STATE_MAP));

export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function headerFingerprint(headers: string[]): string {
  return [...new Set(headers.map(normalizeHeader).filter(Boolean))].sort().join("|");
}

export function rawCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
}

export function normalizeText(value: unknown): string {
  return neutralizeCell(rawCell(value));
}

/** Undo CSV formula neutralization and Excel `="value"` wrappers. */
export function unwrapSpreadsheetValue(value: unknown): string {
  let text = normalizeText(value);
  if (!text) return "";
  if (text.startsWith("'") && text.length > 1 && "+=-@".includes(text[1] ?? "")) {
    text = text.slice(1);
  }
  const quotedFormula = /^="([^"]*)"$/.exec(text);
  if (quotedFormula) return quotedFormula[1] ?? "";
  if (text.startsWith("=")) {
    return text.slice(1).replace(/^["']|["']$/g, "");
  }
  return text;
}

/**
 * Housecall / similar exports often put "First Last 123 Main St City ST 12345 USA"
 * in a single Address column. Parse from the zip backward so street names stay intact.
 */
export function parseCombinedPersonAddress(value: unknown): {
  name: string;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
} | null {
  const cleaned = unwrapSpreadsheetValue(value).replace(/\s+USA?$/i, "").trim();
  if (!cleaned) return null;
  const zipMatch = cleaned.match(/^(.*?)\s+(\d{5}(?:-\d{4})?)$/);
  if (!zipMatch) return null;
  let rest = zipMatch[1] ?? "";
  const zip = normalizePostal(zipMatch[2] ?? "");
  const stateMatch = rest.match(/^(.*?)\s+([A-Za-z]{2})$/);
  if (!stateMatch) return null;
  rest = stateMatch[1] ?? "";
  const state = normalizeState(stateMatch[2]).state;
  const streetStart = rest.search(/\d/);
  if (streetStart < 0) return null;
  const name = rest.slice(0, streetStart).trim();
  const streetAndCity = rest.slice(streetStart).trim();
  const cityMatch = streetAndCity.match(/^(.*)\s+([A-Za-z][A-Za-z.'-]*)$/);
  if (!cityMatch?.[1] || !cityMatch[2]) return null;
  const split = splitFullName(name);
  return {
    name,
    firstName: split.firstName,
    lastName: split.lastName,
    address: cityMatch[1].trim(),
    city: cityMatch[2].trim(),
    state,
    zip,
  };
}

export function normalizeEmail(value: unknown): string | null {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  return text;
}

export function isValidEmail(value: string | null): boolean {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255;
}

export function digitsOnly(value: unknown): string {
  return normalizeText(value).replace(/\D/g, "");
}

export function normalizePhone(value: unknown): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return normalizeText(value) || null;
}

export function normalizeState(value: unknown): { state: string; recognized: boolean } {
  const text = normalizeText(value);
  if (!text) return { state: "", recognized: true };
  const upper = text.toUpperCase();
  if (US_ABBREVS.has(upper)) return { state: upper, recognized: true };
  const mapped = STATE_MAP[text.toLowerCase()];
  if (mapped) return { state: mapped, recognized: true };
  return { state: text, recognized: false };
}

export function normalizePostal(value: unknown): string {
  const text = normalizeText(value).toUpperCase();
  const digits = text.replace(/\D/g, "");
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (digits.length === 5) return digits;
  return text;
}

export function parseBoolean(value: unknown): boolean | null {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  if (["true", "yes", "y", "1", "on", "checked"].includes(text)) return true;
  if (["false", "no", "n", "0", "off", "unchecked"].includes(text)) return false;
  return null;
}

export function parseCurrencyToCents(value: unknown): number | null {
  const text = normalizeText(value);
  if (!text) return null;
  const negative = text.includes("(") && text.includes(")");
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  return negative ? -cents : cents;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/;

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = normalizeText(value);
  if (!text) return null;
  const iso = DATE_ONLY.exec(text);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const us = US_DATE.exec(text);
  if (us) {
    const year = Number(us[3].length === 2 ? `20${us[3]}` : us[3]);
    const date = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = normalizeText(fullName).split(" ").filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: parts[0]! };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

export function splitTags(value: unknown): string[] {
  return normalizeText(value)
    .split(/[|,;]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((tag) => tag.slice(0, 50));
}

export function nameKey(firstName: string, lastName: string, businessName?: string | null): string {
  const business = normalizeText(businessName || "").toLowerCase();
  if (business) return `biz:${business}`;
  return `name:${normalizeText(firstName).toLowerCase()}|${normalizeText(lastName).toLowerCase()}`;
}

export function addressKey(address: string, city: string, zip: string): string {
  return [normalizeText(address).toLowerCase(), normalizeText(city).toLowerCase(), normalizePostal(zip)]
    .filter(Boolean)
    .join("|");
}
