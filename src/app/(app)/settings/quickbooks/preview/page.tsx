import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { loadQuickBooksProductionPreview } from "@/lib/quickbooks/production-preview";
import { maskRealmId } from "@/lib/quickbooks/errors";
import { refreshQuickBooksPreviewAction } from "@/server/actions/quickbooks";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function QuickBooksProductionPreviewPage() {
  const ctx = await requirePermission("accounting:view");
  const result = await loadQuickBooksProductionPreview(prisma, ctx.company.id)
    .then((preview) => ({ preview, error: null }))
    .catch((error) => ({
      preview: null,
      error: error instanceof Error ? error.message : "QuickBooks preview could not be loaded.",
    }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/settings/quickbooks" className="text-sm text-[var(--muted-foreground)]">
          ← QuickBooks
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Production Data Preview</h1>
      </div>

      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">Read-only preview</p>
        <p className="mt-2 text-sm text-sky-950">
          Nothing on this page is imported into ContractorYou or written back to QuickBooks.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionForm action={refreshQuickBooksPreviewAction}>
            <Button type="submit" size="sm" variant="outline">
              Refresh preview
            </Button>
          </ActionForm>
          <Link href="/settings/quickbooks/manage" className="inline-flex h-8 items-center rounded-md border border-[var(--border)] px-3 text-sm">
            Open Sync Center
          </Link>
        </div>
      </section>

      {result.error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="font-medium text-rose-900">Needs attention</h2>
          <p className="mt-2 text-sm text-rose-800">{result.error}</p>
        </section>
      ) : null}

      {result.preview ? (
        <>
          <p className="text-sm text-[var(--muted-foreground)]">
            {result.preview.environment === "production" ? "Production" : "Sandbox"} · Realm{" "}
            {maskRealmId(result.preview.realmId)}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <PreviewCard title="Customers" count={result.preview.customers.count} error={result.preview.customers.error}>
              {result.preview.customers.sample.map((row) => (
                <li key={row.id}>{row.name}</li>
              ))}
            </PreviewCard>
            <PreviewCard title="Invoices" count={result.preview.invoices.count} error={result.preview.invoices.error}>
              {result.preview.invoices.sample.map((row) => (
                <li key={row.id}>
                  {row.number} · {row.date || "No date"} · {row.status}
                </li>
              ))}
            </PreviewCard>
            <PreviewCard title="Payments" count={result.preview.payments.count} error={result.preview.payments.error}>
              {result.preview.payments.sample.map((row) => (
                <li key={row.id}>
                  {row.date || "No date"} · {row.amount == null ? "Amount unavailable" : `$${row.amount.toFixed(2)}`}
                </li>
              ))}
            </PreviewCard>
            <PreviewCard title="Products / Services" count={result.preview.items.count} error={result.preview.items.error}>
              {result.preview.items.sample.map((row) => (
                <li key={row.id}>
                  {row.name}
                  {row.type ? ` · ${row.type}` : ""}
                </li>
              ))}
            </PreviewCard>
            <PreviewCard title="Expenses / Purchases" count={result.preview.expenses.count} error={result.preview.expenses.error}>
              {result.preview.expenses.sample.map((row) => (
                <li key={row.id}>
                  {row.date || "No date"} · {row.amount == null ? "Amount unavailable" : `$${row.amount.toFixed(2)}`}
                </li>
              ))}
            </PreviewCard>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PreviewCard({
  title,
  count,
  error,
  children,
}: {
  title: string;
  count: number | null;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-[var(--cy-navy)]">
        {count == null ? "Unavailable" : count.toLocaleString()}
      </p>
      <p className="text-xs text-[var(--muted-foreground)]">
        {count == null ? "Not available under the current Accounting API response" : "available in QuickBooks"}
      </p>
      {error ? <p className="mt-3 text-sm text-amber-700">{error}</p> : null}
      <ul className="mt-4 space-y-1 text-sm text-[var(--muted-foreground)]">{children}</ul>
    </section>
  );
}

