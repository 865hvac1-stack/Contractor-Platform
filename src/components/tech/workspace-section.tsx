export function WorkspaceSection({
  id,
  title,
  summary,
  open,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className="rounded-2xl border border-[var(--border)] bg-white">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="font-medium text-[var(--cy-navy)]">{title}</span>
        <span className="max-w-[55%] truncate text-right text-xs text-[var(--muted-foreground)]">{summary}</span>
      </summary>
      <div className="space-y-3 border-t border-[var(--border)] px-4 py-4">{children}</div>
    </details>
  );
}
