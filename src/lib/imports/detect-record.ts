import type { ImportRecordTypeId, MappingConfidence } from "@/lib/imports/types";
import { LIVE_ENTITY_TYPES, RECORD_TYPE_HINTS as HINTS } from "@/lib/imports/catalog";
import { normalizeHeader } from "@/lib/imports/normalize";

export function detectRecordType(headers: string[]): {
  type: ImportRecordTypeId | null;
  confidence: MappingConfidence;
  message: string;
} {
  const normalized = headers.map(normalizeHeader);
  let best: { type: ImportRecordTypeId; hits: number } | null = null;
  for (const hint of HINTS) {
    const hits = hint.tokens.filter((token) => normalized.some((header) => header.includes(token))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { type: hint.type, hits };
  }
  if (!best || best.hits < 2) {
    return {
      type: null,
      confidence: "none",
      message: "We could not tell what this file is. Choose the record type, then match the columns.",
    };
  }
  const label = best.type.toLowerCase().replaceAll("_", " ");
  return {
    type: best.type,
    confidence: best.hits >= 4 ? "high" : best.hits >= 3 ? "medium" : "low",
    message: `This looks like a ${label} export. You can change that if we guessed wrong.`,
  };
}

export function suggestedOverrideMessage(selected: ImportRecordTypeId, detected: ImportRecordTypeId | null) {
  if (!detected || detected === selected) return null;
  if (!LIVE_ENTITY_TYPES.includes(detected)) return null;
  return `We thought this was ${detected.toLowerCase().replaceAll("_", " ")}, but you chose ${selected.toLowerCase().replaceAll("_", " ")}. We will follow your choice.`;
}
