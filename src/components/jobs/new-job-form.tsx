"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { industries } from "@/lib/brand";
import { createJobFormAction } from "@/server/actions/job-form";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type CustomerOption = {
  id: string;
  label: string;
};

type PropertyOption = {
  id: string;
  customerId: string;
  label: string;
};

type MemberOption = {
  id: string;
  label: string;
};

type PlaybookOption = {
  id: string;
  label: string;
};

export function NewJobForm({
  customers,
  properties,
  members,
  playbooks,
  defaultCustomerId,
  returnTo,
  canAssign = true,
  submitLabel = "Create job",
}: {
  customers: CustomerOption[];
  properties: PropertyOption[];
  members: MemberOption[];
  playbooks: PlaybookOption[];
  defaultCustomerId?: string;
  returnTo?: string;
  canAssign?: boolean;
  submitLabel?: string;
}) {
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");

  const filteredProperties = useMemo(
    () => properties.filter((p) => p.customerId === customerId),
    [properties, customerId]
  );

  return (
    <ActionForm action={createJobFormAction} className="space-y-4">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <div className="space-y-2">
        <Label htmlFor="customerId">Customer</Label>
        <select
          id="customerId"
          name="customerId"
          required
          className={selectClassName}
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">Select customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="propertyId">Property</Label>
        <select
          id="propertyId"
          name="propertyId"
          required
          className={selectClassName}
          disabled={!customerId}
          defaultValue=""
          key={customerId}
        >
          <option value="">
            {customerId ? "Select property…" : "Select a customer first"}
          </option>
          {filteredProperties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="playbookId">Job type / playbook</Label>
          {playbooks.length > 0 ? (
            <select id="playbookId" name="playbookId" className={selectClassName} defaultValue="">
              <option value="">No playbook — keep it simple</option>
              {playbooks.map((playbook) => (
                <option key={playbook.id} value={playbook.id}>
                  {playbook.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              No playbooks yet. Jobs still work without one.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="jobType">Short label</Label>
          <Input id="jobType" name="jobType" placeholder="Optional, if you are not using a playbook" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trade">Trade</Label>
          <select id="trade" name="trade" className={selectClassName} defaultValue="">
            <option value="">Company default</option>
            {industries.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            name="priority"
            defaultValue="NORMAL"
            className={selectClassName}
          >
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="source">Source</Label>
          <Input id="source" name="source" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={3} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="customerNotes">Customer notes</Label>
          <Textarea id="customerNotes" name="customerNotes" rows={2} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="internalNotes">Internal notes</Label>
          <Textarea id="internalNotes" name="internalNotes" rows={2} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="scheduledStart">Scheduled start</Label>
          <Input id="scheduledStart" name="scheduledStart" type="datetime-local" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scheduledEnd">Scheduled end</Label>
          <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" />
        </div>
      </div>

      {canAssign && members.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Assignees</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="assigneeIds" value={m.id} className="rounded border" />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex justify-end pt-2">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </ActionForm>
  );
}
