import { cn } from "@/lib/utils";
import { brand } from "@/lib/brand";
import { CyMonogram, OfficialLockup } from "@/components/cy-monogram";

type BrandMarkProps = {
  variant?: "full" | "compact" | "icon" | "stacked";
  tone?: "dark" | "light";
  className?: string;
  priority?: boolean;
};

function YouAccent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-[linear-gradient(180deg,#ffc14d_0%,#f87000_46%,#d83200_100%)] bg-clip-text text-transparent",
        className
      )}
    >
      {children}
    </span>
  );
}

function Wordmark({
  tone,
  size = "md",
}: {
  tone: "dark" | "light";
  size?: "sm" | "md" | "lg";
}) {
  const onDark = tone === "light";
  return (
    <span
      className={cn(
        "font-semibold uppercase leading-none tracking-[0.06em]",
        size === "sm" && "text-[12px]",
        size === "md" && "text-[13px]",
        size === "lg" && "text-[22px] tracking-[0.08em] md:text-[28px]",
        onDark ? "text-white" : "text-[var(--cy-navy)]"
      )}
    >
      {brand.wordmarkPrimary}
      <YouAccent>{brand.wordmarkAccent}</YouAccent>
    </span>
  );
}

function Tagline({ tone, className }: { tone: "dark" | "light"; className?: string }) {
  const onDark = tone === "light";
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="h-[2px] w-6 shrink-0 rounded-full bg-[linear-gradient(90deg,#ffc14d,#d83200)] md:w-8"
      />
      <span
        className={cn(
          "text-[9px] font-medium uppercase tracking-[0.18em] md:text-[10px]",
          onDark ? "text-white/55" : "text-[var(--cy-navy)]"
        )}
      >
        {brand.positioning}
      </span>
      <span
        aria-hidden
        className="h-[2px] w-6 shrink-0 rounded-full bg-[linear-gradient(90deg,#ffc14d,#d83200)] md:w-8"
      />
    </span>
  );
}

export function BrandMark({
  variant = "full",
  tone = "dark",
  className,
  priority,
}: BrandMarkProps) {
  if (variant === "icon") {
    return (
      <span className={cn("inline-flex", className)} title={brand.name}>
        <CyMonogram className="h-10 w-auto" title={brand.name} priority={priority} />
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className={cn("inline-flex items-center", className)} title={brand.name}>
        <CyMonogram className="h-8 w-auto" priority={priority} />
        <span className="sr-only">{brand.name}</span>
      </span>
    );
  }

  if (variant === "stacked") {
    if (tone === "dark") {
      return (
        <span className={cn("inline-flex", className)}>
          <OfficialLockup priority={priority} />
        </span>
      );
    }

    return (
      <span className={cn("inline-flex flex-col items-center", className)}>
        <CyMonogram className="h-16 w-auto md:h-20" priority={priority} />
        <Wordmark tone={tone} size="lg" />
        <Tagline tone={tone} className="mt-2.5" />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CyMonogram className="h-9 w-auto" priority={priority} />
      <Wordmark tone={tone} size="md" />
    </span>
  );
}
