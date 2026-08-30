import { cn } from "@/lib/utils";
import { brand } from "@/lib/brand";

type BrandMarkProps = {
  variant?: "full" | "compact" | "icon";
  tone?: "dark" | "light";
  className?: string;
};

/**
 * Temporary CY mark + wordmark.
 * Replace the mark span with a final SVG/PNG later — layout slots stay the same.
 */
export function BrandMark({
  variant = "full",
  tone = "dark",
  className,
}: BrandMarkProps) {
  const onDark = tone === "light";
  const mark = (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--cy-orange)] font-semibold tracking-tight text-white",
        variant === "icon" ? "h-10 w-10 text-sm" : "h-8 w-8 text-[11px]"
      )}
    >
      {brand.mark}
    </span>
  );

  if (variant === "icon") {
    return (
      <span className={cn("inline-flex", className)} title={brand.name}>
        {mark}
        <span className="sr-only">{brand.name}</span>
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        {mark}
        <span className="sr-only">{brand.name}</span>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {mark}
      <span
        className={cn(
          "text-[13px] font-semibold tracking-[0.14em]",
          onDark ? "text-white" : "text-[var(--cy-navy)]"
        )}
      >
        {brand.wordmarkPrimary}
        <span className="text-[var(--cy-orange)]"> {brand.wordmarkAccent}</span>
      </span>
    </span>
  );
}
