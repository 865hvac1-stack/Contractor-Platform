import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { checkIntelligenceRateLimit } from "@/lib/intelligence/rate-limit";
import { openaiConfigured } from "@/lib/intelligence/config";
import { getAIProvider, wrapUntrustedData, type ChatMessage } from "@/lib/intelligence/provider";
import { loadJobImportSupplement } from "@/lib/jobs/imported-history";
import { buildWorkSummary } from "@/lib/jobs/work-summary";

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

const PURPOSE_LABEL: Record<WritingPurpose, string> = {
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

const STYLE_GUIDE: Record<WritingStyle, string> = {
  concise: "Write one or two short sentences.",
  professional: "Write two or three clear sentences a homeowner can understand.",
  detailed: "Write a short paragraph. Still use only the supplied facts.",
};

export function parseWritingStyle(value?: string | null): WritingStyle {
  return WRITING_STYLES.includes(value as WritingStyle) ? (value as WritingStyle) : "professional";
}

export type JobWriterContext = {
  serviceType: string | null;
  jobType: string | null;
  status: string | null;
  workNotes: string[];
  parts: string[];
};

export function sanitizeWriterNotes(notes: string) {
  return notes.trim().slice(0, 2000);
}

export function buildWritingMessages(input: {
  purpose: WritingPurpose;
  notes: string;
  style: WritingStyle;
  job?: JobWriterContext | null;
}): ChatMessage[] {
  const system = [
    "You are ContractorYou's writing assistant.",
    `Rewrite the contractor's field notes into a clear, professional ${PURPOSE_LABEL[input.purpose]}.`,
    "Preserve the facts exactly.",
    "Do not invent diagnostics, tests, parts, measurements, warranties, results, or work that are not present in the supplied notes or verified job context.",
    "Use plain language a homeowner can understand.",
    "Do not exaggerate.",
    "Do not add pricing.",
    "Do not make legal or warranty promises.",
    STYLE_GUIDE[input.style],
    "Return only the improved text. No title, quotes, or commentary.",
  ].join("\n");

  const user = [
    `Style: ${input.style}`,
    wrapUntrustedData("technician_notes", { notes: input.notes }),
    input.job
      ? wrapUntrustedData("verified_job_context", {
          serviceType: input.job.serviceType,
          jobType: input.job.jobType,
          status: input.job.status,
          workNotes: input.job.workNotes,
          parts: input.job.parts,
        })
      : "No additional verified job context.",
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export async function loadJobWriterContext(companyId: string, jobId: string): Promise<JobWriterContext | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      id: true,
      jobType: true,
      status: true,
      description: true,
      internalNotes: true,
      importMode: true,
      importSessionId: true,
      sourceSystem: true,
      externalId: true,
      importedSnapshot: true,
      importedOccurredAt: true,
      importedTotalCents: true,
      importedTechnicianName: true,
      createdAt: true,
      serviceType: { select: { name: true } },
      estimate: { select: { status: true, lineItems: { select: { name: true }, take: 12 } } },
      invoices: {
        where: { status: { not: "VOID" } },
        select: { lineItems: { select: { name: true }, take: 12 } },
        take: 3,
      },
      estimates: {
        where: { status: "APPROVED" },
        select: { lineItems: { select: { name: true }, take: 12 } },
        take: 2,
      },
    },
  });
  if (!job) return null;

  const supplement = await loadJobImportSupplement(prisma, companyId, {
    jobId: job.id,
    importMode: job.importMode,
    importSessionId: job.importSessionId,
    sourceSystem: job.sourceSystem,
    externalId: job.externalId,
    importedSnapshot: job.importedSnapshot,
    importedOccurredAt: job.importedOccurredAt,
    importedTotalCents: job.importedTotalCents,
    importedTechnicianName: job.importedTechnicianName,
    description: job.description,
    internalNotes: job.internalNotes,
    createdAt: job.createdAt,
  });
  const work = buildWorkSummary({
    jobType: job.jobType,
    description: job.description,
    internalNotes: job.internalNotes,
    importNotes: supplement.notes,
    importDescription: supplement.description,
    importFields: supplement.workFields,
  });
  const estimateLines =
    job.estimate?.status === "APPROVED" ? job.estimate.lineItems.map((item) => item.name) : [];
  const parts = [
    ...job.invoices.flatMap((invoice) => invoice.lineItems.map((item) => item.name)),
    ...estimateLines,
    ...job.estimates.flatMap((estimate) => estimate.lineItems.map((item) => item.name)),
  ]
    .map((name) => name.trim())
    .filter(Boolean);
  const uniqueParts = [...new Set(parts)].slice(0, 12);

  return {
    serviceType: job.serviceType?.name ?? null,
    jobType: job.jobType,
    status: job.status,
    workNotes: work.blocks.map((block) => block.text).filter(Boolean).slice(0, 8),
    parts: uniqueParts,
  };
}

export async function writeProfessionalCopy(input: {
  companyId: string;
  userId: string;
  purpose: WritingPurpose;
  notes: string;
  style?: string | null;
  jobId?: string | null;
}) {
  const notes = sanitizeWriterNotes(input.notes);
  if (!notes) {
    return { ok: false as const, error: "Add what you did first.", unavailable: false };
  }

  const limited = checkIntelligenceRateLimit(`write:${input.companyId}:${input.userId}`, 30);
  if (!limited.ok) return { ok: false as const, error: limited.error, unavailable: false };

  if (!openaiConfigured() || !getAIProvider()) {
    return {
      ok: false as const,
      unavailable: true,
      error: "AI writing is unavailable right now. You can continue using your description.",
    };
  }

  const style = parseWritingStyle(input.style);
  const job = input.jobId ? await loadJobWriterContext(input.companyId, input.jobId) : null;
  const provider = getAIProvider();
  if (!provider) {
    return {
      ok: false as const,
      unavailable: true,
      error: "AI writing is unavailable right now. You can continue using your description.",
    };
  }

  try {
    const result = await provider.complete({
      messages: buildWritingMessages({ purpose: input.purpose, notes, style, job }),
      tools: false,
    });
    const text = result.text.trim();
    if (!text) {
      return {
        ok: false as const,
        unavailable: true,
        error: "AI writing is unavailable right now. You can continue using your description.",
      };
    }
    await writeAudit({
      companyId: input.companyId,
      actorId: input.userId,
      action: "intelligence.writing_generated",
      entityType: "Invoice",
      entityId: input.jobId ?? undefined,
    });
    return { ok: true as const, text, style, usedJobContext: Boolean(job) };
  } catch {
    return {
      ok: false as const,
      unavailable: true,
      error: "AI writing is unavailable right now. You can continue using your description.",
    };
  }
}
