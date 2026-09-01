"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { askContractorYouAction, type AskState } from "@/server/actions/intelligence";
import { ActionCard } from "@/components/action-card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function DispatchAskBar({ suggestions }: { suggestions: string[] }) {
  const [open, setOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [state, formAction, pending] = useActionState(askContractorYouAction, null as AskState | null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && state.conversationId) setConversationId(state.conversationId);
    if (state) setOpen(true);
  }, [state]);

  const form = (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
      <p className="hidden shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)] md:block">
        Ask ContractorYou
      </p>
      <input
        name="question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Who's running late?"
        className="h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/8 px-3 text-sm text-white placeholder:text-white/40 md:h-10"
        aria-label="Ask ContractorYou about dispatch"
      />
      <Button type="submit" disabled={pending} className="h-11 md:h-10">
        {pending ? "Checking…" : "Ask"}
      </Button>
    </form>
  );

  return (
    <>
      <button
        type="button"
        className="fixed right-4 bottom-4 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--cy-navy)] px-4 text-sm font-semibold text-white shadow-lg md:hidden"
        onClick={() => setComposerOpen(true)}
        aria-label="Ask ContractorYou"
      >
        <Sparkles className="size-4 text-[var(--cy-orange)]" />
        Ask
      </button>

      {composerOpen ? (
        <Sheet open onOpenChange={setComposerOpen}>
          <SheetContent side="bottom" className="max-h-[90vh] w-full rounded-t-2xl bg-[var(--cy-navy)] text-white sm:max-w-none">
            <SheetHeader>
              <SheetTitle className="text-white">Ask ContractorYou</SheetTitle>
              <SheetDescription className="text-white/70">Reads the live board. Nothing is assigned until you approve.</SheetDescription>
            </SheetHeader>
            <div className="space-y-3 px-4 pb-6">
              {form}
              <div className="flex flex-wrap gap-2">
                {suggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="min-h-11 rounded-full bg-white/8 px-3 py-2 text-left text-xs text-white/80"
                    onClick={() => {
                      setQuestion(item);
                      setTimeout(() => formRef.current?.requestSubmit(), 0);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      <div className="sticky bottom-0 z-20 hidden rounded-2xl border border-[var(--border)] bg-[var(--cy-navy)] px-3 py-2 text-white md:block">
        {form}
        <div className="mt-2 hidden gap-2 overflow-x-auto md:flex">
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              className="shrink-0 rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/12"
              onClick={() => {
                setQuestion(item);
                setTimeout(() => formRef.current?.requestSubmit(), 0);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {open ? (
        <Sheet open onOpenChange={setOpen}>
          <SheetContent side="right" className="w-full sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>ContractorYou</SheetTitle>
              <SheetDescription>Reads the live board. Recommendations wait for your approval.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-4">
              {state && !state.ok ? (
                <p className="text-sm text-rose-700" role="alert">
                  {state.error}
                </p>
              ) : null}
              {state?.ok ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--cy-navy)]">{state.answer}</p>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">Ask a dispatch question to see a recommendation here.</p>
              )}
              {state?.ok && state.actionRequest ? <ActionCard request={state.actionRequest} compact /> : null}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
