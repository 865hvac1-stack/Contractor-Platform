import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";
import { CompanySmsForm } from "@/components/highlevel/company-sms-form";

export const dynamic = "force-dynamic";

export default async function OfficeCustomer360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("customers:view");
  if (!canAccessWorkspace(ctx.role, "office")) {
    redirect(landingPath(ctx.role));
  }
  const { id } = await params;

  const customer = await prisma.customer.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      properties: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      equipment: { orderBy: { createdAt: "desc" }, take: 12 },
      customerMemberships: {
        include: { plan: { select: { name: true } } },
        orderBy: { saleDate: "desc" },
        take: 5,
      },
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { property: { select: { address: true, city: true } } },
      },
      estimates: {
        where: { status: { in: ["DRAFT", "SENT", "VIEWED"] } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, estimateNumber: true, status: true, totalCents: true },
      },
      invoices: {
        where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, balanceCents: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, invoiceNumber: true, status: true, balanceCents: true },
      },
      callRecords: { orderBy: { startedAt: "desc" }, take: 5 },
    },
  });
  if (!customer) notFound();

  const name = customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();
  const upcoming = customer.jobs.filter((job) =>
    ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "IN_PROGRESS"].includes(job.status)
  );
  const recent = customer.jobs.filter((job) => job.status === "COMPLETED" || job.status === "CANCELED");
  const activeMembership = customer.customerMemberships.find((row) => row.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/office" className="text-sm text-[var(--muted-foreground)]">
            ← Customer Hub
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">{name}</h1>
            <StatusBadge status={customer.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {customer.phone || "No phone"}
            {customer.email ? ` · ${customer.email}` : ""}
            {customer.source ? ` · Source ${customer.source}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {customer.phone ? (
            <a
              href={`tel:${customer.phone}`}
              title="Device call. Company browser calling is not available."
              className="rounded-lg border px-3 py-2 text-sm"
            >
              Device call
            </a>
          ) : null}
          {can(ctx.role, "jobs:manage") ? (
            <Link
              href={`/office/jobs/new?customerId=${customer.id}`}
              className="rounded-lg bg-[var(--cy-orange)] px-3 py-2 text-sm font-medium text-white"
            >
              Create job
            </Link>
          ) : null}
          <Link href={`/customers/${customer.id}`} className="rounded-lg border px-3 py-2 text-sm">
            Full record
          </Link>
        </div>
      </div>
      {customer.phone ? <CompanySmsForm to={customer.phone} customerId={customer.id} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border bg-white p-4 lg:col-span-2">
          <h2 className="font-semibold text-[var(--cy-navy)]">Properties</h2>
          {customer.properties.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No property on file yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {customer.properties.map((property) => (
                <li key={property.id}>
                  {property.address}, {property.city}, {property.state} {property.zip}
                  {property.accessNotes ? (
                    <span className="block text-[var(--muted-foreground)]">Access: {property.accessNotes}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-semibold text-[var(--cy-navy)]">Membership</h2>
          {activeMembership ? (
            <p className="mt-2 text-sm">{activeMembership.plan.name}</p>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No active membership.</p>
          )}
          {customer.tags.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">Tags: {customer.tags.join(", ")}</p>
          ) : null}
          {customer.notes ? <p className="mt-3 text-sm">{customer.notes}</p> : null}
        </section>
      </div>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="font-semibold text-[var(--cy-navy)]">Equipment</h2>
        {customer.equipment.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No equipment recorded.</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {customer.equipment.map((item) => (
              <li key={item.id} className="text-sm">
                {item.name}
                {item.model ? ` · ${item.model}` : ""}
                {item.warrantyExpiresAt ? ` · warranty ${format(item.warrantyExpiresAt, "MMM d, yyyy")}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-semibold text-[var(--cy-navy)]">Upcoming / open jobs</h2>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No open jobs.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((job) => (
                <li key={job.id}>
                  <Link href={`/jobs/${job.id}`} className="text-sm font-medium text-[var(--cy-navy)]">
                    {job.jobNumber} · {job.jobType || "Job"}
                  </Link>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {job.status}
                    {job.scheduledStart ? ` · ${format(job.scheduledStart, "MMM d, h:mm a")}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-semibold text-[var(--cy-navy)]">Recent jobs</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No completed jobs yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {recent.map((job) => (
                <li key={job.id}>
                  <Link href={`/jobs/${job.id}`} className="text-sm font-medium text-[var(--cy-navy)]">
                    {job.jobNumber} · {job.jobType || "Job"}
                  </Link>
                  <p className="text-xs text-[var(--muted-foreground)]">{job.status}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-semibold text-[var(--cy-navy)]">Open estimates</h2>
          {customer.estimates.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">No open estimates.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {customer.estimates.map((estimate) => (
                <li key={estimate.id}>
                  <Link href={`/estimates/${estimate.id}`} className="text-sm font-medium">
                    {estimate.estimateNumber} · {formatMoney(estimate.totalCents)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        {can(ctx.role, "invoices:view") ? (
          <section className="rounded-2xl border bg-white p-4">
            <h2 className="font-semibold text-[var(--cy-navy)]">Open invoices</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Balance only. Accounting and QuickBooks configuration stay in Settings.
            </p>
            {customer.invoices.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">Nothing outstanding.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {customer.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link href={`/invoices/${invoice.id}`} className="text-sm font-medium">
                      {invoice.invoiceNumber} · {formatMoney(invoice.balanceCents)} due
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="font-semibold text-[var(--cy-navy)]">Recent communications</h2>
        {customer.callRecords.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            No call records yet. This uses the shared Communications system when it is live.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {customer.callRecords.map((call) => (
              <li key={call.id}>
                {call.missed ? "Missed" : "Call"} · {format(call.startedAt, "MMM d, h:mm a")}
                {call.caller ? ` · ${call.caller}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
