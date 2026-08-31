export const IMPORT_MODE_HISTORICAL = "HISTORICAL";
export const IMPORT_MODE_LIVE = "LIVE";

export function isHistoricalImport(mode?: string | null): boolean {
  return mode === IMPORT_MODE_HISTORICAL;
}

export function historicalProvenanceNote(sourceSystem?: string | null): string {
  const source = sourceSystem ? sourceSystem.replaceAll("_", " ").toLowerCase() : "another system";
  return `Imported historical record from ${source}. ContractorYou did not send messages, start billing, or take a payment.`;
}
