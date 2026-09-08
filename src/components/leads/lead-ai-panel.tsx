"use client";

import { useActionState } from "react";
import Link from "next/link";
import { writeLeadAssistantAction, type WritingState } from "@/server/actions/intelligence";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function LeadAiPanel({
  leadId,
  insights,
  summary,
  followUpAsk,
  canAsk,
  draftHref,
}: {
  leadId: string;
  insights: { id: string; text: string }[];
  summary: string;
  followUpAsk?: string | null;
  canAsk: boolean;
  draftHref?: string | null;
}) {
  const [state, action, pending] = useActionState(writeLeadAssistantAction, null as WritingState | null);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
        ContractorYou Intelligence
      </p>
      <ul className="mt-3 space-y-2 text-sm text-[var(--cy-navy)]">
        {insights.map((insight) => (
          <li key={insight.id}>{insight.text}</li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-[var(--muted-foreground)]">{summary}</p>

      {canAsk ? (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="leadId" value={leadId} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="mode" value="followup" variant="outline" disabled={pending}>
              Prepare follow-up
            </Button>
            <Button type="submit" name="mode" value="summarize" variant="outline" disabled={pending}>
              Summarize lead
            </Button>
            <Button type="submit" name="mode" value="reply" variant="outline" disabled={pending}>
              Draft reply
            </Button>
            {followUpAsk ? (
              <Link
                href={`/intelligence?ask=${encodeURIComponent(followUpAsk)}`}
                className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--cy-navy)]"
              >
                Ask why
              </Link>
            ) : null}
          </div>
          <Textarea
            name="notes"
            rows={2}
            placeholder="Optional verified note to include in the draft"
          />
        </form>
      ) : null}

      {state && !state.ok ? (
        <p className="mt-3 text-sm text-rose-700" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok && state.text ? (
        <div className="mt-3 rounded-xl bg-[var(--cy-gray)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cy-text-muted)]">
            Draft — not sent
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--cy-navy)]">{state.text}</p>
          {draftHref ? (
            <Link href={draftHref} className="mt-3 inline-block text-sm font-medium text-[var(--cy-navy)] underline-offset-4 hover:underline">
              Open in Inbox
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
