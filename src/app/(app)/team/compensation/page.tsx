import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { summarizeCompensation } from "@/lib/compensation/calculate";
import {
  bulkApproveCompensationAction,
  createCompensationRuleAction,
} from "@/server/actions/compensation";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TABS = ["needs", "approved", "paid", "voided", "rules"] as const;

export default async function CompensationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requirePermission("compensation:view_all");
  const tab = (await searchParams).tab ?? "needs";
  const [events, rules, members] = await Promise.all([
    prisma.compensationEvent.findMany({
      where: { companyId: ctx.company.id },
      include: {
        user: { select: { firstName: true, lastName: true } },
        rule: { select: { name: true, type: true } },
        job: { select: { jobNumber: true } },
      },
      orderBy: { earnedAt: "desc" },
      take: 200,
    }),
    prisma.compensationRule.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.membership.findMany({
      where: { companyId: ctx.company.id },
      include: { user: true },
    }),
  ]);
  const summary = summarizeCompensation(events);
  const filtered = events.filter((event) => {
    if (tab === "needs") return event.status === "PENDING" || event.status === "QUALIFIED";
    if (tab === "approved") return event.status === "APPROVED";
    if (tab === "paid") return event.status === "PAID";
    if (tab === "voided") return event.status === "VOIDED";
    return false;
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Team</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Compensation</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Operational incentives only. This is not payroll and does not send money.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Pending", value: summary.pendingCents },
          { label: "Qualified", value: summary.qualifiedCents },
          { label: "Approved", value: summary.approvedCents },
          { label: "Paid", value: summary.paidCents },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-[var(--border)] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">{card.label}</p>
            <p className="mt-1 text-xl tabular-nums">{formatMoney(card.value)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((value) => (
          <Link
            key={value}
            href={`/team/compensation?tab=${value}`}
            className={`rounded-full px-3 py-1 text-sm ${
              tab === value ? "bg-[var(--cy-navy)] text-white" : "bg-[var(--muted)]"
            }`}
          >
            {value === "needs" ? "Needs approval" : value[0].toUpperCase() + value.slice(1)}
          </Link>
        ))}
        <Link href="/team/compensation/export" className="rounded-full bg-[var(--muted)] px-3 py-1 text-sm">
          Export CSV
        </Link>
      </div>

      {tab === "rules" ? (
        <div className="space-y-4">
          <ActionForm
            action={createCompensationRuleAction}
            successMessage="Rule saved. Future events use this version."
            className="grid gap-3 rounded-xl border border-[var(--border)] bg-white p-4 sm:grid-cols-2"
          >
            <h2 className="font-medium sm:col-span-2">New rule</h2>
            <Input name="name" placeholder="Membership sold" required />
            <select name="type" className="h-8 rounded-lg border border-input px-2.5 text-sm">
              <option value="FLAT_AMOUNT">Flat amount</option>
              <option value="PERCENT_OF_SALE">Percent of sale</option>
              <option value="PERCENT_OF_GROSS_PROFIT">Percent of gross profit</option>
              <option value="TIERED">Tiered (foundation)</option>
              <option value="THRESHOLD_BONUS">Threshold bonus (foundation)</option>
            </select>
            <select name="trigger" className="h-8 rounded-lg border border-input px-2.5 text-sm">
              <option value="MEMBERSHIP_SOLD">Membership sold</option>
              <option value="PRICEBOOK_ITEM_SOLD">Pricebook item sold</option>
              <option value="ESTIMATE_APPROVED">Estimate approved</option>
              <option value="INVOICE_PAID">Invoice paid</option>
              <option value="JOB_COMPLETED">Job completed</option>
            </select>
            <Input name="amount" type="number" step="0.01" placeholder="Flat $ amount" />
            <Input name="percent" type="number" step="0.01" placeholder="Percent (5 = 5%)" />
            <Input name="minAmount" type="number" step="0.01" placeholder="Minimum sale (optional)" />
            <Button type="submit" size="sm" className="sm:col-span-2">
              Save rule
            </Button>
          </ActionForm>
          {rules.length === 0 ? (
            <EmptyState title="No compensation rules yet." description="Rules are not seeded. Create one to start tracking incentives." />
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li key={rule.id} className="rounded-xl border border-[var(--border)] bg-white p-4 text-sm">
                  <p className="font-medium">{rule.name}</p>
                  <p className="text-[var(--muted-foreground)]">
                    {rule.type.replaceAll("_", " ")} · {rule.trigger.replaceAll("_", " ")}
                    {rule.amountCents != null ? ` · ${formatMoney(rule.amountCents)}` : ""}
                    {rule.percentBps != null ? ` · ${rule.percentBps / 100}%` : ""}
                    {rule.active ? "" : " · Inactive"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No compensation earned this week."
          description="Items appear here after a qualifying live sale. Historical imports never create incentives."
        />
      ) : (
        <ActionForm action={bulkApproveCompensationAction} className="space-y-3">
          <input
            type="hidden"
            name="status"
            value={tab === "approved" ? "PAID" : tab === "needs" ? "APPROVED" : "VOIDED"}
          />
          <ul className="space-y-2">
            {filtered.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-white p-4">
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" name="eventId" value={event.id} defaultChecked={tab === "needs"} />
                  <span>
                    <span className="font-medium">
                      {event.user.firstName} {event.user.lastName} · {formatMoney(event.amountCents)}
                    </span>
                    <span className="mt-1 block text-[var(--muted-foreground)]">
                      {event.rule.name} · {event.calculationBasis}
                      {event.job ? ` · ${event.job.jobNumber}` : ""}
                    </span>
                  </span>
                </label>
                <StatusBadge status={event.status} />
              </li>
            ))}
          </ul>
          {tab === "needs" ? (
            <Button type="submit">Approve selected</Button>
          ) : tab === "approved" ? (
            <Button type="submit">Mark selected paid</Button>
          ) : null}
        </ActionForm>
      )}

      <p className="text-xs text-[var(--muted-foreground)]">
        {members.length} team members can earn incentives when a rule matches a live event. Pending is never paid.
      </p>
    </div>
  );
}
