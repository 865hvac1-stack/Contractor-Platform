"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/actions/auth";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export function ActionForm({
  action,
  children,
  className,
  successMessage,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className={className}>
      {children}
      {state && !state.ok ? (
        <div className="mt-3 space-y-2" role="alert">
          <p className="text-sm text-rose-700">{state.error}</p>
          {state.setupUrl ? (
            <p className="break-all text-sm text-[var(--muted-foreground)]">
              Email was not sent. Share this setup link directly:{" "}
              <a href={state.setupUrl} className="font-medium text-[var(--cy-navy)] underline">
                Set up account
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      {state && state.ok && (state.message || successMessage) ? (
        <p className="mt-3 text-sm text-emerald-700">{state.message || successMessage}</p>
      ) : null}
      {pending ? <p className="sr-only">Saving…</p> : null}
    </form>
  );
}
