"use client";

type Phase = { id: string; name: string };

export function PhasePicker({
  phases,
  name,
  required = false,
  defaultPhaseId,
}: {
  phases: Phase[];
  name: string;
  required?: boolean;
  defaultPhaseId?: string | null;
}) {
  const selected = defaultPhaseId && phases.some((phase) => phase.id === defaultPhaseId)
    ? defaultPhaseId
    : required
      ? phases[0]?.id
      : "";

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Project phase">
      {!required ? (
        <PhaseChip name={name} value="" label="No phase" defaultChecked={!selected} />
      ) : null}
      {phases.map((phase) => (
        <PhaseChip
          key={phase.id}
          name={name}
          value={phase.id}
          label={phase.name}
          required={required}
          defaultChecked={phase.id === selected}
        />
      ))}
    </div>
  );
}

function PhaseChip({
  name,
  value,
  label,
  required,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  required?: boolean;
  defaultChecked?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        required={required}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="inline-flex rounded-full border bg-white px-3 py-1.5 text-sm peer-checked:border-[var(--cy-orange)] peer-checked:bg-orange-50 peer-checked:font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--cy-orange)]">
        {label}
      </span>
    </label>
  );
}
