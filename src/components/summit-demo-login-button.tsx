"use client";

import { useActionState } from "react";
import { enterSummitDemoAction } from "@/server/actions/demo";
import { Button } from "@/components/ui/button";

export function SummitDemoLoginButton() {
  const [state, action, pending] = useActionState(enterSummitDemoAction, null);

  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="outline" className="h-10 w-full" disabled={pending}>
        {pending ? "Opening Summit…" : "Enter Summit demo"}
      </Button>
      {state && !state.ok ? (
        <p className="text-sm text-rose-700" role="alert">
          {state.error}
        </p>
      ) : null}
      {pending ? (
        <p className="text-center text-xs text-[var(--muted-foreground)]">
          First visit may take a minute while the fictional company is prepared.
        </p>
      ) : null}
    </form>
  );
}
