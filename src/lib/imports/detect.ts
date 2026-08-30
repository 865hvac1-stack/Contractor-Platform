import {
  FIELD_KIND,
  SAMPLE_SIZE,
  TARGET_FIELDS,
  type ColumnMapping,
  type FieldKind,
  type ImportMapping,
  type MappingConfidence,
  type SampleColumn,
  type TargetField,
} from "@/lib/imports/types";
import { normalizeEmail, normalizeHeader, normalizeText, parseBoolean, parseCurrencyToCents, parseDate } from "@/lib/imports/normalize";

type Alias = { target: TargetField; tokens: string[]; confidence: MappingConfidence };

const ALIASES: Alias[] = [
  { target: "firstName", tokens: ["first name", "firstname", "first", "given name", "fname", "cust fname", "customer first name"], confidence: "high" },
  { target: "lastName", tokens: ["last name", "lastname", "last", "surname", "family name", "lname", "cust lname", "customer last name"], confidence: "high" },
  { target: "fullName", tokens: ["full name", "customer name", "client name", "contact name", "name", "display name"], confidence: "medium" },
  { target: "businessName", tokens: ["company", "company name", "business", "business name", "account name", "organization"], confidence: "high" },
  { target: "email", tokens: ["email", "email address", "primary email", "e mail", "customer email"], confidence: "high" },
  { target: "phone", tokens: ["phone", "phone number", "primary phone", "home number", "home phone", "main phone", "telephone"], confidence: "high" },
  { target: "secondaryPhone", tokens: ["mobile", "mobile number", "mobile phone", "cell", "cell phone", "alternate phone", "additional phone", "work number", "work phone"], confidence: "high" },
  { target: "notes", tokens: ["notes", "note", "comments", "comment", "description"], confidence: "high" },
  { target: "tags", tokens: ["tags", "tag", "labels", "label"], confidence: "high" },
  { target: "source", tokens: ["lead source", "source", "referral source", "heard about"], confidence: "high" },
  { target: "status", tokens: ["status", "customer status", "account status"], confidence: "medium" },
  { target: "externalId", tokens: ["customer id", "client id", "external id", "external customer id", "id", "account id", "cust id"], confidence: "high" },
  { target: "doNotService", tokens: ["do not service", "dns", "do not serve", "blocked"], confidence: "high" },
  { target: "marketingConsent", tokens: ["marketing consent", "notifications", "opt in", "marketing opt in", "email opt in"], confidence: "medium" },
  { target: "lifetimeValue", tokens: ["lifetime value", "lifetime rev", "lifetime revenue", "ltv", "balance"], confidence: "medium" },
  { target: "createdDate", tokens: ["created", "created date", "created on", "created at", "date created"], confidence: "medium" },
  { target: "lastServiceDate", tokens: ["last service", "last service date", "last job", "last visit"], confidence: "medium" },
  { target: "customerSince", tokens: ["customer since", "member since", "start date"], confidence: "medium" },
  { target: "customerType", tokens: ["customer type", "type", "account type"], confidence: "medium" },
  { target: "propertyName", tokens: ["property name", "location name", "service location name"], confidence: "medium" },
  { target: "address", tokens: ["address", "address line 1", "street", "street address", "address1", "billing street"], confidence: "medium" },
  { target: "address2", tokens: ["address line 2", "address2", "unit", "apt", "suite"], confidence: "high" },
  { target: "city", tokens: ["city", "town"], confidence: "medium" },
  { target: "state", tokens: ["state", "province", "region"], confidence: "medium" },
  { target: "zip", tokens: ["zip", "zip code", "postal", "postal code", "postcode"], confidence: "high" },
  { target: "country", tokens: ["country"], confidence: "high" },
  { target: "billingAddress", tokens: ["billing address", "billing street", "bill address"], confidence: "high" },
  { target: "billingCity", tokens: ["billing city", "bill city"], confidence: "high" },
  { target: "billingState", tokens: ["billing state", "bill state"], confidence: "high" },
  { target: "billingZip", tokens: ["billing zip", "billing postal", "bill zip"], confidence: "high" },
  { target: "serviceAddress", tokens: ["service address", "service street", "location address", "property address"], confidence: "high" },
  { target: "serviceCity", tokens: ["service city", "location city", "property city"], confidence: "high" },
  { target: "serviceState", tokens: ["service state", "location state", "property state"], confidence: "high" },
  { target: "serviceZip", tokens: ["service zip", "service postal", "location zip", "property zip"], confidence: "high" },
];

function scoreAlias(normalized: string, alias: Alias): number {
  if (alias.tokens.includes(normalized)) return alias.confidence === "high" ? 100 : 80;
  if (alias.tokens.some((token) => normalized === token || normalized.endsWith(` ${token}`) || normalized.startsWith(`${token} `))) {
    return 70;
  }
  if (alias.tokens.some((token) => normalized.includes(token) && token.length > 3)) return 45;
  return 0;
}

export function inferKindFromSamples(samples: string[]): FieldKind {
  const values = samples.map((sample) => normalizeText(sample)).filter(Boolean);
  if (values.length === 0) return "text";
  const emails = values.filter((value) => Boolean(normalizeEmail(value)?.includes("@") && value.includes(".")));
  if (emails.length / values.length >= 0.6) return "contact_email";
  const phones = values.filter((value) => value.replace(/\D/g, "").length >= 10);
  if (phones.length / values.length >= 0.6) return "contact_phone";
  const dates = values.filter((value) => parseDate(value));
  if (dates.length / values.length >= 0.6) return "date";
  const money = values.filter((value) => /\$/.test(value) || parseCurrencyToCents(value) != null);
  if (money.length / values.length >= 0.6 && values.some((value) => /\$/.test(value))) return "money";
  const bools = values.filter((value) => parseBoolean(value) != null);
  if (bools.length / values.length >= 0.7) return "bool";
  return "text";
}

export function detectTarget(header: string, samples: string[]): Omit<ColumnMapping, "sourceColumn" | "suggestedBy"> {
  const normalized = normalizeHeader(header);
  let best: { target: TargetField; score: number; confidence: MappingConfidence } | null = null;
  for (const alias of ALIASES) {
    const score = scoreAlias(normalized, alias);
    if (score > 0 && (!best || score > best.score)) {
      best = { target: alias.target, score, confidence: alias.confidence };
    }
  }
  const inferred = inferKindFromSamples(samples);
  if (!best) {
    if (inferred === "contact_email") return { target: "email", confidence: "medium" };
    if (inferred === "contact_phone") return { target: "phone", confidence: "low" };
    return { target: "ignore", confidence: "none" };
  }
  if (!mappingCompatible(best.target, inferred) && inferred !== "text") {
    return { target: "ignore", confidence: "none" };
  }
  return { target: best.target, confidence: best.score >= 80 ? "high" : best.score >= 60 ? "medium" : "low" };
}

export function mappingCompatible(target: TargetField, inferred: FieldKind): boolean {
  if (target === "ignore" || inferred === "text") return true;
  const expected = FIELD_KIND[target];
  if (expected === inferred) return true;
  if (expected === "name" && inferred === "id") return false;
  if (expected === "contact_email" && inferred !== "contact_email") return false;
  if (expected === "money" && inferred === "contact_email") return false;
  if (expected === "date" && inferred === "contact_email") return false;
  if (expected === "contact_phone" && inferred === "contact_email") return false;
  if (expected === "bool" && inferred === "contact_email") return false;
  if (expected === "id" && inferred === "contact_email") return false;
  return true;
}

export function analyzeColumns(headers: string[], rows: Record<string, string>[]): SampleColumn[] {
  return headers.map((header) => {
    const values = rows.map((row) => normalizeText(row[header] ?? ""));
    const samples = values.filter(Boolean).slice(0, SAMPLE_SIZE);
    const unique = new Set(values.filter(Boolean));
    return {
      header,
      normalizedHeader: normalizeHeader(header),
      samples,
      blankCount: values.filter((value) => !value).length,
      uniqueCount: unique.size,
      inferredKind: inferKindFromSamples(samples),
    };
  });
}

export function autoMapColumns(columns: SampleColumn[], preset?: ImportMapping | null): ImportMapping {
  const used = new Set<TargetField>();
  const fromPreset = new Map((preset?.columns ?? []).map((column) => [normalizeHeader(column.sourceColumn), column]));
  const mapped: ColumnMapping[] = columns.map((column) => {
    const presetHit = fromPreset.get(column.normalizedHeader);
    if (
      presetHit &&
      presetHit.target !== "ignore" &&
      mappingCompatible(presetHit.target, column.inferredKind)
    ) {
      used.add(presetHit.target);
      return { ...presetHit, sourceColumn: column.header, suggestedBy: "preset" };
    }
    const detected = detectTarget(column.header, column.samples);
    let target = detected.target;
    if (target !== "ignore" && used.has(target)) {
      if (target === "phone") target = used.has("secondaryPhone") ? "ignore" : "secondaryPhone";
      else if (target === "address") target = used.has("serviceAddress") ? "ignore" : "serviceAddress";
      else if (target === "city") target = used.has("serviceCity") ? "ignore" : "serviceCity";
      else if (target === "state") target = used.has("serviceState") ? "ignore" : "serviceState";
      else if (target === "zip") target = used.has("serviceZip") ? "ignore" : "serviceZip";
      else target = "ignore";
    }
    if (target !== "ignore") used.add(target);
    return {
      sourceColumn: column.header,
      target,
      confidence: target === "ignore" ? "none" : detected.confidence,
      suggestedBy: "rule",
    };
  });
  return { columns: mapped };
}

export function isKnownTarget(value: string): value is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(value);
}
