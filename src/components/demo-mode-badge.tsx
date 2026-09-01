export function DemoModeBadge({
  compact = false,
  tone = "on-light",
}: {
  compact?: boolean;
  tone?: "on-light" | "on-dark";
}) {
  const styles =
    tone === "on-dark"
      ? "border-white/25 bg-[#FF6A1A] text-white"
      : "border-[#FF6A1A]/30 bg-[#FF6A1A]/10 text-[#9A3412]";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${styles}`}
    >
      {compact ? "Demo" : "Demo company"}
    </span>
  );
}
