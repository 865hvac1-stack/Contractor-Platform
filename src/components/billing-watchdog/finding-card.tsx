import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { TYPE_LABELS, EXCLUSION_LABELS } from "@/lib/billing-watchdog/labels";
import { BILLING_WATCHDOG_EXCLUSION_CODES } from "@/lib/billing-watchdog/types";
import type { BillingWatchdogFindingView } from "@/lib/billing-watchdog/types";
import { excludeBillingWatchdogFindingAction } from "@/server/actions/billing-watchdog";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SEVERITY_CLASS = {
  CRITICAL: "bg-red-50 text-red-800",
  ACTION_NEEDED: "bg-amber-50 text-amber-900",
  WATCH: "bg-slate-100 text-slate-700",
};

export function WatchdogFindingCard({
  finding,
  canExclude,
}: {
  finding: BillingWatchdogFindingView;
  canExclude: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-[var(--cy-navy)]">{finding.title}</p>
          <p className="text-sm text-[var(--muted-foreground)]">{finding.subtitle}</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", SEVERITY_CLASS[finding.severity])}>
          {finding.severity.replaceAll("_", " ")}
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--cy-orange)]">
        {TYPE_LABELS[finding.type] || finding.type}
      </p>
      <p className="mt-1 text-sm">{finding.reason}</p>
      <p className="mt-3 text-sm">
        <span className="text-[var(--muted-foreground)]">Revenue at risk: </span>
        {finding.amountUnknown || finding.amountAtRiskCents == null
          ? "Amount unknown"
          : formatMoney(finding.amountAtRiskCents)}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {finding.actions.map((action) => (
          <Link key={action.href + action.label} href={action.href} className={cn(buttonVariants({ size: "sm" }))}>
            {action.label}
          </Link>
        ))}
      </div>
      {canExclude && finding.status === "OPEN" ? (
        <ActionForm action={excludeBillingWatchdogFindingAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input type="hidden" name="findingId" value={finding.id} />
          <select name="exclusionCode" className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm" required>
            {BILLING_WATCHDOG_EXCLUSION_CODES.map((code) => (
              <option key={code} value={code}>
                {EXCLUSION_LABELS[code]}
              </option>
            ))}
          </select>
          <input
            name="reason"
            required
            placeholder="Why this is a legitimate exception"
            className="h-10 rounded-md border border-[var(--border)] px-3 text-sm"
          />
          <Button type="submit" size="sm" variant="outline">
            Ignore / exclude
          </Button>
        </ActionForm>
      ) : null}
      {finding.status === "EXCLUDED" && finding.exclusionReason ? (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          Excluded: {finding.exclusionReason}
        </p>
      ) : null}
    </article>
  );
}
