"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import type { FinanceMixSlice, FinanceTrendPoint } from "@/lib/finance/snapshot";

const MIX_COLORS = ["#f87000", "#0b1220", "#5b6573", "#c45c00", "#8b93a0", "#d97706"];

export function RevenueCollectionsChart({ points }: { points: FinanceTrendPoint[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="text-sm text-[var(--cy-text-secondary)]">No revenue or collections in this period.</p>;
  }
  const width = 560;
  const height = 180;
  const pad = { l: 8, r: 8, t: 16, b: 28 };
  const max = Math.max(...points.flatMap((point) => [point.revenueCents, point.collectedCents]), 1);
  const x = (index: number) =>
    pad.l + (points.length === 1 ? (width - pad.l - pad.r) / 2 : (index / (points.length - 1)) * (width - pad.l - pad.r));
  const y = (value: number) => pad.t + (1 - value / max) * (height - pad.t - pad.b);
  const revenueLine = points.map((point, index) => `${x(index)},${y(point.revenueCents)}`).join(" ");
  const collectedLine = points.map((point, index) => `${x(index)},${y(point.collectedCents)}`).join(" ");
  const active = hover != null ? points[hover] : null;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[180px] w-full" role="img" aria-label="Revenue and collections">
        <polyline fill="none" stroke="#0b1220" strokeWidth="2.5" points={revenueLine} />
        <polyline fill="none" stroke="#f87000" strokeWidth="2.5" points={collectedLine} />
        {points.map((point, index) => (
          <g key={point.key}>
            <rect
              x={x(index) - 14}
              y={0}
              width={28}
              height={height}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              onClick={() => router.push(point.href)}
            />
            <circle
              cx={x(index)}
              cy={y(point.revenueCents)}
              r={hover === index ? 5 : 3.5}
              fill="#0b1220"
              className="cursor-pointer"
            />
            <circle
              cx={x(index)}
              cy={y(point.collectedCents)}
              r={hover === index ? 5 : 3.5}
              fill="#f87000"
              className="cursor-pointer"
            />
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--cy-text-secondary)]">
        <span>
          <span className="mr-3 inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-[var(--cy-navy)]" /> Revenue
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-[var(--cy-orange)]" /> Collected
          </span>
        </span>
        {active ? (
          <span>
            {active.label}: {formatMoney(active.revenueCents)} revenue · {formatMoney(active.collectedCents)} collected
          </span>
        ) : (
          <span>Hover or tap a point to open that period.</span>
        )}
      </div>
      {points.length <= 12 ? (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {points.map((point) => (
          <button
            key={point.key}
            type="button"
            onClick={() => router.push(point.href)}
            className="min-h-11 rounded-full px-3 text-xs font-medium text-[var(--cy-navy)] ring-1 ring-[var(--border)] hover:bg-[var(--cy-gray)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cy-navy)]"
          >
            {point.label}
          </button>
        ))}
      </div>
      ) : null}
    </div>
  );
}

export function RevenueMixChart({ slices }: { slices: FinanceMixSlice[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  if (slices.length === 0) {
    return <p className="text-sm text-[var(--cy-text-secondary)]">No paid invoices to group by service type yet.</p>;
  }
  const size = 168;
  const radius = 58;
  const inner = 34;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -Math.PI / 2;
  const total = slices.reduce((sum, slice) => sum + slice.cents, 0) || 1;

  function arc(start: number, end: number, r: number) {
    return `A ${r} ${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)}`;
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto size-40 shrink-0" role="img" aria-label="Revenue mix">
        {slices.map((slice, index) => {
          const sweep = (slice.cents / total) * Math.PI * 2;
          const start = angle;
          const end = angle + Math.max(sweep, 0.02);
          angle = end;
          const path = `M ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} ${arc(start, end, radius)} L ${cx + inner * Math.cos(end)} ${cy + inner * Math.sin(end)} ${arc(end, start, inner)} Z`;
          return (
            <path
              key={slice.key}
              d={path}
              fill={MIX_COLORS[index % MIX_COLORS.length]}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              opacity={hover && hover !== slice.key ? 0.45 : 1}
              onMouseEnter={() => setHover(slice.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => router.push(slice.href)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(slice.href);
                }
              }}
            >
              <title>
                {slice.label}: {slice.percent}% · {formatMoney(slice.cents)}
              </title>
            </path>
          );
        })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((slice, index) => (
          <li key={slice.key}>
            <button
              type="button"
              onClick={() => router.push(slice.href)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1 text-left hover:bg-[var(--cy-gray)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cy-navy)]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: MIX_COLORS[index % MIX_COLORS.length] }} />
                <span className="truncate text-sm text-[var(--cy-navy)]">{slice.label}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-[var(--cy-text-secondary)]">
                {slice.percent}% · {formatMoney(slice.cents)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
