import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { getBillingWatchdogSettings } from "@/lib/billing-watchdog/settings";
import { saveBillingWatchdogSettingsAction } from "@/server/actions/billing-watchdog";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function BillingWatchdogSettingsPage() {
  const ctx = await requirePermission("company:settings");
  const settings = await getBillingWatchdogSettings(prisma, ctx.company.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Billing Watchdog</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Grace periods and morning summary. Watchdog never invents amounts or job status.
        </p>
      </div>

      <ActionForm action={saveBillingWatchdogSettingsAction} className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-5">
        <div>
          <Label htmlFor="startDate">Watchdog start date</Label>
          <Input id="startDate" name="startDate" type="date" defaultValue={settings.startDate.toISOString().slice(0, 10)} />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Imported historical records stay out. Only live work after this date is scanned.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="checkoutGraceMinutes">Checkout grace (minutes)</Label>
            <Input id="checkoutGraceMinutes" name="checkoutGraceMinutes" type="number" min={0} defaultValue={settings.checkoutGraceMinutes} />
          </div>
          <div>
            <Label htmlFor="completedInvoiceGraceHours">Completed job invoice grace (hours)</Label>
            <Input id="completedInvoiceGraceHours" name="completedInvoiceGraceHours" type="number" min={0} defaultValue={settings.completedInvoiceGraceHours} />
          </div>
          <div>
            <Label htmlFor="invoiceSendGraceHours">Invoice send grace (hours)</Label>
            <Input id="invoiceSendGraceHours" name="invoiceSendGraceHours" type="number" min={0} defaultValue={settings.invoiceSendGraceHours} />
          </div>
          <div>
            <Label htmlFor="accountingSyncGraceHours">QuickBooks sync grace (hours)</Label>
            <Input id="accountingSyncGraceHours" name="accountingSyncGraceHours" type="number" min={0} defaultValue={settings.accountingSyncGraceHours} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="morningSummaryEnabled" defaultChecked={settings.morningSummaryEnabled} />
          Morning Billing Watchdog summary (in-app)
        </label>
        <p className="text-xs text-[var(--muted-foreground)]">
          External email/SMS morning alerts stay off until you enable a later notification channel. Recipients default to owner, admin, manager, and office.
        </p>
        <Button type="submit">Save settings</Button>
      </ActionForm>
    </div>
  );
}
