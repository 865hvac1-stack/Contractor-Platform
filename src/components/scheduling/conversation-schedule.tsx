"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { bookFromConversationAction, pauseConversationBookingAction } from "@/server/actions/scheduling";
import { formatClockMinutes, formatLocalDateShort } from "@/lib/scheduling/time";

export type ScheduleOption = {
  date: string;
  windowId: string;
  windowName: string;
  startMinutes: number;
  endMinutes: number;
  technicianId: string;
  technicianName: string;
  remainingCapacity: number;
  configuredCapacity: number;
  usedCapacity: number;
};

export function ConversationScheduleSheet({
  customerId,
  customerName,
  propertyId,
  propertyLabel,
  serviceTypeId,
  serviceTypeName,
  threadId,
  paused,
  requestedLabel,
  options,
  timeZone,
  canBook,
}: {
  customerId: string;
  customerName: string;
  propertyId?: string | null;
  propertyLabel?: string | null;
  serviceTypeId?: string | null;
  serviceTypeName?: string | null;
  threadId: string;
  paused: boolean;
  requestedLabel?: string | null;
  options: ScheduleOption[];
  timeZone: string;
  canBook: boolean;
}) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleOption[]>();
    for (const option of options) {
      const list = map.get(option.date) ?? [];
      list.push(option);
      map.set(option.date, list);
    }
    return [...map.entries()];
  }, [options]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button className="h-11 w-full md:h-8 md:w-auto" onClick={() => setOpen(true)}>
        Schedule
      </Button>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto pb-24 md:pb-6">
        <SheetHeader>
          <SheetTitle>Schedule</SheetTitle>
          <SheetDescription>
            {customerName}
            {propertyLabel ? ` · ${propertyLabel}` : ""}
            {serviceTypeName ? ` · ${serviceTypeName}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {requestedLabel ? (
            <p className="rounded-xl bg-[var(--cy-gray)] px-3 py-2 text-sm">Requested: {requestedLabel}</p>
          ) : null}
          <ActionForm action={pauseConversationBookingAction}>
            <input type="hidden" name="threadId" value={threadId} />
            <input type="hidden" name="paused" value={paused ? "no" : "yes"} />
            <Button type="submit" variant="outline" className="h-11 w-full md:h-8">
              {paused ? "Resume auto booking" : "Pause auto booking"}
            </Button>
          </ActionForm>
          {options.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No remaining capacity in the next few days. Check technician availability or add an override.
            </p>
          ) : (
            grouped.map(([date, rows]) => (
              <section key={date} className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--cy-navy)]">{formatLocalDateShort(date, timeZone)}</h3>
                {rows.map((row) => (
                  <div key={`${row.date}-${row.windowId}-${row.technicianId}`} className="rounded-xl border border-[var(--border)] p-3">
                    <p className="font-medium">
                      {formatClockMinutes(row.startMinutes)}–{formatClockMinutes(row.endMinutes)}
                    </p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {row.technicianName} · {row.remainingCapacity} slot{row.remainingCapacity === 1 ? "" : "s"} remaining
                    </p>
                    {canBook ? (
                      <ActionForm action={bookFromConversationAction} className="mt-2" successMessage="Booked.">
                        <input type="hidden" name="customerId" value={customerId} />
                        <input type="hidden" name="propertyId" value={propertyId ?? ""} />
                        <input type="hidden" name="serviceTypeId" value={serviceTypeId ?? ""} />
                        <input type="hidden" name="threadId" value={threadId} />
                        <input type="hidden" name="date" value={row.date} />
                        <input type="hidden" name="windowId" value={row.windowId} />
                        <input type="hidden" name="technicianId" value={row.technicianId} />
                        <input type="hidden" name="sendConfirmation" value="yes" />
                        <Button type="submit" className="h-11 w-full md:h-8">
                          Book
                        </Button>
                      </ActionForm>
                    ) : null}
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
