"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { markPartArrivedAction } from "@/server/actions/waiting";

const CHECKLIST = [
  "Mark part as arrived",
  'Stop all future "waiting on part" updates',
  "Move job to Ready to Schedule",
  "Create scheduling action",
  "Notify assigned office user",
  "Add event to Job 360 timeline",
  "Add event to Customer 360 timeline",
];

export function PartArrivedDialog({
  open,
  onOpenChange,
  recordId,
  customerName,
  itemName,
  communicationEnabled = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId: string;
  customerName: string;
  itemName: string;
  communicationEnabled?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>PART ARRIVED</DialogTitle>
          <DialogDescription>
            {itemName}
            <br />
            {customerName}
          </DialogDescription>
        </DialogHeader>
        <ActionForm
          action={markPartArrivedAction}
          onSuccess={() => onOpenChange(false)}
          className="space-y-3"
        >
          <input type="hidden" name="recordId" value={recordId} />
          <p className="text-sm font-medium text-[var(--cy-navy)]">ContractorYou is about to:</p>
          <ul className="space-y-1.5 text-sm">
            {CHECKLIST.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-emerald-700">
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
            {communicationEnabled ? (
              <li className="flex gap-2">
                <span aria-hidden className="text-emerald-700">
                  ✓
                </span>
                <span>Send customer &quot;part arrived&quot; update</span>
              </li>
            ) : null}
          </ul>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--cy-gray)]/40 px-3 py-2 text-sm">
            <span>Notify the customer that the part arrived</span>
            <select
              name="notifyCustomer"
              defaultValue={communicationEnabled ? "yes" : "no"}
              className="h-8 rounded-md border border-[var(--border)] bg-white px-2 text-xs"
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <Button type="submit" className="h-11 w-full bg-[var(--cy-orange)] text-white hover:bg-[var(--cy-orange)]/90">
            Part Arrived — Move to Ready to Schedule
          </Button>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
