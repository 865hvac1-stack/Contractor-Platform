"use client";

/**
 * UI foundation only. Submission is disabled until a real assistant exists.
 */
export function AskContractorYou() {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--cy-navy)] p-5 text-white md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Ask ContractorYou
          </p>
          <p className="mt-1 text-sm text-white/65">
            A business assistant for follow-up, money, and jobs.
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
        Future questions: Why was revenue down this week? Which estimates need follow-up? Who
        owes us money?
      </p>
    </section>
  );
}
