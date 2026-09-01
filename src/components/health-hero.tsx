import type { HealthScore } from "@/lib/health-score";

export function HealthHero({ health }: { health: HealthScore }) {
  const scored = health.components.filter((row) => row.score != null);
  return (
    <section className="overflow-hidden rounded-3xl bg-[var(--cy-navy)] px-5 py-5 text-white md:px-7 md:py-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-5">
          <div
            className="flex size-24 shrink-0 flex-col items-center justify-center rounded-full border-4 border-[var(--cy-orange)] bg-white/5 md:size-28"
            aria-label={health.score == null ? "Business health not enough data" : `Business health ${health.score}`}
          >
            <p className="text-4xl font-semibold tabular-nums md:text-5xl">{health.score ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">Business Health</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{health.label ?? "Not enough data"}</h2>
            <p className="mt-1 max-w-md text-sm text-white/65">
              {health.score == null
                ? "Scores appear once ContractorYou has enough verified records in a component."
                : `Average of ${scored.length} supported component${scored.length === 1 ? "" : "s"}. Missing data is excluded, not invented.`}
            </p>
          </div>
        </div>
        <details className="min-w-0 flex-1 lg:max-w-md">
          <summary className="cursor-pointer text-sm font-medium text-[var(--cy-orange)]">
            {health.score == null ? "Why no score?" : `Why ${health.score}?`}
          </summary>
          <ul className="mt-3 space-y-2">
            {health.components.map((component) => (
              <li key={component.id} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">{component.label}</span>
                  <span className="block text-xs text-white/55">{component.reason}</span>
                </span>
                <span className="tabular-nums text-white/80">{component.score ?? "—"}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {health.components.map((component) => (
          <div key={component.id} className="rounded-xl bg-white/6 px-3 py-2">
            <dt className="text-[11px] text-white/50">{component.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {component.score ?? <span className="text-sm font-medium text-white/45">Not enough data</span>}
            </dd>
            {component.score != null ? (
              <div className="mt-1 h-1 rounded-full bg-white/10">
                <div className="h-1 rounded-full bg-[var(--cy-orange)]" style={{ width: `${component.score}%` }} />
              </div>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
