"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { writeInvoiceDescriptionAction, type WritingState } from "@/server/actions/intelligence";
import { Button } from "@/components/ui/button";
import { WRITING_STYLES, type WritingStyle } from "@/lib/intelligence/writing";

const STYLE_LABEL: Record<WritingStyle, string> = {
  concise: "Concise",
  professional: "Professional",
  detailed: "Detailed",
};

export function ProfessionalWriter({
  notes,
  jobFieldId = "jobId",
  onUse,
}: {
  notes: string;
  jobFieldId?: string;
  onUse: (text: string) => void;
}) {
  const [style, setStyle] = useState<WritingStyle>("professional");
  const [preview, setPreview] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    writeInvoiceDescriptionAction,
    null as WritingState | null
  );
  const [, startTransition] = useTransition();
  const empty = !notes.trim();

  useEffect(() => {
    if (state?.ok && state.text) setPreview(state.text);
  }, [state]);

  function linkedJobId() {
    if (typeof document === "undefined") return "";
    const field = document.getElementById(jobFieldId) as HTMLSelectElement | HTMLInputElement | null;
    return field?.value ?? "";
  }

  function requestWrite() {
    if (empty || pending) return;
    const data = new FormData();
    data.set("notes", notes);
    data.set("style", style);
    data.set("jobId", linkedJobId());
    startTransition(() => {
      formAction(data);
    });
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/60 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
            <Sparkles className="size-3.5" aria-hidden />
            AI invoice writer
          </p>
          <div className="flex rounded-full bg-white p-0.5">
            {WRITING_STYLES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStyle(item)}
                className={`min-h-8 rounded-full px-2.5 text-[11px] font-medium ${
                  style === item ? "bg-[var(--cy-navy)] text-white" : "text-[var(--cy-text-secondary)]"
                }`}
              >
                {STYLE_LABEL[item]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Tell ContractorYou what you did. It improves wording and does not invent work.
        </p>
        <Button
          type="button"
          disabled={pending || empty}
          onClick={requestWrite}
          className="mt-2 h-11 w-full bg-[var(--cy-navy)] text-white hover:bg-[var(--cy-navy)]/90 sm:w-auto"
        >
          {pending ? "Writing…" : empty ? "Add work notes first" : "✨ Make this professional"}
        </Button>
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-[var(--muted-foreground)]" role="alert">
          {state.error}
        </p>
      ) : null}

      {preview ? (
        <div className="rounded-xl border border-[var(--border)] bg-white px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-navy)]">Suggested description</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--cy-navy)]">{preview}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11"
              onClick={() => {
                onUse(preview);
                setPreview(null);
              }}
            >
              Use this description
            </Button>
            <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={requestWrite}>
              Try again
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setPreview(null)}>
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
