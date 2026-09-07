"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  PutInWaitingForm,
  type WaitingColumnOption,
  type WaitingJobOption,
  type WaitingOwnerOption,
} from "@/components/waiting/put-in-waiting-form";

export function AddWaitingJobDrawer({
  open,
  onOpenChange,
  columns,
  owners,
  jobs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: WaitingColumnOption[];
  owners: WaitingOwnerOption[];
  jobs: WaitingJobOption[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="h-dvh w-full overflow-y-auto sm:max-w-lg data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="pr-8">
          <SheetTitle className="font-display text-xl text-[var(--cy-navy)]">Put Job in Waiting</SheetTitle>
          <SheetDescription>
            Tell ContractorYou what we&apos;re waiting on and how the customer should be updated.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-8">
          <PutInWaitingForm
            columns={columns}
            owners={owners}
            jobs={jobs}
            onSuccess={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
