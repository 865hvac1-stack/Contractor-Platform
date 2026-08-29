import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-white/60 px-6 py-16 text-center">
      <h3 className="font-display text-xl text-[var(--foreground)]">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-[var(--muted-foreground)]">{description}</p>
      {actionLabel && actionHref ? (
        <Link href={actionHref} className={cn(buttonVariants(), "mt-6")}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
