const STEPS = [
  "What to import",
  "Where it came from",
  "Upload",
  "Review file",
  "Match columns",
  "Preview",
  "Duplicates",
  "Confirm",
  "Results",
];

export function WizardSteps({ current }: { current: number }) {
  return (
    <ol className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-9">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const active = step === current;
        const done = step < current;
        return (
          <li
            key={label}
            className={
              active
                ? "rounded-lg bg-[var(--cy-navy)] px-2 py-2 text-white"
                : done
                  ? "rounded-lg bg-[var(--cy-orange)]/15 px-2 py-2 text-[var(--cy-navy)]"
                  : "rounded-lg bg-[var(--cy-gray)] px-2 py-2 text-[var(--muted-foreground)]"
            }
          >
            <span className="block font-semibold">{step}</span>
            <span className="hidden sm:block">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
