import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { listActionRequests } from "@/lib/actions/approvals";
import { formatMoney } from "@/lib/money";
import { format } from "date-fns";

const TABS = [
  { id: "approval", label: "Needs approval" },
  { id: "drafts", label: "Drafts" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
] as const;

export default async function ActionCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requirePermission("intelligence:view");
  const params = await searchParams;
  const tab = TABS.some((item) => item.id === params.tab) ? (params.tab as (typeof TABS)[number]["id"]) : "approval";
  const rows = await listActionRequests(ctx.company.id, tab);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Action Center</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">AI work, under your control</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          ContractorYou prepares the work. You approve it. Nothing leaves this company until you say so.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/actions?tab=${item.id}`}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === item.id ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-12 text-center">
          <p className="font-medium text-[var(--cy-navy)]">Nothing in this queue</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Ask ContractorYou to draft follow-ups, reminders, or dispatch changes and they will land here.
          </p>
          <Link href="/intelligence?ask=Take%20care%20of%20my%20estimate%20follow-ups." className="mt-4 inline-block text-sm text-[var(--cy-orange)]">
            Take care of estimate follow-ups
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--cy-gray)] text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Requested by</th>
                <th className="px-4 py-3 font-medium">Targets</th>
                <th className="px-4 py-3 font-medium">Impact</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3">
                    <Link href={`/actions/${row.id}`} className="font-medium text-[var(--cy-navy)]">
                      {row.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {row.requestedBy.firstName} {row.requestedBy.lastName}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.targetCount}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.estimatedImpactCents ? formatMoney(row.estimatedImpactCents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{format(row.createdAt, "MMM d, h:mm a")}</td>
                  <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">{row.status.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
