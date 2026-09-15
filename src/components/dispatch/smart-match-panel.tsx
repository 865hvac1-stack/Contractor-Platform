"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SmartDispatchCandidate, SmartDispatchMatch } from "@/lib/smart-dispatch/recommend";

export function SmartMatchPanel({
  jobId,
  canAssign,
  onAssign,
}: {
  jobId: string;
  canAssign: boolean;
  onAssign: (technicianId: string, recommendedTechnicianId: string | null) => void;
}) {
  const [match, setMatch] = useState<SmartDispatchMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setMatch(null);
    setError(null);
    fetch(`/api/dispatch/smart-match/${jobId}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load Smart Dispatch.");
        setMatch(body);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name !== "AbortError") setError(loadError.message);
      });
    return () => controller.abort();
  }, [jobId]);

  if (error) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Smart Dispatch unavailable. Manual assignment still works. {error}
      </section>
    );
  }
  if (!match) {
    return <p className="text-sm text-[var(--muted-foreground)]">Calculating Smart Match…</p>;
  }

  return (
    <section className="space-y-3 rounded-2xl bg-[var(--cy-navy)] p-4 text-white">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Smart Dispatch</p>
        {match.routingStatus === "ROUTING_TEMPORARILY_UNAVAILABLE" ? (
          <p className="mt-1 text-xs text-white/70">Routing temporarily unavailable. Ranking uses qualifications, skills, and schedule.</p>
        ) : null}
      </div>
      {match.best ? <CandidateCard candidate={match.best} recommended onAssign={canAssign ? () => onAssign(match.best!.technicianId, match.best!.technicianId) : undefined} onWhy={() => setWhy(match.best!.technicianId)} /> : (
        <p className="text-sm text-white/80">No eligible technician for this job yet. Assign manually if the work must still go out.</p>
      )}
      {match.candidates.slice(1, 4).map((candidate) => (
        <CandidateCard
          key={candidate.technicianId}
          candidate={candidate}
          onAssign={canAssign ? () => onAssign(candidate.technicianId, match.best?.technicianId ?? null) : undefined}
          onWhy={() => setWhy(candidate.technicianId)}
        />
      ))}
      {match.ineligible.slice(0, 3).map((candidate) => (
        <div key={candidate.technicianId} className="rounded-xl bg-white/8 px-3 py-2 text-sm">
          <p className="font-medium">{candidate.name}</p>
          <p className="text-white/70">{candidate.blockers[0]?.label || "Not eligible"}</p>
        </div>
      ))}
      {why ? <WhyList candidate={[...match.candidates, ...match.ineligible].find((row) => row.technicianId === why) ?? null} /> : null}
    </section>
  );
}

function CandidateCard({
  candidate,
  recommended,
  onAssign,
  onWhy,
}: {
  candidate: SmartDispatchCandidate;
  recommended?: boolean;
  onAssign?: () => void;
  onWhy: () => void;
}) {
  return (
    <div className="rounded-xl bg-white/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{candidate.name}</p>
          <p className="text-sm text-white/80">
            {recommended ? "Best match" : "Candidate"}
            {candidate.score ? ` · ${candidate.score.display}` : ""}
            {candidate.limitedMatchData ? " · Limited performance history" : ""}
            {candidate.profileNeedsSetup ? " · Profile needs setup" : ""}
          </p>
          {candidate.driveLabel ? <p className="text-xs text-white/70">{candidate.driveLabel}</p> : null}
        </div>
        {onAssign ? (
          <Button type="button" size="sm" onClick={onAssign}>
            Assign
          </Button>
        ) : null}
      </div>
      <button type="button" className="mt-2 text-xs font-semibold text-[var(--cy-orange)]" onClick={onWhy}>
        See why
      </button>
    </div>
  );
}

function WhyList({ candidate }: { candidate: SmartDispatchCandidate | null }) {
  if (!candidate) return null;
  return (
    <div className="rounded-xl bg-black/20 p-3 text-sm">
      <p className="font-semibold">Why {candidate.name}?</p>
      <ul className="mt-2 space-y-1">
        {candidate.reasons.map((reason) => (
          <li key={`${reason.code}-${reason.label}`}>
            {reason.kind === "BLOCKER" ? "✕" : reason.kind === "WARNING" ? "!" : "✓"} {reason.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
