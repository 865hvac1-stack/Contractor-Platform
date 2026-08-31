import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { customerLabel } from "@/lib/tech/today";
import { compensationUserFilter } from "@/lib/compensation/access";

export default async function TechIncentiveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("compensation:view_own");
  const filter = compensationUserFilter(ctx.role, ctx.user.id);
  if (!filter) notFound();

  const event = await prisma.compensationEvent.findFirst({
    where: { id, companyId: ctx.company.id, ...filter },
    include: {
      rule: true,
      job: { select: { id: true, jobNumber: true, jobType: true } },
      customer: { select: { firstName: true, lastName: true, businessName: true } },
    },
  });
  if (!event) notFound();

  return (
    <div className="space-y-4">
      <Link href="/tech/performance" className="text-xs font-medium text-[var(--muted-foreground)]">
        ← Scorecard
      </Link>
      <h1 className="font-display text-3xl tracking-tight">{event.rule.name}</h1>
      <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-4">
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Source</span>
          {event.sourceType.replaceAll("_", " ")}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Customer</span>
          {event.customer ? customerLabel(event.customer) : "Not linked"}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Job</span>
          {event.job ? `${event.job.jobNumber}${event.job.jobType ? ` · ${event.job.jobType}` : ""}` : "Not linked"}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Rule</span>
          {event.rule.name}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Amount</span>
          <span className="text-xl font-semibold tabular-nums">{formatMoney(event.amountCents)}</span>
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Status</span>
          {event.status}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Date</span>
          {event.earnedAt.toLocaleString()}
        </p>
        <p>
          <span className="block text-xs text-[var(--muted-foreground)]">Why it was generated</span>
          {event.calculationBasis}
        </p>
        {event.status !== "PAID" ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            This is not paid earnings. Only incentives marked Paid are paid.
          </p>
        ) : (
          <p className="text-sm text-emerald-800">Marked paid by the company.</p>
        )}
      </section>
    </div>
  );
}
