"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { askContractorYouAction, type AskState } from "@/server/actions/intelligence";
import { ActionCard } from "@/components/action-card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function DispatchAskBar({
  suggestions,
  jobId,
  customerId,
}: {
  suggestions: string[];
  jobId?: string | null;
  customerId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [state, formAction, pending] = useActionState(askContractorYouAction, null as AskState | null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && state.conversationId) setConversationId(state.conversationId);
  }, [state]);

  return (
    <>
      <button
        type="button"
        className="fixed right-4 bottom-4 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--cy-navy)] px-4 text-sm font-semibold text-white shadow-lg"
        onClick={() => setOpen(true)}
        aria-label="Ask ContractorYou"
      >
        <Sparkles className="size-4 text-[var(--cy-orange)]" />
        Ask ContractorYou
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Ask ContractorYou</SheetTitle>
            <SheetDescription>
              {jobId ? "Uses the selected job as context. Nothing is assigned until you approve." : "Reads the live board. Recommendations wait for your approval."}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <form ref={formRef} action={formAction} className="space-y-3">
              {conversationId ? <input type="hidden" name="conversationId" value={conversationId} /> : null}
              {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}
              {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}
              <textarea
                name="question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={jobId ? "Who should take this call?" : "Who's running late?"}
                className="min-h-24 w-full rounded-xl border px-3 py-2 text-sm"
                aria-label="Ask ContractorYou about dispatch"
              />
              <Button type="submit" disabled={pending} className="h-11 w-full">
                {pending ? "Checking…" : "Ask"}
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-full border px-3 py-1.5 text-left text-xs"
                  onClick={() => {
                    setQuestion(item);
                    setTimeout(() => formRef.current?.requestSubmit(), 0);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            {state && !state.ok ? <p className="text-sm text-rose-700" role="alert">{state.error}</p> : null}
            {state?.ok ? <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--cy-navy)]">{state.answer}</p> : null}
            {state?.ok && state.actionRequest ? <ActionCard request={state.actionRequest} compact /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
