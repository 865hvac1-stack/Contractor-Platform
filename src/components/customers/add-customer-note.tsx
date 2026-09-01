"use client";

import { useActionState } from "react";
import { addCustomerNoteAction } from "@/server/actions/customers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/server/actions/auth";

export function AddCustomerNoteForm({
  customerId,
  propertyId,
}: {
  customerId: string;
  propertyId?: string;
}) {
  const [state, action, pending] = useActionState(addCustomerNoteAction, null as ActionResult | null);
  return (
    <form action={action} className="mt-4 space-y-2">
      <input type="hidden" name="customerId" value={customerId} />
      {propertyId ? <input type="hidden" name="propertyId" value={propertyId} /> : null}
      <Textarea name="body" rows={2} placeholder="Add a note…" required />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Add note"}
      </Button>
      {state && !state.ok ? <p className="text-sm text-rose-700">{state.error}</p> : null}
    </form>
  );
}
