"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setLeadNextActionAction } from "@/server/actions/leads";
import { formatDateTime } from "@/lib/datetime";

const NEXT_ACTION_PRESETS = [
  "Call customer",
  "Send estimate",
  "Schedule appointment",
  "Follow up tomorrow",
  "Waiting on customer",
];

export function NextActionPanel({
  leadId,
  nextAction,
  nextActionAt,
  assignedUserId,
  members,
  canManage,
}: {
  leadId: string;
  nextAction?: string | null;
  nextActionAt?: Date | null;
  assignedUserId?: string | null;
  members: { id: string; name: string }[];
  canManage: boolean;
}) {
  const defaultDue = nextActionAt
    ? new Date(nextActionAt.getTime() - nextActionAt.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">
        Next action
      </p>
      <p className="mt-1 text-lg font-semibold text-[var(--cy-navy)]">
        {nextAction || "No next action set"}
      </p>
      {nextActionAt ? (
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Due {formatDateTime(nextActionAt)}
        </p>
      ) : null}

      {canManage ? (
        <ActionForm action={setLeadNextActionAction} className="mt-4 space-y-3" successMessage="Next action saved.">
          <input type="hidden" name="leadId" value={leadId} />
          <div className="space-y-1.5">
            <Label htmlFor="nextAction">Action</Label>
            <Input
              id="nextAction"
              name="nextAction"
              defaultValue={nextAction ?? ""}
              placeholder="Call customer"
              list="lead-next-actions"
            />
            <datalist id="lead-next-actions">
              {NEXT_ACTION_PRESETS.map((preset) => (
                <option key={preset} value={preset} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nextActionAt">Due</Label>
              <Input id="nextActionAt" name="nextActionAt" type="datetime-local" defaultValue={defaultDue} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assignedUserId">Assigned</Label>
              <select
                id="assignedUserId"
                name="assignedUserId"
                defaultValue={assignedUserId ?? ""}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nextActionNote">Note</Label>
            <Textarea id="nextActionNote" name="note" rows={2} placeholder="Optional note for the timeline" />
          </div>
          <Button type="submit">Save next action</Button>
        </ActionForm>
      ) : null}
    </section>
  );
}
