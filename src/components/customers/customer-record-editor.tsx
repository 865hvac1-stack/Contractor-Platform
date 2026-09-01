"use client";

import { useActionState } from "react";
import { createPropertyAction, updateCustomerProfileAction } from "@/server/actions/customers";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/server/actions/auth";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CustomerRecordEditor({
  customerId,
  firstName,
  lastName,
  phone,
  email,
  preferredContactMethod,
}: {
  customerId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  preferredContactMethod: string;
}) {
  const [state, action, pending] = useActionState(updateCustomerProfileAction, null as ActionResult | null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">Edit customer</h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Company-entered contact details. This does not overwrite property provider facts.
        </p>
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="customerId" value={customerId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" defaultValue={firstName} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" name="lastName" defaultValue={lastName} required />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={phone ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={email ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="preferredContactMethod">Preferred contact</Label>
            <select
              id="preferredContactMethod"
              name="preferredContactMethod"
              defaultValue={preferredContactMethod}
              className={selectClassName}
            >
              <option value="ANY">Any</option>
              <option value="PHONE">Phone</option>
              <option value="TEXT">Text</option>
              <option value="EMAIL">Email</option>
            </select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save contact"}
          </Button>
          {state && !state.ok ? <p className="text-sm text-rose-700">{state.error}</p> : null}
          {state?.ok ? <p className="text-sm text-emerald-800">Contact saved.</p> : null}
        </form>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">Add property</h2>
        <ActionForm action={createPropertyAction} className="mt-4 space-y-3">
          <input type="hidden" name="customerId" value={customerId} />
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Primary home, rental, shop" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="address">Street address</Label>
            <Input id="address" name="address" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="zip">ZIP</Label>
              <Input id="zip" name="zip" required />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="propertyType">Property type</Label>
            <select id="propertyType" name="propertyType" defaultValue="RESIDENTIAL" className={selectClassName}>
              <option value="RESIDENTIAL">Residential</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="MULTI_FAMILY">Multi-family</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="accessNotes">Access notes</Label>
            <Textarea id="accessNotes" name="accessNotes" rows={2} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPrimary" value="true" className="rounded border" />
            Primary property
          </label>
          <Button type="submit">Add property</Button>
        </ActionForm>
      </section>
    </div>
  );
}
