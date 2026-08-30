import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { openaiConfigured, INTELLIGENCE_MODELS } from "@/lib/intelligence/config";

export default async function PlatformIntelligencePage() {
  await requirePlatformAdmin();
  const [usage, errors] = await Promise.all([
    prisma.aIUsageEvent.aggregate({
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, latencyMs: true },
    }),
    prisma.aIUsageEvent.findMany({
      where: { status: "ERROR" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, errorKind: true, createdAt: true, feature: true, model: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform" className="text-sm text-[var(--muted-foreground)]">
          ← Companies
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Intelligence health</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Provider presence and usage only. Keys and other companies&apos; records are never shown.
        </p>
      </div>
      <section className="rounded-2xl border bg-white p-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted-foreground)]">Provider</dt>
            <dd>OpenAI · {openaiConfigured() ? "Configured" : "Missing OPENAI_API_KEY"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Model</dt>
            <dd>{INTELLIGENCE_MODELS.default}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Requests</dt>
            <dd>{usage._count}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Tokens in / out</dt>
            <dd>
              {usage._sum.inputTokens ?? 0} / {usage._sum.outputTokens ?? 0}
            </dd>
          </div>
        </dl>
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-medium">Recent errors</h2>
        {errors.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">No recorded provider errors.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {errors.map((row) => (
              <li key={row.id}>
                {row.createdAt.toLocaleString()} · {row.feature} · {row.errorKind}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
