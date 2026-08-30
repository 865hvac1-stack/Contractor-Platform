"use client";

import { useMemo, useState, useTransition } from "react";
import { nanoid } from "nanoid";
import { savePlaybookDefinitionAction, updatePlaybookMetaAction } from "@/server/actions/playbooks";
import type {
  PlaybookChecklistItemDef,
  PlaybookDefinition,
  PlaybookStepDef,
} from "@/lib/playbooks/types";
import { PHASE_LABELS } from "@/lib/playbooks/types";
import { MERGE_FIELD_HELP, PREVIEW_SAMPLE, renderMergeFields } from "@/lib/playbooks/merge-fields";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PlaybookBuilder({
  playbookId,
  name,
  description,
  status,
  definition: initial,
  canManage,
  metricsLabel,
}: {
  playbookId: string;
  name: string;
  description: string;
  status: string;
  definition: PlaybookDefinition;
  canManage: boolean;
  metricsLabel?: string;
}) {
  const [definition, setDefinition] = useState(initial);
  const [editingStep, setEditingStep] = useState<{ phase: number; step: number } | null>(null);
  const [previewMode, setPreviewMode] = useState<"sms" | "desktop">("sms");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const editing = useMemo(() => {
    if (!editingStep) return null;
    return definition.phases[editingStep.phase]?.steps[editingStep.step] ?? null;
  }, [definition, editingStep]);

  function updateStep(patch: Partial<PlaybookStepDef>) {
    if (!editingStep) return;
    setDefinition((current) => ({
      ...current,
      phases: current.phases.map((phase, pi) =>
        pi !== editingStep.phase
          ? phase
          : {
              ...phase,
              steps: phase.steps.map((step, si) =>
                si !== editingStep.step ? step : { ...step, ...patch }
              ),
            }
      ),
    }));
  }

  function toggleStep(phaseIndex: number, stepIndex: number, field: "enabled" | "required") {
    setDefinition((current) => ({
      ...current,
      phases: current.phases.map((phase, pi) =>
        pi !== phaseIndex
          ? phase
          : {
              ...phase,
              steps: phase.steps.map((step, si) =>
                si !== stepIndex ? step : { ...step, [field]: !step[field] }
              ),
            }
      ),
    }));
  }

  function moveStep(phaseIndex: number, stepIndex: number, direction: -1 | 1) {
    setDefinition((current) => {
      const steps = [...current.phases[phaseIndex].steps];
      const next = stepIndex + direction;
      if (next < 0 || next >= steps.length) return current;
      const swap = steps[stepIndex];
      steps[stepIndex] = steps[next];
      steps[next] = swap;
      return {
        ...current,
        phases: current.phases.map((phase, pi) =>
          pi === phaseIndex ? { ...phase, steps } : phase
        ),
      };
    });
  }

  function addStep(phaseIndex: number) {
    const created: PlaybookStepDef = {
      id: nanoid(10),
      kind: "ACTION",
      title: "New step",
      when: "When this happens",
      enabled: true,
      required: false,
      audience: "ALL",
    };
    setDefinition((current) => ({
      ...current,
      phases: current.phases.map((phase, pi) =>
        pi === phaseIndex ? { ...phase, steps: [...phase.steps, created] } : phase
      ),
    }));
    setEditingStep({ phase: phaseIndex, step: definition.phases[phaseIndex].steps.length });
  }

  function addStage(phaseIndex: number) {
    setDefinition((current) => ({
      ...current,
      phases: current.phases.map((phase, pi) =>
        pi === phaseIndex
          ? {
              ...phase,
              stages: [...phase.stages, { key: nanoid(8), name: "New stage" }],
            }
          : phase
      ),
    }));
  }

  function renameStage(phaseIndex: number, stageIndex: number, nameValue: string) {
    setDefinition((current) => ({
      ...current,
      phases: current.phases.map((phase, pi) =>
        pi !== phaseIndex
          ? phase
          : {
              ...phase,
              stages: phase.stages.map((stage, si) =>
                si === stageIndex ? { ...stage, name: nameValue } : stage
              ),
            }
      ),
    }));
  }

  function save() {
    setMessage(null);
    const data = new FormData();
    data.set("playbookId", playbookId);
    data.set("definition", JSON.stringify(definition));
    startTransition(async () => {
      const result = await savePlaybookDefinitionAction(null, data);
      setMessage(result.ok ? "Saved. Older jobs keep the version they started with." : result.error);
    });
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <ActionForm
          className="grid gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 sm:grid-cols-[1fr_1fr_auto]"
          action={updatePlaybookMetaAction}
          successMessage="Name saved."
        >
          <input type="hidden" name="playbookId" value={playbookId} />
          <input type="hidden" name="status" value={status} />
          <div className="space-y-1">
            <Label htmlFor="name">Playbook name</Label>
            <Input id="name" name="name" defaultValue={name} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">What it is for</Label>
            <Input id="description" name="description" defaultValue={description} />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="outline">
              Save name
            </Button>
          </div>
        </ActionForm>
      ) : null}

      {metricsLabel ? (
        <p className="text-sm text-[var(--muted-foreground)]">{metricsLabel}</p>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          No jobs have used this playbook yet. Numbers appear here from real completed work only.
        </p>
      )}

      {definition.phases.map((phase, phaseIndex) => (
        <section key={phase.key} className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            {PHASE_LABELS[phase.key]}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {phase.stages.map((stage, stageIndex) =>
              canManage ? (
                <Input
                  key={stage.key}
                  value={stage.name}
                  onChange={(e) => renameStage(phaseIndex, stageIndex, e.target.value)}
                  className="h-8 w-auto min-w-[8rem] text-sm"
                  aria-label="Stage name"
                />
              ) : (
                <span
                  key={stage.key}
                  className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 text-xs text-[var(--cy-navy)]"
                >
                  {stage.name}
                </span>
              )
            )}
            {canManage ? (
              <Button type="button" size="sm" variant="outline" onClick={() => addStage(phaseIndex)}>
                Add stage
              </Button>
            ) : null}
          </div>
          <ul className="mt-4 space-y-3">
            {phase.steps.length === 0 ? (
              <li className="text-sm text-[var(--muted-foreground)]">Nothing in this part yet.</li>
            ) : (
              phase.steps.map((step, stepIndex) => (
                <li key={step.id} className="rounded-xl border border-[var(--border)] px-3 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs text-[var(--cy-text-muted)]">{step.when}</p>
                      <p className="font-medium text-[var(--cy-navy)]">{step.title}</p>
                      {step.message ? (
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--muted-foreground)]">
                          {step.message.channel === "SMS" ? "Text" : "Email"}: {step.message.body}
                        </p>
                      ) : null}
                      {step.checklist ? (
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {step.checklist.sections.reduce((n, s) => n + s.items.length, 0)} checklist
                          items
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={step.enabled}
                          disabled={!canManage}
                          onChange={() => toggleStep(phaseIndex, stepIndex, "enabled")}
                        />
                        On
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={step.required}
                          disabled={!canManage}
                          onChange={() => toggleStep(phaseIndex, stepIndex, "required")}
                        />
                        Required
                      </label>
                      {canManage ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => moveStep(phaseIndex, stepIndex, -1)}
                          >
                            Up
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => moveStep(phaseIndex, stepIndex, 1)}
                          >
                            Down
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingStep({ phase: phaseIndex, step: stepIndex })}
                          >
                            Edit
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
          {canManage ? (
            <Button type="button" variant="outline" className="mt-3" onClick={() => addStep(phaseIndex)}>
              Add a when / do this step
            </Button>
          ) : null}
        </section>
      ))}

      {definition.forms && definition.forms.length > 0 ? (
        <section className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Custom forms
          </h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            These names are saved with the playbook. A full form builder comes next — checklists
            are ready to use now.
          </p>
          <ul className="mt-2 text-sm text-[var(--cy-navy)]">
            {definition.forms.map((form) => (
              <li key={form.id}>{form.name}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          Custom inspection forms will live here later. Use checklists for today&apos;s required
          work.
        </p>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={pending}>
            Save playbook
          </Button>
          <p className="text-sm text-[var(--muted-foreground)]">
            Saving creates a new version. Jobs already in progress keep the old one.
          </p>
        </div>
      ) : null}
      {message ? <p className="text-sm text-[var(--cy-navy)]">{message}</p> : null}

      {editing && editingStep ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
              When this happens · do this
            </p>
            <h3 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">Edit step</h3>
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <Label>When</Label>
                <Input value={editing.when} onChange={(e) => updateStep({ when: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Do this</Label>
                <Input value={editing.title} onChange={(e) => updateStep({ title: e.target.value })} />
              </div>
              {editing.kind === "PHOTO" ? (
                <div className="space-y-1">
                  <Label>Minimum photos</Label>
                  <Input
                    type="number"
                    min={1}
                    value={editing.photo?.minCount ?? 1}
                    onChange={(e) =>
                      updateStep({
                        photo: { minCount: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                  />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label>Send a message? (optional)</Label>
                <select
                  className="h-10 w-full rounded-lg border px-2 text-sm"
                  value={editing.message?.channel ?? ""}
                  onChange={(e) => {
                    const channel = e.target.value;
                    if (!channel) {
                      updateStep({ message: undefined });
                      return;
                    }
                    updateStep({
                      message: {
                        channel: channel as "SMS" | "EMAIL",
                        body: editing.message?.body ?? "",
                      },
                    });
                  }}
                >
                  <option value="">No message</option>
                  <option value="SMS">Text message</option>
                  <option value="EMAIL">Email</option>
                </select>
              </div>
              {editing.message ? (
                <>
                  <div className="space-y-1">
                    <Label>Message</Label>
                    <Textarea
                      rows={6}
                      value={editing.message.body}
                      onChange={(e) =>
                        updateStep({
                          message: {
                            channel: editing.message?.channel ?? "SMS",
                            body: e.target.value,
                          },
                        })
                      }
                    />
                    <p className="text-[11px] text-[var(--cy-text-muted)]">
                      Insert: {MERGE_FIELD_HELP.slice(0, 6).join(" ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={previewMode === "sms" ? "default" : "outline"}
                      onClick={() => setPreviewMode("sms")}
                    >
                      Phone preview
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={previewMode === "desktop" ? "default" : "outline"}
                      onClick={() => setPreviewMode("desktop")}
                    >
                      Desktop preview
                    </Button>
                  </div>
                  <div
                    className={
                      previewMode === "sms"
                        ? "mx-auto w-[280px] rounded-[28px] border-4 border-[var(--cy-navy)] bg-[var(--cy-gray)] p-4"
                        : "rounded-xl border border-[var(--border)] bg-[var(--cy-gray)] p-4"
                    }
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--cy-orange)]">
                      Preview data — not a real customer
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--cy-navy)]">
                      {renderMergeFields(editing.message.body, PREVIEW_SAMPLE)}
                    </p>
                  </div>
                  <p className="text-xs text-[var(--cy-text-muted)]">
                    Texts and emails send only after a phone or email provider is connected. Preview
                    never sends.
                  </p>
                </>
              ) : null}

              {editing.checklist ? (
                <ChecklistEditor
                  sections={editing.checklist.sections}
                  onChange={(sections) => updateStep({ checklist: { sections } })}
                />
              ) : canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    updateStep({
                      kind: "CHECKLIST",
                      checklist: {
                        sections: [{ name: "Checklist", items: [] }],
                      },
                    })
                  }
                >
                  Add a checklist
                </Button>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingStep(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChecklistEditor({
  sections,
  onChange,
}: {
  sections: { name: string; items: PlaybookChecklistItemDef[] }[];
  onChange: (sections: { name: string; items: PlaybookChecklistItemDef[] }[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-[var(--cy-gray)] p-3">
      <p className="text-sm font-semibold text-[var(--cy-navy)]">Checklist</p>
      {sections.map((section, sectionIndex) => (
        <div key={`${section.name}-${sectionIndex}`} className="space-y-2">
          <Input
            value={section.name}
            onChange={(e) =>
              onChange(
                sections.map((row, i) => (i === sectionIndex ? { ...row, name: e.target.value } : row))
              )
            }
          />
          {section.items.map((item, itemIndex) => (
            <div key={item.id} className="flex items-center gap-2">
              <Input
                value={item.label}
                onChange={(e) =>
                  onChange(
                    sections.map((row, i) =>
                      i !== sectionIndex
                        ? row
                        : {
                            ...row,
                            items: row.items.map((it, ii) =>
                              ii === itemIndex ? { ...it, label: e.target.value } : it
                            ),
                          }
                    )
                  )
                }
              />
              <label className="flex shrink-0 items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={item.required}
                  onChange={() =>
                    onChange(
                      sections.map((row, i) =>
                        i !== sectionIndex
                          ? row
                          : {
                              ...row,
                              items: row.items.map((it, ii) =>
                                ii === itemIndex ? { ...it, required: !it.required } : it
                              ),
                            }
                      )
                    )
                  }
                />
                Required
              </label>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange(
                sections.map((row, i) =>
                  i === sectionIndex
                    ? {
                        ...row,
                        items: [
                          ...row.items,
                          { id: nanoid(10), label: "New item", required: false, fieldType: "CHECKBOX" },
                        ],
                      }
                    : row
                )
              )
            }
          >
            Add item
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...sections, { name: "New section", items: [] }])}
      >
        Add section
      </Button>
    </div>
  );
}
