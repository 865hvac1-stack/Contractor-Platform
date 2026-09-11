export {
  IMPORT_MODE_HISTORICAL,
  IMPORT_MODE_LIVE,
  IMPORT_MODE_REFERENCE,
  isHistoricalImport,
  isLiveOperational,
  isNonOperationalImport,
  isReferenceImport,
} from "@/lib/imports/modes";

export function historicalProvenanceNote(sourceSystem?: string | null): string {
  const source = sourceSystem ? sourceSystem.replaceAll("_", " ").toLowerCase() : "another system";
  return `Imported historical record from ${source}. ContractorYou did not send messages, start billing, or take a payment.`;
}
