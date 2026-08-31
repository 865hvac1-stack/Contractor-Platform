import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getCompanyConnection } from "@/lib/integrations/store";
import { QUICKBOOKS_PROVIDER_KEY, quickbooksConfigured } from "@/lib/quickbooks/config";
import { getQuickBooksSettings } from "@/lib/quickbooks/connection";
import { INVOICE_TRIGGER_COPY, QUICKBOOKS_STATUS_COPY, publicQuickBooksStatus } from "@/lib/quickbooks/status";
import { disconnectQuickBooksAction, saveQuickBooksSettingsAction } from "@/server/actions/quickbooks";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function QuickBooksSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const ctx = await requirePermission("accounting:view");
  const { error, connected } = await searchParams;
  const [connection, settings, history] = await Promise.all([
    getCompanyConnection(ctx.company.id, QUICKBOOKS_PROVIDER_KEY),
    getQuickBooksSettings(ctx.company.id),
    prisma.quickBooksSyncEvent.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);
  const status = publicQuickBooksStatus(connection);
  const configured = quickbooksConfigured();
  const canManage = can(ctx.role, "accounting:manage");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">QuickBooks</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ContractorYou runs the job. QuickBooks keeps the books. Connect only if you want invoices and recorded
          payments copied over.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error === "missing_credentials"
            ? "QuickBooks credentials are not on this server yet. Add them in Railway, then try again."
            : decodeURIComponent(error)}
        </p>
      ) : null}
      {connected ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">QuickBooks is connected.</p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Connection</p>
            <h2 className="mt-2 font-medium">QuickBooks Online</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {connection?.accountLabel
                ? `Company ${connection.accountLabel}`
                : "No QuickBooks company is linked."}
            </p>
          </div>
          <StatusBadge status={QUICKBOOKS_STATUS_COPY[status] ?? status} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted-foreground)]">Last successful sync</dt>
            <dd className="mt-0.5">{connection?.lastSyncAt ? connection.lastSyncAt.toLocaleString() : "Never"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Last error</dt>
            <dd className="mt-0.5">{connection?.errorMessage || "None"}</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          {canManage && status !== "CONNECTED" ? (
            configured ? (
              <Link href="/api/integrations/quickbooks/start" className={cn(buttonVariants())}>
                {status === "REAUTH_REQUIRED" ? "Reconnect" : "Connect"}
              </Link>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                Connect QuickBooks to sync invoices. An owner still needs to add Intuit app credentials on the server.
              </p>
            )
          ) : null}
          {canManage && status === "CONNECTED" ? (
            <form
              action={async () => {
                "use server";
                await disconnectQuickBooksAction();
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Disconnect
              </Button>
            </form>
          ) : null}
        </div>
        {status === "CONNECTED" ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Disconnecting removes the login. Invoice history, payments, receipts, and past sync records stay in
            ContractorYou.
          </p>
        ) : null}
      </section>

      <ActionForm
        action={saveQuickBooksSettingsAction}
        successMessage="Sync setting saved."
        className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6"
      >
        <h2 className="font-medium">When to send invoices</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Default is manual only. Imported history never goes to QuickBooks unless you press Sync on that invoice.
        </p>
        <fieldset className="space-y-3">
          {INVOICE_TRIGGER_COPY.map((option) => (
            <label key={option.value} className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border)] p-3">
              <input
                type="radio"
                name="invoiceSyncTrigger"
                value={option.value}
                defaultChecked={settings.invoiceSyncTrigger === option.value}
                className="mt-1"
                disabled={!canManage}
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="mt-1 block text-sm text-[var(--muted-foreground)]">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {canManage ? <Button type="submit">Save setting</Button> : null}
      </ActionForm>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <h2 className="font-medium">Sync history</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">No QuickBooks syncs yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)] text-sm">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {event.entityType} · {event.action}
                  </p>
                  <p className="text-[var(--muted-foreground)]">
                    {event.quickbooksId ? `QuickBooks ${event.quickbooksId}` : "No QuickBooks id"}
                    {event.errorMessage ? ` · ${event.errorMessage}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={event.status} />
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{event.createdAt.toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
