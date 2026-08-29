"use client";

import { useActionState } from "react";
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
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      {state && !state.ok ? (
        <p className="mt-3 text-sm text-rose-700" role="alert">
          {state.error}
        </p>
      ) : null}
      {state && state.ok && successMessage ? (
        <p className="mt-3 text-sm text-emerald-700">{successMessage}</p>
      ) : null}
      {pending ? <p className="sr-only">Saving…</p> : null}
    </form>
  );
}
