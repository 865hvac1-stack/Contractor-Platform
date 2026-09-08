"use client";

import { useActionState } from "react";
import { createPropertyAction, updateCustomerProfileAction } from "@/server/actions/customers";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/server/actions/auth";
import { formatUsPhoneDisplay } from "@/lib/phone";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CustomerRecordEditor({
  customerId,
  firstName,
  lastName,
  businessName,
  phone,
  secondaryPhone,
  email,
  notes,
  preferredContactMethod,
  propertyId,
  address,
  city,
  propertyState,
  zip,
  mode = "full",
}: {
  customerId: string;
  firstName: string;
  lastName: string;
  businessName?: string | null;
  phone: string | null;
  secondaryPhone?: string | null;
  email: string | null;
  notes?: string | null;
  preferredContactMethod: string;
  propertyId?: string | null;
  address?: string | null;
  city?: string | null;
  propertyState?: string | null;
  zip?: string | null;
  mode?: "full" | "profile" | "property";
}) {
  const [state, action, pending] = useActionState(updateCustomerProfileAction, null as ActionResult | null);

  const profile = (
      <section className={mode === "full" ? "rounded-2xl border border-[var(--border)] bg-white p-5" : undefined}>
        <h2 className="font-semibold text-[var(--cy-navy)]">Edit customer</h2>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Updates this customer only. Jobs, invoices, properties, and communications stay attached.
        </p>
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="customerId" value={customerId} />
          {propertyId ? <input type="hidden" name="propertyId" value={propertyId} /> : null}
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
            <Label htmlFor="businessName">Company / business name</Label>
            <Input id="businessName" name="businessName" defaultValue={businessName ?? ""} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="phone">Primary phone</Label>
              <Input id="phone" name="phone" defaultValue={formatUsPhoneDisplay(phone) ?? phone ?? ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="secondaryPhone">Alternate phone</Label>
              <Input
                id="secondaryPhone"
                name="secondaryPhone"
                defaultValue={formatUsPhoneDisplay(secondaryPhone) ?? secondaryPhone ?? ""}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={email ?? ""} />
          </div>
          {propertyId ? (
            <div className="space-y-3 rounded-xl bg-[var(--cy-gray)] p-3">
              <p className="text-xs font-medium text-[var(--cy-navy)]">Billing / service address</p>
              <div className="space-y-1">
                <Label htmlFor="address">Street</Label>
                <Input id="address" name="address" defaultValue={address ?? ""} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" name="city" defaultValue={city ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" name="state" defaultValue={propertyState ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="zip">ZIP</Label>
                  <Input id="zip" name="zip" defaultValue={zip ?? ""} />
                </div>
              </div>
            </div>
          ) : null}
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
          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} defaultValue={notes ?? ""} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save customer"}
          </Button>
          {state && !state.ok ? <p className="text-sm text-rose-700">{state.error}</p> : null}
          {state?.ok ? <p className="text-sm text-emerald-800">Customer saved.</p> : null}
        </form>
      </section>
  );

  const property = (
      <section className={mode === "full" ? "rounded-2xl border border-[var(--border)] bg-white p-5" : undefined}>
        <h2 className="font-semibold text-[var(--cy-navy)]">Add property</h2>
        <ActionForm action={createPropertyAction} className="mt-4 space-y-3">
          <input type="hidden" name="customerId" value={customerId} />
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Primary home, rental, shop" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-address">Street address</Label>
            <Input id="new-address" name="address" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="new-city">City</Label>
              <Input id="new-city" name="city" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-state">State</Label>
              <Input id="new-state" name="state" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-zip">ZIP</Label>
              <Input id="new-zip" name="zip" required />
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
  );

  return (
    <div
      id={mode === "property" ? "add-property" : "edit-customer"}
      className={mode === "full" ? "grid gap-6 scroll-mt-24 lg:grid-cols-2" : undefined}
    >
      {mode === "property" ? property : profile}
      {mode === "full" ? property : null}
    </div>
  );
}
