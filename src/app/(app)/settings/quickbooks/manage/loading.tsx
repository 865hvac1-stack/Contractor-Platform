export default function QuickBooksManageLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4" role="status" aria-live="polite">
      <div className="h-8 w-72 animate-pulse rounded bg-slate-200" />
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100" />
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">Loading customer exception…</p>
      </div>
    </div>
  );
}
