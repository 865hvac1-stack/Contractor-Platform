"use client";

/**
 * UI foundation only. Submission is disabled until the intelligence backend answers
 * from tenant-scoped, verified metrics.
 */
const EXAMPLE_QUESTIONS = [
  "What should I focus on today?",
  "What changed this week?",
  "Why are sales down?",
  "Which marketing source is performing best?",
  "Which marketing source actually produces the most profit?",
  "How many LSA leads turned into jobs?",
  "What is my Facebook ROI?",
  "Which estimates should we follow up with?",
  "Who owes us money?",
  "Which job types are most profitable?",
  "Which technician has the best average ticket?",
  "Where are we losing leads?",
  "What is trending upward?",
  "What should we stop spending money on?",
];

export function AskContractorYou() {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--cy-navy)] p-5 text-white md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Ask ContractorYou
          </p>
          <p className="mt-1 text-sm text-white/65">
            A business intelligence layer over this company&apos;s data — not a generic chatbot.
          </p>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
          Coming soon
        </span>
      </div>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label htmlFor="ask-cy" className="sr-only">
          Ask ContractorYou
        </label>
        <input
          id="ask-cy"
          disabled
          placeholder="Ask what's happening in your business..."
          className="h-12 w-full rounded-xl border border-white/10 bg-white/8 px-4 text-sm text-white placeholder:text-white/35 disabled:cursor-not-allowed"
        />
      </form>
      <p className="mt-3 text-xs text-white/40">
        Answers stay off until retrieval is company-scoped and numbers are reproducible. We will
        not invent LSA, Meta, or profit figures.
      </p>
      <ul className="mt-4 grid gap-2 text-xs text-white/55 sm:grid-cols-2">
        {EXAMPLE_QUESTIONS.slice(0, 6).map((question) => (
          <li key={question}>“{question}”</li>
        ))}
      </ul>
    </section>
  );
}
