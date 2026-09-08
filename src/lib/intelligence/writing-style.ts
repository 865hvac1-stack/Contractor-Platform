export const WRITING_STYLES = ["concise", "professional", "detailed"] as const;
export type WritingStyle = (typeof WRITING_STYLES)[number];

export type WritingPurpose =
  | "invoice_description"
  | "estimate_description"
  | "technician_notes"
  | "job_summary"
  | "customer_followup"
  | "warranty_explanation"
  | "recommended_repair"
  | "completion_summary"
  | "review_request";

export const PURPOSE_LABEL: Record<WritingPurpose, string> = {
  invoice_description: "customer-facing invoice description",
  estimate_description: "customer-facing estimate description",
  technician_notes: "clear technician note",
  job_summary: "customer-facing job summary",
  customer_followup: "customer follow-up message draft",
  warranty_explanation: "plain-language warranty explanation",
  recommended_repair: "recommended repair explanation",
  completion_summary: "work completion summary",
  review_request: "review request message draft",
};

export const STYLE_GUIDE: Record<WritingStyle, string> = {
  concise: "Write one or two short sentences.",
  professional: "Write two or three clear sentences a homeowner can understand.",
  detailed: "Write a short paragraph. Still use only the supplied facts.",
};

export function parseWritingStyle(value?: string | null): WritingStyle {
  return WRITING_STYLES.includes(value as WritingStyle) ? (value as WritingStyle) : "professional";
}

export function sanitizeWriterNotes(notes: string) {
  return notes.trim().slice(0, 2000);
}
