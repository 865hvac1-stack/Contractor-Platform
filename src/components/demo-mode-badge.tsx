export function DemoModeBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[#FF6A1A]/30 bg-[#FF6A1A]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9A3412]">
      {compact ? "Demo" : "Demo company"}
    </span>
  );
}
