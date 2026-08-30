import {
  SOURCE_LABELS,
  type ImportMapping,
  type ImportSourceTypeId,
  type MappingConfidence,
  type TargetField,
} from "@/lib/imports/types";
import { headerFingerprint, normalizeHeader } from "@/lib/imports/normalize";

type Preset = {
  id: string;
  name: string;
  sourceType: ImportSourceTypeId;
  headers: string[];
  mapping: Record<string, TargetField>;
};

const PRESETS: Preset[] = [
  {
    id: "housecall_pro_customers",
    name: "Housecall Pro customer export",
    sourceType: "HOUSECALL_PRO",
    headers: [
      "customer id",
      "first name",
      "last name",
      "company",
      "email",
      "mobile number",
      "home number",
      "lead source",
      "tags",
      "notes",
      "address",
      "city",
      "state",
      "zip",
      "customer since",
      "lifetime value",
      "do not service",
    ],
    mapping: {
      "customer id": "externalId",
      "first name": "firstName",
      "last name": "lastName",
      company: "businessName",
      email: "email",
      "mobile number": "secondaryPhone",
      "home number": "phone",
      "work number": "secondaryPhone",
      "lead source": "source",
      tags: "tags",
      notes: "notes",
      address: "address",
      city: "city",
      state: "state",
      zip: "zip",
      "service address": "serviceAddress",
      "service city": "serviceCity",
      "service state": "serviceState",
      "service zip": "serviceZip",
      "customer since": "customerSince",
      "lifetime value": "lifetimeValue",
      "do not service": "doNotService",
      notifications: "marketingConsent",
    },
  },
  {
    id: "jobber_clients",
    name: "Jobber client export",
    sourceType: "JOBBER",
    headers: [
      "client id",
      "first name",
      "last name",
      "company name",
      "email",
      "phone number",
      "mobile phone",
      "street",
      "city",
      "province",
      "postal code",
    ],
    mapping: {
      "client id": "externalId",
      "first name": "firstName",
      "last name": "lastName",
      "company name": "businessName",
      email: "email",
      "phone number": "phone",
      "mobile phone": "secondaryPhone",
      street: "address",
      city: "city",
      province: "state",
      "postal code": "zip",
      notes: "notes",
      tags: "tags",
    },
  },
  {
    id: "servicetitan_customers",
    name: "ServiceTitan customer export",
    sourceType: "SERVICETITAN",
    headers: ["customer id", "name", "type", "phone", "email", "street", "city", "state", "zip", "created on"],
    mapping: {
      "customer id": "externalId",
      name: "fullName",
      type: "customerType",
      phone: "phone",
      email: "email",
      street: "address",
      unit: "address2",
      city: "city",
      state: "state",
      zip: "zip",
      "created on": "createdDate",
      balance: "lifetimeValue",
    },
  },
];

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export function matchVendorPreset(headers: string[]): {
  preset: Preset | null;
  sourceType: ImportSourceTypeId;
  confidence: MappingConfidence;
  score: number;
} {
  const incoming = new Set(headers.map(normalizeHeader).filter(Boolean));
  let best: { preset: Preset; score: number } | null = null;
  for (const preset of PRESETS) {
    const score = jaccard(incoming, new Set(preset.headers));
    if (!best || score > best.score) best = { preset, score };
  }
  const distinctive = new Set([
    "customer id",
    "client id",
    "mobile number",
    "lifetime value",
    "do not service",
    "province",
    "created on",
    "postal code",
  ]);
  const distinctiveHits = best
    ? best.preset.headers.filter((header) => incoming.has(header) && distinctive.has(header)).length
    : 0;
  if (!best || best.score < 0.45 || distinctiveHits < 1) {
    return { preset: null, sourceType: "UNKNOWN", confidence: "none", score: best?.score ?? 0 };
  }
  return {
    preset: best.preset,
    sourceType: best.preset.sourceType,
    confidence: best.score >= 0.7 ? "high" : best.score >= 0.5 ? "medium" : "low",
    score: best.score,
  };
}

export function presetToMapping(preset: Preset, headers: string[]): ImportMapping {
  return {
    columns: headers.map((header) => {
      const target = preset.mapping[normalizeHeader(header)] ?? "ignore";
      return {
        sourceColumn: header,
        target,
        confidence: target === "ignore" ? "none" : "high",
        suggestedBy: "preset" as const,
      };
    }),
  };
}

export function describeDetection(
  selected: ImportSourceTypeId,
  headers: string[]
): {
  detectedSource: ImportSourceTypeId;
  detectedSourceLabel: string;
  detectedSourceConfidence: MappingConfidence;
  presetName: string | null;
  message: string;
  presetMapping: ImportMapping | null;
} {
  const match = matchVendorPreset(headers);
  if (match.preset && match.confidence !== "none") {
    return {
      detectedSource: match.sourceType,
      detectedSourceLabel: SOURCE_LABELS[match.sourceType],
      detectedSourceConfidence: match.confidence,
      presetName: match.preset.name,
      message: `Looks like a ${match.preset.name}. We preloaded matches — you can still change them.`,
      presetMapping: presetToMapping(match.preset, headers),
    };
  }
  const selectedLabel = SOURCE_LABELS[selected];
  return {
    detectedSource: selected === "UNKNOWN" || selected === "SPREADSHEET" ? "UNKNOWN" : selected,
    detectedSourceLabel: selectedLabel,
    detectedSourceConfidence: "none",
    presetName: null,
    message: `We couldn't identify the source, but we found ${headers.length} columns. Let's match them to ContractorYou.`,
    presetMapping: null,
  };
}

export function fingerprintFor(headers: string[]): string {
  return headerFingerprint(headers);
}

export { PRESETS };
