import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requirePermission("customers:view");
  const { q } = await searchParams;
  const query = q?.trim() || "";

  const customers = await prisma.customer.findMany({
    where: {
      companyId: ctx.company.id,
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { businessName: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
              { phone: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            People and businesses you serve.
          </p>
        </div>
        <Link href="/customers/new" className={cn(buttonVariants())}>
          New customer
        </Link>
      </div>

      <form className="flex max-w-md gap-2" method="get">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Search name, email, phone…"
          aria-label="Search customers"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          title={query ? "No matches" : "No customers yet"}
          description={
            query
              ? "Try a different search, or add a new customer."
              : "Add your first customer to start jobs, estimates, and invoices."
          }
          actionLabel="Add customer"
          actionHref="/customers/new"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => {
                const name =
                  c.businessName?.trim() || `${c.firstName} ${c.lastName}`.trim();
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-medium text-[var(--foreground)] hover:underline"
                      >
                        {name}
                      </Link>
                      {c.businessName ? (
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {c.firstName} {c.lastName}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="text-sm text-[var(--muted-foreground)]">
                        {c.phone || c.email || "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="hidden text-[var(--muted-foreground)] sm:table-cell">
                      {c.source || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
