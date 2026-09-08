import Link from "next/link";

export function FinanceFilterContext({
  title,
  detail,
  amount,
  backHref = "/dashboard",
}: {
  title: string;
  detail: string;
  amount?: string;
  backHref?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cy-orange)]">{title}</p>
        <p className="mt-0.5 text-sm text-[var(--cy-navy)]">{detail}</p>
        {amount ? <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--cy-navy)]">{amount}</p> : null}
      </div>
      <Link href={backHref} className="text-sm font-medium text-[var(--cy-navy)] underline-offset-4 hover:underline">
        {backHref.startsWith("/office") ? "Back to Customer Hub" : "Back to Home"}
      </Link>
    </div>
  );
}
