"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { askContractorYouAction, type AskState } from "@/server/actions/intelligence";
import { Button } from "@/components/ui/button";
import { ActionCard, KindBadge } from "@/components/action-card";

export function AskContractorYou({
  suggestions,
  jobId,
  compact = false,
  initialQuestion = "",
  autoSubmit = false,
}: {
  suggestions: string[];
  jobId?: string;
  compact?: boolean;
  initialQuestion?: string;
  autoSubmit?: boolean;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [conversationId, setConversationId] = useState("");
  const [state, formAction, pending] = useActionState(askContractorYouAction, null as AskState | null);
  const formRef = useRef<HTMLFormElement>(null);
  const autoRef = useRef(false);

  useEffect(() => {
    if (state?.ok && state.conversationId) setConversationId(state.conversationId);
  }, [state]);

  useEffect(() => {
    if (!autoSubmit || !initialQuestion || autoRef.current) return;
    autoRef.current = true;
    flushSync(() => setQuestion(initialQuestion));
    formRef.current?.requestSubmit();
  }, [autoSubmit, initialQuestion]);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--cy-navy)] p-5 text-white md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Ask ContractorYou
          </p>
          <p className="mt-1 text-sm text-white/65">
            It reads your records, prepares the work, and waits for you before anything goes out.
          </p>
        </div>
        {state?.ok && state.kind ? <KindBadge kind={state.kind} /> : null}
      </div>

      <form ref={formRef} action={formAction} className="mt-4 space-y-3">
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
          placeholder={jobId ? "Ask about this job..." : "Take care of my estimate follow-ups."}
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

      {state?.ok && state.actionRequest ? (
        <div className="mt-4">
          <ActionCard request={state.actionRequest} />
        </div>
      ) : null}

      {!compact ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {suggestions.slice(0, 8).map((item) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => {
                  flushSync(() => setQuestion(item));
                  formRef.current?.requestSubmit();
                }}
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
