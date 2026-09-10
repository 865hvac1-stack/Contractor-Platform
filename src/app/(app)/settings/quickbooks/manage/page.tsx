import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getCompanyConnection } from "@/lib/integrations/store";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { getQuickBooksSettings } from "@/lib/quickbooks/connection";
import { loadQuickBooksSyncCenter } from "@/lib/quickbooks/center";
import { formatDateTime } from "@/lib/datetime";
import {
  createQuickBooksCustomerAction,
  linkQuickBooksCustomerAction,
  syncNowQuickBooksAction,
  unlinkQuickBooksCustomerAction,
} from "@/server/actions/quickbooks";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default async function QuickBooksManagePage() {
  const ctx = await requirePermission("accounting:view");
  const canManage = can(ctx.role, "accounting:manage");
  const [connection, settings, center] = await Promise.all([
    getCompanyConnection(ctx.company.id, QUICKBOOKS_PROVIDER_KEY),
    getQuickBooksSettings(ctx.company.id),
    loadQuickBooksSyncCenter(prisma, ctx.company.id),
  ]);
  const preview = center.preview;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/settings/quickbooks" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← QuickBooks
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">QuickBooks Sync Center</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {settings.qboCompanyName || "QuickBooks"} ·{" "}
          {settings.syncActivated ? "Automatic sync is on" : "Safe mode — preview first"}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CountCard title="Customers" lines={[`${preview.customersLinked} linked`, `${preview.customersNeedReview} need review`]} />
        <CountCard title="Invoices" lines={[`${preview.invoicesSynced} synced`, `${preview.invoicesPending} pending`, `${preview.invoicesErrors} errors`]} />
        <CountCard title="Payments" lines={[`${preview.paymentsSynced} synced`, `${preview.paymentsPending} pending`, `${preview.paymentsErrors} errors`]} />
        <CountCard title="Expenses" lines={[`${preview.expensesSynced} synced`, `${preview.expensesPending} pending`, `${preview.expensesErrors} errors`]} />
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Connection</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Last sync {connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt, ctx.company.timezone) : "never"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <ActionForm action={syncNowQuickBooksAction}>
                <Button type="submit" size="sm">
                  Sync now
                </Button>
              </ActionForm>
            ) : null}
            <Link href="#review" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Review issues
            </Link>
            <Link href="/settings/quickbooks/setup" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Setup wizard
            </Link>
          </div>
        </div>
      </section>

      <section id="review" className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Needs review</h2>
        {center.review.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Nothing waiting on you.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {center.review.map((row) => (
              <li key={row.id} className="py-3">
                <p className="font-medium">
                  {row.entityType} · {row.status.replaceAll("_", " ")}
                </p>
                <p className="text-[var(--muted-foreground)]">{row.error}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Customer matching</h2>
        {center.customers.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No customers waiting to be linked.</p>
        ) : (
          <ul className="space-y-4">
            {center.customers.map(({ mapping, customer }) => (
              <li key={mapping.id} className="rounded-xl border border-[var(--border)] p-3">
                <p className="font-medium">
                  {customer
                    ? `${customer.businessName || `${customer.firstName} ${customer.lastName}`}`
                    : "Customer"}
                </p>
                <p className="text-sm text-[var(--muted-foreground)]">{mapping.lastSyncError}</p>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionForm action={linkQuickBooksCustomerAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="customerId" value={mapping.internalId} />
                      <Input name="quickbooksId" placeholder="QuickBooks customer ID" className="w-48" required />
                      <Button type="submit" size="sm" variant="outline">
                        Link existing
                      </Button>
                    </ActionForm>
                    <ActionForm action={createQuickBooksCustomerAction}>
                      <input type="hidden" name="customerId" value={mapping.internalId} />
                      <Button type="submit" size="sm">
                        Create in QuickBooks
                      </Button>
                    </ActionForm>
                    <ActionForm action={unlinkQuickBooksCustomerAction}>
                      <input type="hidden" name="customerId" value={mapping.internalId} />
                      <Button type="submit" size="sm" variant="ghost">
                        Unlink
                      </Button>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Recent sync activity</h2>
        {center.recent.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">No QuickBooks syncs yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)] text-sm">
            {center.recent.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {event.entityType} · {event.action}
                  </p>
                  <p className="text-[var(--muted-foreground)]">
                    {event.errorMessage || (event.quickbooksId ? `QuickBooks ${event.quickbooksId}` : "Recorded")}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={event.status} />
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {formatDateTime(event.createdAt, ctx.company.timezone)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CountCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4">
      <p className="text-xs text-[var(--muted-foreground)]">{title}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
