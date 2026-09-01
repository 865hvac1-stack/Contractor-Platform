import { historicalProvenanceNote } from "@/lib/imports/safety";
import type { ImportedField } from "@/lib/jobs/imported-history";

export type WorkBlock = {
  key: string;
  label: string;
  text: string;
};

export type WorkSummary = {
  jobType: string | null;
  blocks: WorkBlock[];
  hasWorkDetail: boolean;
  emptyMessage: string | null;
};

const GENERIC_JOB_TYPE = /^(service call|maintenance|tune[-\s]?up|install(?:ation)?|repair|inspection|diagnostic|no heat|no cool(?:ing)?|hvac|service|job)$/i;

const WORK_LABELS: Record<string, string> = {
  notes: "Work notes",
  note: "Work notes",
  comments: "Comments",
  comment: "Comments",
  description: "Description",
  invoicenotes: "Invoice notes",
  jobnotes: "Job notes",
  privatenotes: "Private notes",
  customernotes: "Customer notes",
  internalnotes: "Work notes",
  techniciannotes: "Technician notes",
  technotes: "Technician notes",
  workperformed: "Work performed",
  workdone: "Work performed",
  workdescription: "Work performed",
  descriptionofwork: "Work performed",
  diagnosis: "Diagnosis",
  findings: "Findings",
  recommendations: "Recommendations",
  recommendation: "Recommendations",
  lineitems: "Line items",
  services: "Services",
  resolution: "Resolution",
  actiontaken: "Action taken",
  summary: "Summary",
  details: "Details",
};

function compactKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isGenericJobTypeLabel(text: string | null | undefined) {
  const value = (text ?? "").trim();
  if (!value) return false;
  if (value.length > 48) return false;
  return GENERIC_JOB_TYPE.test(value);
}

export function isWorkFieldKey(key: string) {
  const compact = compactKey(key);
  if (WORK_LABELS[compact]) return true;
  if (compact.includes("note") || compact.includes("comment")) return true;
  if (compact.includes("work") && (compact.includes("perform") || compact.includes("done") || compact.includes("desc"))) {
    return true;
  }
  return false;
}

export function stripImportBoilerplate(text: string) {
  const provenance = historicalProvenanceNote();
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line === provenance) return false;
      if (/^imported historical record from /i.test(line)) return false;
      if (/^historical technician:/i.test(line)) return false;
      if (/^contractoryou did not send messages/i.test(line)) return false;
      return true;
    })
    .join("\n\n")
    .trim();
}

function labelForWorkKey(key: string) {
  const compact = compactKey(key);
  return WORK_LABELS[compact] ?? key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

function addBlock(blocks: WorkBlock[], seen: Set<string>, key: string, label: string, raw: string | null | undefined) {
  const text = stripImportBoilerplate((raw ?? "").trim());
  if (!text) return;
  const fingerprint = text.replace(/\s+/g, " ").toLowerCase();
  if (seen.has(fingerprint)) return;
  for (const existing of [...seen]) {
    if (existing.includes(fingerprint) || fingerprint.includes(existing)) {
      if (fingerprint.length <= existing.length) return;
      const index = blocks.findIndex((block) => block.text.replace(/\s+/g, " ").toLowerCase() === existing);
      if (index >= 0) blocks.splice(index, 1);
      seen.delete(existing);
    }
  }
  seen.add(fingerprint);
  blocks.push({ key, label, text });
}

export function buildWorkSummary(input: {
  jobType?: string | null;
  serviceTypeName?: string | null;
  description?: string | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
  importDescription?: string | null;
  importNotes?: string | null;
  importFields?: ImportedField[];
}): WorkSummary {
  const jobType =
    input.serviceTypeName?.trim() ||
    input.jobType?.trim() ||
    (isGenericJobTypeLabel(input.description) ? input.description!.trim() : null) ||
    (isGenericJobTypeLabel(input.importDescription) ? input.importDescription!.trim() : null) ||
    null;

  const blocks: WorkBlock[] = [];
  const seen = new Set<string>();

  addBlock(blocks, seen, "importNotes", "Work notes", input.importNotes);
  addBlock(blocks, seen, "internalNotes", "Work notes", input.internalNotes);
  addBlock(blocks, seen, "customerNotes", "Customer notes", input.customerNotes);

  const description = input.description?.trim() || input.importDescription?.trim() || "";
  if (description && !isGenericJobTypeLabel(description) && description !== jobType) {
    addBlock(blocks, seen, "description", "Description", description);
  }

  for (const field of input.importFields ?? []) {
    if (!isWorkFieldKey(field.key)) continue;
    addBlock(blocks, seen, field.key, field.label || labelForWorkKey(field.key), field.value);
  }

  const hasWorkDetail = blocks.length > 0;
  let emptyMessage: string | null = null;
  if (!hasWorkDetail) {
    emptyMessage = jobType
      ? `This job was recorded as ${jobType}. The original file did not include notes or a description of the work that was performed.`
      : "No work notes were saved on this job.";
  }

  return { jobType, blocks, hasWorkDetail, emptyMessage };
}
