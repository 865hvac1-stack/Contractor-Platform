import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { getNeedsAttention } from "@/lib/attention";
import {
  filterAttention,
  parseAttentionFilter,
  parseAttentionSort,
  prioritizeAttention,
  sortAttention,
  type AttentionFilter,
  type AttentionSort,
} from "@/lib/attention-priority";
import { AttentionCard } from "@/components/command-center";

const FILTERS: { id: AttentionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "sales", label: "Sales" },
  { id: "money", label: "Money" },
  { id: "dispatch", label: "Dispatch" },
  { id: "customers", label: "Customers" },
  { id: "memberships", label: "Memberships" },
  { id: "team", label: "Team" },
];

const SORTS: { id: AttentionSort; label: string }[] = [
  { id: "priority", label: "Priority" },
  { id: "dollars", label: "Dollar value" },
  { id: "age", label: "Age" },
  { id: "newest", label: "Newest" },
];

export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; sort?: string }>;
}) {
  const ctx = await requirePermission("dashboard:view");
  const params = await searchParams;
  const filter = parseAttentionFilter(params.filter);
  const sort = parseAttentionSort(params.sort);
  const ranked = sortAttention(filterAttention(prioritizeAttention(await getNeedsAttention(ctx.company.id)), filter), sort);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Command Center</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Needs attention</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Every recorded follow-up, ranked by value, urgency, and risk. Nothing here is invented.
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <Link
              key={item.id}
              href={`/attention?filter=${item.id}&sort=${sort}`}
              className={`rounded-full px-3 py-1 text-sm ${
                filter === item.id ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {SORTS.map((item) => (
            <Link
              key={item.id}
              href={`/attention?filter=${filter}&sort=${item.id}`}
              className={`rounded-full px-3 py-1 text-sm ${
                sort === item.id ? "bg-[var(--cy-navy)] text-white" : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-6 py-10 text-center">
          <p className="font-medium text-[var(--cy-navy)]">Nothing in this view</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Try another filter or return to the Command Center.</p>
          <Link href="/dashboard" className="mt-3 inline-block text-sm font-medium text-[var(--cy-orange)]">
            Back to Home
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {ranked.map((item) => (
            <AttentionCard key={item.id} item={item} compact />
          ))}
        </ul>
      )}
    </div>
  );
}
