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
  const { query, total, pages, customers } = await loadCustomerList(ctx.company.id, params);
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
        <CustomerSearchTypeahead hrefPrefix="/customers" emphasis placeholder="Search name, phone, email, address..." />
        <form method="get" className="mt-3 flex gap-2">
          <input
            name="q"
            defaultValue={query.q}
            placeholder="Or search the list"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] px-3 text-sm"
          />
          {query.view !== "recent" ? <input type="hidden" name="view" value={query.view} /> : null}
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
            Search
          </button>
        </form>
      </div>

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
                  const property = customer.properties[0];
                  return (
                    <tr key={customer.id} className="border-t border-[var(--border)] hover:bg-[var(--cy-gray)]/50">
                      <td className="px-4 py-3">
                        <Link href={`/customers/${customer.id}`} className="font-medium text-[var(--cy-navy)] hover:text-[var(--cy-orange)]">
                          {name}
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--muted-foreground)] md:table-cell">
                        {customer.phone || "—"}
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--muted-foreground)] sm:table-cell">
                        {property?.city || property?.address || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={customer.status} />
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--muted-foreground)] lg:table-cell">
                        {customer.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
