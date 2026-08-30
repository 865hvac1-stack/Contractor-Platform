"use client";

import { useActionState, useEffect, useState } from "react";
import { askContractorYouAction, type AskState } from "@/server/actions/intelligence";
import { Button } from "@/components/ui/button";

export function AskContractorYou({
  suggestions,
  jobId,
  compact = false,
}: {
  suggestions: string[];
  jobId?: string;
  compact?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [state, formAction, pending] = useActionState(askContractorYouAction, null as AskState | null);

  useEffect(() => {
    if (state?.ok && state.conversationId) setConversationId(state.conversationId);
  }, [state]);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--cy-navy)] p-5 text-white md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Ask ContractorYou
          </p>
          <p className="mt-1 text-sm text-white/65">
            Answers come from this company&apos;s records. Numbers are calculated before any wording.
          </p>
        </div>
      </div>

      <form action={formAction} className="mt-4 space-y-3">
        {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
        {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}
        <label htmlFor={jobId ? `ask-cy-${jobId}` : "ask-cy"} className="sr-only">
          Ask ContractorYou
        </label>
        <input
          id={jobId ? `ask-cy-${jobId}` : "ask-cy"}
          name="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={jobId ? "Ask about this job..." : "What should I do today?"}
          className="h-12 w-full rounded-xl border border-white/10 bg-white/8 px-4 text-sm text-white placeholder:text-white/35"
        />
        <Button type="submit" disabled={pending} className="h-11 w-full sm:w-auto">
          {pending ? "Looking at your records…" : "Ask"}
        </Button>
      </form>

      {state && !state.ok ? (
        <p className="mt-3 text-sm text-rose-200" role="alert">
          {state.error}
        </p>
      ) : null}

      {state?.ok && state.answer ? (
        <div className="mt-4 rounded-xl bg-white/8 p-4">
          <p className="whitespace-pre-wrap text-sm leading-6 text-white">{state.answer}</p>
          {state.grounding?.sources?.length ? (
            <p className="mt-3 text-xs text-white/45">
              Data used: {state.grounding.sources.join(", ")}
              {state.grounding.lastUpdated
                ? ` · Updated ${new Date(state.grounding.lastUpdated).toLocaleString()}`
                : ""}
              {state.providerConfigured ? "" : " · From ContractorYou records (language model off)"}
            </p>
          ) : null}
        </div>
      ) : null}

      {!compact ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {suggestions.slice(0, 6).map((item) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => setQuestion(item)}
                className="w-full rounded-lg bg-white/6 px-3 py-2 text-left text-xs text-white/70 hover:bg-white/10"
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
