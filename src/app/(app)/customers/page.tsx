import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { CustomerSearchTypeahead } from "@/components/customers/search-typeahead";
import { customersListHref, loadCustomerList } from "@/lib/customers/list";
import { cn } from "@/lib/utils";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; page?: string }>;
}) {
  const ctx = await requirePermission("customers:view");
  const params = await searchParams;
  const { query, total, pages, customers, summary } = await loadCustomerList(ctx.company.id, params);
  const views = [
    { id: "recent", label: "Recent", href: customersListHref({ q: query.q, view: "recent" }) },
    { id: "attention", label: "Needs attention", href: customersListHref({ q: query.q, view: "attention" }) },
    { id: "all", label: "All customers", href: customersListHref({ q: query.q, view: "all" }) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Customers</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Find a customer, property, or contact.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(ctx.role, "imports:manage") ? (
            <Link href="/settings/import" className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}>
              Import
            </Link>
          ) : null}
          <Link href="/customers/new" className={cn(buttonVariants(), "h-10 px-4")}>
            + Add Customer
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <CustomerSearchTypeahead
          hrefPrefix="/customers"
          emphasis
          initialQuery={query.q}
          listSearchHref={customersListHref({ view: query.view })}
          placeholder="Search name, phone, email, company, or property address..."
        />
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Customer operations summary">
        <CustomerMetric label="Total Customers" value={summary.total} href="/customers?view=all" active={query.view === "all"} />
        <CustomerMetric label="Needs Attention" value={summary.needsAttention} href="/customers?view=attention" active={query.view === "attention"} tone />
        <CustomerMetric label="Maintenance Due" value={summary.maintenanceDue} href="/customers?view=maintenance-due" active={query.view === "maintenance-due"} />
        <CustomerMetric label="Open Estimates" value={summary.openEstimates} href="/customers?view=open-estimates" active={query.view === "open-estimates"} />
        <CustomerMetric label="Balances Due" value={summary.balancesDue} href="/customers?view=balances-due" active={query.view === "balances-due"} tone />
        <CustomerMetric label="New This Month" value={summary.newThisMonth} href="/customers?view=new-this-month" active={query.view === "new-this-month"} />
      </section>

      <div className="flex gap-2 overflow-x-auto">
        {views.map((view) => (
          <Link
            key={view.id}
            href={view.href}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium",
              query.view === view.id ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
            )}
          >
            {view.label}
          </Link>
        ))}
      </div>

      {customers.length === 0 ? (
        query.q || query.view === "attention" ? (
          <EmptyState
            title="No matches"
            description="Try a different search, or add a new customer."
            actionLabel="Add customer"
            actionHref="/customers/new"
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-16 text-center">
            <h3 className="font-display text-xl">Add your first customer</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
              Search is the fastest way in once people are here.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link href="/customers/new" className={cn(buttonVariants(), "h-10 px-4")}>
                + Add Customer
              </Link>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--cy-gray)]/70 text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Phone</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Property</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => {
                  const name = customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();
                  const property = customer.displayProperty;
                  const customerHref = `/customers/${customer.id}${customer.matchedPropertyId ? `?propertyId=${customer.matchedPropertyId}` : ""}`;
                  const attention = [
                    customer.maintenanceVisits.length ? "Maintenance due" : null,
                    customer.invoices.length ? "Balance due" : null,
                    customer.estimates.length ? "Open estimate" : null,
                    customer.waitingRecords.length ? "Customer waiting" : null,
                    customer.communicationThreads.length ? "Needs reply" : null,
                  ].filter(Boolean);
                  return (
                    <tr key={customer.id} className="group border-t border-[var(--border)] hover:bg-[var(--cy-gray)]/50">
                      <td className="px-4 py-3">
                        <Link href={customerHref} className="block rounded font-medium text-[var(--cy-navy)] hover:text-[var(--cy-orange)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]">
                          <span>{name}</span>
                          {attention.length ? <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-amber-700">{attention[0]}{attention.length > 1 ? ` +${attention.length - 1}` : ""}</span> : null}
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--muted-foreground)] md:table-cell">
                        <Link href={customerHref} className="block">{customer.phone || "—"}</Link>
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--muted-foreground)] sm:table-cell">
                        <Link href={customerHref} className="block">
                          {property?.address || property?.city || "—"}
                          {customer.matchedPropertyId ? <span className="block text-[10px] font-semibold uppercase text-[var(--cy-orange)]">Matched property</span> : null}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={customerHref} className="block"><StatusBadge status={customer.status} /></Link>
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--muted-foreground)] lg:table-cell">
                        <Link href={customerHref} className="block">{customer.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <p className="text-[var(--muted-foreground)]">
              {total.toLocaleString()} customer{total === 1 ? "" : "s"} · page {query.page} of {pages}
            </p>
            <div className="flex gap-2">
              {query.page > 1 ? (
                <Link href={customersListHref(query, query.page - 1)} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                  Previous
                </Link>
              ) : null}
              {query.page < pages ? (
                <Link href={customersListHref(query, query.page + 1)} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CustomerMetric({
  label,
  value,
  href,
  active,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  active: boolean;
  tone?: boolean;
}) {
  return (
    <Link
      href={active ? "/customers" : href}
      aria-pressed={active}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition hover:-translate-y-0.5 hover:border-[var(--cy-orange)]/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cy-orange)]",
        active ? "border-[var(--cy-navy)] bg-[var(--cy-navy)] text-white" : tone && value ? "border-amber-200 bg-amber-50" : "border-[var(--border)] bg-white"
      )}
    >
      <p className={cn("text-xl font-semibold tabular-nums", active ? "text-white" : "text-[var(--cy-navy)]")}>{value.toLocaleString()}</p>
      <p className={cn("text-[11px] font-medium", active ? "text-white/75" : "text-[var(--muted-foreground)]")}>{label}</p>
    </Link>
  );
}
