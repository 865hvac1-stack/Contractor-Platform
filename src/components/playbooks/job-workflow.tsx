import Link from "next/link";
import {
  flattenSteps,
  type PlaybookDefinition,
  type PlaybookStepDef,
} from "@/lib/playbooks/types";
import { nextTechnicianAction, stagesForGuide, type RemainingItem } from "@/lib/playbooks/engine";
import { PREVIEW_SAMPLE, renderMergeFields } from "@/lib/playbooks/merge-fields";
import {
  advancePlaybookStepAction,
  toggleJobChecklistItemAction,
} from "@/server/actions/playbooks";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CompleteJobButton } from "@/components/playbooks/complete-job-button";

type ChecklistRow = { itemId: string; completed: boolean };

export function JobWorkflowPanel({
  jobId,
  playbookName,
  customerName,
  scheduledLabel,
  definition,
  currentStageKey,
  completedStepIds,
  remaining,
  checklist,
  customerPhone,
  propertyAddress,
  canAct,
}: {
  jobId: string;
  playbookName: string;
  customerName: string;
  scheduledLabel: string;
  definition: PlaybookDefinition;
  currentStageKey: string | null;
  completedStepIds: string[];
  remaining: RemainingItem[];
  checklist: ChecklistRow[];
  customerPhone: string | null;
  propertyAddress: string;
  canAct: boolean;
}) {
  const done = new Set(completedStepIds);
  const next = nextTechnicianAction(definition, done);
  const stages = stagesForGuide(definition, currentStageKey);
  const mapsHref = `https://maps.google.com/?q=${encodeURIComponent(propertyAddress)}`;

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Today&apos;s workflow
        </p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">{customerName}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {playbookName}
          {scheduledLabel ? ` · ${scheduledLabel}` : ""}
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">{propertyAddress}</p>
      </div>

      {next ? (
        <div className="rounded-2xl bg-[var(--cy-navy)] p-4 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Next step
          </p>
          <p className="mt-1 text-2xl font-semibold">{next.title}</p>
          <p className="mt-1 text-sm text-white/65">{next.when}</p>
          {next.message ? (
            <p className="mt-3 rounded-xl bg-white/8 p-3 text-sm text-white/80">
              Would send {next.message.channel === "SMS" ? "a text" : "an email"} when
              communications are connected:
              <span className="mt-1 block whitespace-pre-wrap text-white">
                {renderMergeFields(next.message.body, PREVIEW_SAMPLE)}
              </span>
              <span className="mt-1 block text-[11px] text-white/45">
                Sample names shown here. This preview never sends a message.
              </span>
            </p>
          ) : null}
          {canAct ? (
            <ActionForm action={advancePlaybookStepAction} className="mt-4">
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="stepId" value={next.id} />
              <Button type="submit" className="h-12 w-full text-base">
                {next.title}
              </Button>
            </ActionForm>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No technician tap is waiting.</p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {customerPhone ? (
          <a
            href={`tel:${customerPhone}`}
            className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--cy-gray)] px-3 py-3 text-center text-sm font-semibold text-[var(--cy-navy)]"
          >
            Call
          </a>
        ) : (
          <span className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--cy-gray)] px-3 py-3 text-center text-sm text-[var(--cy-text-muted)]">
            No phone
          </span>
        )}
        {customerPhone ? (
          <a
            href={`sms:${customerPhone}`}
            className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--cy-gray)] px-3 py-3 text-center text-sm font-semibold text-[var(--cy-navy)]"
          >
            Message
          </a>
        ) : (
          <span className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--cy-gray)] px-3 py-3 text-center text-sm text-[var(--cy-text-muted)]">
            No SMS
          </span>
        )}
        <a
          href={mapsHref}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--cy-gray)] px-3 py-3 text-center text-sm font-semibold text-[var(--cy-navy)]"
        >
          Directions
        </a>
        <Link
          href={`/estimates/new?jobId=${jobId}`}
          className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--cy-gray)] px-3 py-3 text-center text-sm font-semibold text-[var(--cy-navy)]"
        >
          Estimate
        </Link>
      </div>

      {stages.length > 0 ? (
        <ol className="space-y-1.5">
          {stages.map((stage) => (
            <li key={stage.key} className="flex items-center gap-2 text-sm">
              <span
                className={
                  stage.state === "done"
                    ? "text-emerald-600"
                    : stage.state === "current"
                      ? "text-[var(--cy-orange)]"
                      : "text-[var(--cy-text-muted)]"
                }
              >
                {stage.state === "done" ? "✓" : stage.state === "current" ? "○" : "·"}
              </span>
              <span className={stage.state === "current" ? "font-semibold text-[var(--cy-navy)]" : ""}>
                {stage.name}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {remaining.length > 0 ? (
        <div className="rounded-xl border border-[var(--cy-orange)]/30 bg-[var(--cy-orange-muted)] p-3">
          <p className="text-sm font-semibold text-[var(--cy-navy)]">
            {remaining.length} item{remaining.length === 1 ? "" : "s"} remaining
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-[#9A3412]">
            {remaining.map((item) => (
              <li key={item.stepId}>
                {item.title} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <WorkflowExtras
        jobId={jobId}
        steps={flattenSteps(definition)}
        done={done}
        checklist={checklist}
        canAct={canAct}
      />

      {canAct ? <CompleteJobButton jobId={jobId} remainingCount={remaining.length} /> : null}
    </section>
  );
}

function WorkflowExtras({
  jobId,
  steps,
  done,
  checklist,
  canAct,
}: {
  jobId: string;
  steps: PlaybookStepDef[];
  done: Set<string>;
  checklist: ChecklistRow[];
  canAct: boolean;
}) {
  const noteSteps = steps.filter(
    (s) =>
      s.enabled &&
      (s.actionKey === "DIAGNOSIS" ||
        s.actionKey === "RECOMMENDATION" ||
        s.actionKey === "SIGNATURE" ||
        s.kind === "PHOTO")
  );
  const checklists = steps.filter((s) => s.enabled && s.kind === "CHECKLIST" && s.checklist);

  return (
    <div className="space-y-4">
      {checklists.map((step) => (
        <div key={step.id}>
          <p className="text-sm font-semibold text-[var(--cy-navy)]">{step.title}</p>
          {step.checklist!.sections.map((section) => (
            <div key={section.name} className="mt-2">
              <p className="text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
                {section.name}
              </p>
              <ul className="mt-1 space-y-1">
                {section.items.map((item) => {
                  const row = checklist.find((c) => c.itemId === item.id);
                  return (
                    <li key={item.id}>
                      {canAct ? (
                        <ActionForm action={toggleJobChecklistItemAction}>
                          <input type="hidden" name="jobId" value={jobId} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="section" value={section.name} />
                          <input type="hidden" name="label" value={item.label} />
                          <input type="hidden" name="required" value={String(item.required)} />
                          <input type="hidden" name="fieldType" value={item.fieldType} />
                          <button
                            type="submit"
                            className="flex min-h-11 w-full items-center gap-2 py-2 text-left text-sm"
                          >
                            <span>{row?.completed ? "☑" : "☐"}</span>
                            <span>
                              {item.label}
                              {item.required ? " *" : ""}
                            </span>
                          </button>
                        </ActionForm>
                      ) : (
                        <p className="py-2 text-sm">
                          {row?.completed ? "☑" : "☐"} {item.label}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ))}

      {noteSteps.map((step) =>
        done.has(step.id) ? (
          <p key={step.id} className="text-sm text-emerald-700">
            ✓ {step.title}
          </p>
        ) : canAct ? (
          <ActionForm key={step.id} action={advancePlaybookStepAction} className="space-y-2">
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="stepId" value={step.id} />
            {step.kind === "PHOTO" ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Photo upload comes next. Mark this when the photos are on the job.
              </p>
            ) : (
              <Textarea name="note" rows={2} placeholder={`${step.title} notes`} />
            )}
            <Button type="submit" variant="outline" className="h-11 w-full">
              {step.kind === "PHOTO" ? "Mark photos added" : `Save ${step.title.toLowerCase()}`}
            </Button>
          </ActionForm>
        ) : (
          <p key={step.id} className="text-sm text-[var(--muted-foreground)]">
            {step.title} not done
          </p>
        )
      )}
    </div>
  );
}
