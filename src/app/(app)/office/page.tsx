import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerSearchTypeahead } from "@/components/customers/search-typeahead";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { getNeedsAttention } from "@/lib/attention";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { canAccessWorkspace, landingPath } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

const OFFICE_FOLLOW_UPS = new Set([
  "estimate_not_followed_up",
  "approved_estimate_not_scheduled",
  "lead_unanswered",
  "missed_call_no_follow_up",
  "membership_needs_review",
  "invoice_awaiting_payment",
  "job_missing_technician",
]);

export default async function OfficeHubPage() {
  const ctx = await requirePermission("customers:view");
  if (!canAccessWorkspace(ctx.role, "office")) {
    redirect(landingPath(ctx.role));
  }

  const [attention, recentCustomers, missedCalls] = await Promise.all([
    getNeedsAttention(ctx.company.id),
    prisma.customer.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, firstName: true, lastName: true, businessName: true, phone: true },
    }),
    prisma.callRecord.count({
      where: { companyId: ctx.company.id, missed: true, booked: { not: true } },
    }),
  ]);
  const followUps = attention.filter((item) => OFFICE_FOLLOW_UPS.has(item.type));

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Customer Hub
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
          Find the customer. Take care of the call.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Search, create a job, and send it to Dispatch. Same customer and job records as the rest of
          ContractorYou.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="text-lg font-semibold text-[var(--cy-navy)]">Customer search</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Name, phone, email, address, or company.
        </p>
        <div className="mt-4">
          <CustomerSearchTypeahead hrefFor={(id) => `/office/customers/${id}`} />
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {can(ctx.role, "customers:manage") ? (
          <Link href="/office/customers/new" className="rounded-2xl border bg-white p-4 hover:border-[var(--cy-navy)]/20">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">New customer</p>
            <p className="mt-2 font-medium text-[var(--cy-navy)]">Name, phone, property</p>
          </Link>
        ) : null}
        {can(ctx.role, "jobs:manage") ? (
          <Link href="/office/jobs/new" className="rounded-2xl border bg-white p-4 hover:border-[var(--cy-navy)]/20">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">New call / job</p>
            <p className="mt-2 font-medium text-[var(--cy-navy)]">Create and send to Dispatch</p>
          </Link>
        ) : null}
        {canAccessWorkspace(ctx.role, "dispatch") ? (
          <Link href="/dispatch" className="rounded-2xl border bg-white p-4 hover:border-[var(--cy-navy)]/20">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Schedule</p>
            <p className="mt-2 font-medium text-[var(--cy-navy)]">Open Dispatch Center</p>
          </Link>
        ) : (
          <Link href="/schedule" className="rounded-2xl border bg-white p-4 hover:border-[var(--cy-navy)]/20">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Schedule</p>
            <p className="mt-2 font-medium text-[var(--cy-navy)]">Request a window</p>
          </Link>
        )}
        <Link href="/marketing/communications" className="rounded-2xl border bg-white p-4 hover:border-[var(--cy-navy)]/20">
          <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Inbox</p>
          <p className="mt-2 font-medium text-[var(--cy-navy)]">Shared communications</p>
        </Link>
      </div>

      <section className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-5">
        <h2 className="text-lg font-semibold text-[var(--cy-navy)]">Incoming call</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Caller matching is ready for the Communications Command Center. Inbound calls are not
          simulated here.
        </p>
        {missedCalls === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            No missed-call records. When Communications is live, New / Text sent / Callback needed
            will appear here from the same CallRecord system.
          </p>
        ) : (
          <p className="mt-3 text-sm">
            {missedCalls} missed call{missedCalls === 1 ? "" : "s"} recorded. Review Communications
            to follow up.
          </p>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-semibold text-[var(--cy-navy)]">Follow-up</h2>
        {followUps.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">No follow-ups need attention.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {followUps.slice(0, 12).map((item) => (
              <li key={item.id} className="py-3">
                <Link href={item.href} className="font-medium text-[var(--cy-navy)]">
                  {item.title}
                </Link>
                <p className="text-sm text-[var(--muted-foreground)]">{item.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--cy-navy)]">Recent customers</h2>
          <Link href="/customers" className="text-sm text-[var(--cy-orange)]">
            All customers
          </Link>
        </div>
        {recentCustomers.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">No customers match your search yet.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {recentCustomers.map((customer) => (
              <li key={customer.id} className="py-2">
                <Link href={`/office/customers/${customer.id}`} className="font-medium text-[var(--cy-navy)]">
                  {customer.businessName?.trim() || `${customer.firstName} ${customer.lastName}`.trim()}
                </Link>
                <p className="text-sm text-[var(--muted-foreground)]">{customer.phone || "No phone"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can(ctx.role, "intelligence:view") ? (
        <AskContractorYou suggestions={suggestedQuestions(ctx.role, null, "office")} />
      ) : null}
    </div>
  );
}
