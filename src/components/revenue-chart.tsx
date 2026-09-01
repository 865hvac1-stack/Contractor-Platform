"use client";

import { useState } from "react";
import { formatMoneyCompact } from "@/lib/money";

type Point = { key: string; label: string; revenueCents: number };

export function RevenueChart({
  series,
}: {
  series: { d30: Point[]; d90: Point[]; m12: Point[] };
}) {
  const [range, setRange] = useState<"d30" | "d90" | "m12">("d30");
  const points = series[range];
  const max = Math.max(...points.map((point) => point.revenueCents), 1);
  const width = 640;
  const height = 160;
  const pad = 8;
  const coords = points.map((point, index) => {
    const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - (point.revenueCents / max) * (height - pad * 2);
    return `${x},${y}`;
  });
  const area = `M ${pad},${height - pad} L ${coords.join(" L ")} L ${width - pad},${height - pad} Z`;
  const line = `M ${coords.join(" L ")}`;
  const total = points.reduce((sum, point) => sum + point.revenueCents, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted-foreground)]">
          {range === "m12" ? "12-month collected revenue" : range === "d90" ? "90-day collected revenue" : "30-day collected revenue"}
          {total > 0 ? ` · ${formatMoneyCompact(total)}` : ""}
        </p>
        <div className="flex rounded-lg bg-[var(--cy-gray)] p-0.5">
          {(
            [
              ["d30", "30 Days"],
              ["d90", "90 Days"],
              ["m12", "12 Months"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setRange(id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                range === id ? "bg-white text-[var(--cy-navy)] shadow-sm" : "text-[var(--muted-foreground)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-40 w-full" role="img" aria-label="Collected revenue trend">
        <path d={area} fill="var(--cy-orange)" opacity="0.16" />
        <path d={line} fill="none" stroke="var(--cy-navy)" strokeWidth="2.5" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-[var(--muted-foreground)]">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}
