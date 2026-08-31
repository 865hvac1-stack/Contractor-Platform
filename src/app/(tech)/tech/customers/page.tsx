import Link from "next/link";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { customerLabel } from "@/lib/tech/today";
import { CustomerSearchTypeahead } from "@/components/customers/search-typeahead";

export default async function TechCustomersPage() {
  const ctx = await requirePermission("customers:view");
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const customers = await prisma.customer.findMany({
    where: {
      companyId: ctx.company.id,
      jobs: { some: { companyId: ctx.company.id, ...access } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 80,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      phone: true,
      properties: { take: 1, select: { address: true, city: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl tracking-tight">Customers</h1>
      <p className="text-sm text-[var(--muted-foreground)]">People on jobs assigned to you. No company accounting.</p>
      <CustomerSearchTypeahead hrefPrefix="/tech/customers" />
      {customers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-12 text-center text-sm text-[var(--muted-foreground)]">
          No customers on your assigned jobs.
        </p>
      ) : (
        <ul className="space-y-2">
          {customers.map((customer) => (
            <li key={customer.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <p className="font-medium">{customerLabel(customer)}</p>
              <p className="text-sm text-[var(--muted-foreground)]">
                {customer.phone ?? "No phone"}
                {customer.properties[0] ? ` · ${customer.properties[0].address}, ${customer.properties[0].city}` : ""}
              </p>
              {customer.phone ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <a href={`tel:${customer.phone}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium">
                    Call
                  </a>
                  <a href={`sms:${customer.phone}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium">
                    Text
                  </a>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Link href="/tech/more" className="block text-center text-sm text-[var(--muted-foreground)]">
        Back to more
      </Link>
    </div>
  );
}
