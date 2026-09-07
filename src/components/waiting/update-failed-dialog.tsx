"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sanitizeWaitingFailureReason } from "@/lib/waiting/safety";

export function UpdateFailedDialog({
  open,
  onOpenChange,
  customerName,
  attemptedAt,
  provider,
  reason,
  timezone,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  attemptedAt: Date | string | null;
  provider: string | null;
  reason: string | null;
  timezone: string;
  onRetry: () => void;
}) {
  const when = attemptedAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(attemptedAt instanceof Date ? attemptedAt : new Date(attemptedAt))
    : "Unknown time";
  const providerLabel =
    !provider || provider === "none"
      ? "No communications provider connected"
      : provider === "highlevel"
        ? "HighLevel"
        : provider === "demo"
          ? "Demo outbound blocked"
          : provider;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>UPDATE FAILED</DialogTitle>
          <DialogDescription>{customerName}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[var(--muted-foreground)]">Attempted</dt>
            <dd>{when}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Provider</dt>
            <dd>{providerLabel}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Failure</dt>
            <dd className="text-rose-800">{sanitizeWaitingFailureReason(reason)}</dd>
          </div>
        </dl>
        <p className="text-xs text-[var(--muted-foreground)]">
          ContractorYou did not mark this customer as contacted.
        </p>
        <Button
          type="button"
          className="h-11 w-full"
          onClick={() => {
            onOpenChange(false);
            onRetry();
          }}
        >
          Retry / Send update now
        </Button>
      </DialogContent>
    </Dialog>
  );
}
