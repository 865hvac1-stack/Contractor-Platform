import { formatDateTime } from "@/lib/datetime";

type ReviewRow = {
  id: string;
  customerMessage: string | null;
  actualResponse: string | null;
  proposedResponse: string | null;
  intent: string;
  schedulingState: string | null;
  requestedAction: string | null;
  confidence: number | null;
  toolUsed: string | null;
  verifiedFacts: unknown;
  extractedFields: unknown;
  shadow: boolean;
  outboundSent: boolean;
  handoffReason: string | null;
  createdAt: Date;
};

function factSummary(value: unknown) {
  if (!value || typeof value !== "object") return "None";
  const row = value as Record<string, unknown>;
  const parts = [
    row.schedulingPhase ? `state ${String(row.schedulingPhase)}` : null,
    Array.isArray(row.offeredSlots) && row.offeredSlots.length ? `${row.offeredSlots.length} verified slots` : null,
    row.invoiceBalance ? "verified balance" : null,
    row.jobStatus ? "verified job" : null,
    row.membershipStatus ? "verified membership" : null,
    row.waitingStatus ? "verified waiting" : null,
    Array.isArray(row.knowledgeAnswers) && row.knowledgeAnswers.length ? "verified knowledge" : null,
    row.toolError ? String(row.toolError) : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Identity / workflow only";
}

export function ReceptionistV2Review({
  rows,
  usage,
  timezone,
}: {
  rows: ReviewRow[];
  usage: {
    turnsThisMonth: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicrousd: number;
  };
  timezone?: string | null;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
      <div>
        <h2 className="font-medium">ContractorYou AI shadow review</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Compare what ContractorYou would have said against the production reply. Shadow turns never
          send SMS and never book, cancel, or hand off.
        </p>
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          This month: {usage.turnsThisMonth} AI turns · {usage.inputTokens + usage.outputTokens} tokens · $
          {(usage.estimatedCostMicrousd / 1_000_000).toFixed(4)} estimated
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No shadow turns yet. Set mode to ContractorYou shadow, leave HighLevel Regina as the
          conversation owner, then send a test SMS.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-[var(--border)] p-3 text-sm">
              <p className="text-xs text-[var(--muted-foreground)]">
                {formatDateTime(row.createdAt, timezone)} · {row.intent}
                {row.confidence != null ? ` · ${(row.confidence * 100).toFixed(0)}%` : ""} ·{" "}
                {row.shadow ? "shadow" : "live"}
                {row.outboundSent ? " · sent" : " · not sent"}
              </p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">Customer</dt>
                  <dd>{row.customerMessage || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">Production reply</dt>
                  <dd>{row.actualResponse || "Waiting for Regina / office outbound"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">ContractorYou proposed</dt>
                  <dd>{row.proposedResponse || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">State / action / tools</dt>
                  <dd>
                    {row.schedulingState || "no workflow"} · {row.requestedAction || "none"}
                    {row.toolUsed ? ` · ${row.toolUsed}` : ""}
                    {row.handoffReason ? ` · handoff ${row.handoffReason}` : ""}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">Verified: {factSummary(row.verifiedFacts)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
