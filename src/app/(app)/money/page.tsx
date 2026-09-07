import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { getHomeSummary } from "@/lib/home";
import { MoneySubnav } from "@/components/hub-subnav";

export default async function MoneyPage() {
  const ctx = await requirePermission("invoices:view");
  const data = await getHomeSummary(ctx.company.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Money</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          What came in, what went out, who owes us, and what needs attention.
        </p>
      </header>
      <MoneySubnav />
      {data.snapshot ? (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneyStat label="Revenue this month" value={formatMoney(data.snapshot.revenueCents)} href="/invoices" />
          <MoneyStat label="Collected this month" value={formatMoney(data.snapshot.collectedCents)} href="/payments" />
          <MoneyStat label="A/R" value={formatMoney(data.snapshot.arCents)} href="/invoices?status=overdue" />
          <MoneyStat label="Open estimates" value={formatMoney(data.snapshot.openEstimateCents)} href="/estimates?status=open" />
        </dl>
      ) : (
        <p className="rounded-2xl border border-[var(--border)] bg-white px-4 py-6 text-sm text-[var(--muted-foreground)]">
          We&apos;re still building your business picture. Verified invoices and payments will show here.
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-sm font-medium">
        <Link href="/invoices" className="text-[var(--cy-orange)]">
          View invoices →
        </Link>
        <Link href="/payments" className="text-[var(--cy-orange)]">
          View payments →
        </Link>
        {can(ctx.role, "reports:view") ? (
          <Link href="/reports" className="text-[var(--cy-orange)]">
            View reports →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function MoneyStat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-[var(--border)] bg-white px-4 py-4 hover:border-[var(--cy-orange)]/40">
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--cy-navy)]">{value}</dd>
    </Link>
  );
}
