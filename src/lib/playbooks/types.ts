import type { JobStatus } from "@prisma/client";

export type PlaybookPhaseKey =
  | "BEFORE_JOB"
  | "ON_THE_WAY"
  | "AT_THE_JOB"
  | "BEFORE_COMPLETE"
  | "AFTER_JOB";

export type PlaybookStepKind =
  | "MESSAGE"
  | "REQUIREMENT"
  | "CHECKLIST"
  | "PHOTO"
  | "ACTION"
  | "FOLLOW_UP";

export type PlaybookAudience = "ALL" | "TECHNICIAN" | "OFFICE" | "SALES" | "INSTALLER";

export type ChecklistFieldType =
  | "CHECKBOX"
  | "TEXT"
  | "NUMBER"
  | "MEASUREMENT"
  | "PASS_FAIL"
  | "DROPDOWN"
  | "PHOTO"
  | "SIGNATURE";

export type PlaybookStageDef = {
  key: string;
  name: string;
};

export type PlaybookChecklistItemDef = {
  id: string;
  label: string;
  required: boolean;
  fieldType: ChecklistFieldType;
};

export type PlaybookStepDef = {
  id: string;
  kind: PlaybookStepKind;
  title: string;
  when: string;
  enabled: boolean;
  required: boolean;
  audience: PlaybookAudience;
  mapsToJobStatus?: JobStatus | null;
  actionKey?: string;
  message?: {
    channel: "SMS" | "EMAIL";
    body: string;
  };
  checklist?: {
    sections: { name: string; items: PlaybookChecklistItemDef[] }[];
  };
  photo?: { minCount: number; label?: string };
  waitMinutes?: number;
};

export type PlaybookPhaseDef = {
  key: PlaybookPhaseKey;
  name: string;
  stages: PlaybookStageDef[];
  steps: PlaybookStepDef[];
};

export type PlaybookFormFieldDef = {
  id: string;
  label: string;
  fieldType: ChecklistFieldType;
  required: boolean;
};

export type PlaybookFormDef = {
  id: string;
  name: string;
  description?: string;
  fields: PlaybookFormFieldDef[];
};

export type PlaybookDefinition = {
  phases: PlaybookPhaseDef[];
  forms?: PlaybookFormDef[];
};

export const PHASE_LABELS: Record<PlaybookPhaseKey, string> = {
  BEFORE_JOB: "Before the job",
  ON_THE_WAY: "On the way",
  AT_THE_JOB: "At the job",
  BEFORE_COMPLETE: "Before completing job",
  AFTER_JOB: "After job",
};

export const EMPTY_DEFINITION: PlaybookDefinition = {
  phases: [
    { key: "BEFORE_JOB", name: "Before the job", stages: [], steps: [] },
    { key: "ON_THE_WAY", name: "On the way", stages: [], steps: [] },
    { key: "AT_THE_JOB", name: "At the job", stages: [], steps: [] },
    { key: "BEFORE_COMPLETE", name: "Before completing job", stages: [], steps: [] },
    { key: "AFTER_JOB", name: "After job", stages: [], steps: [] },
  ],
};

export function isPlaybookDefinition(value: unknown): value is PlaybookDefinition {
  if (!value || typeof value !== "object") return false;
  const phases = (value as { phases?: unknown }).phases;
  return Array.isArray(phases);
}

export function flattenSteps(definition: PlaybookDefinition): PlaybookStepDef[] {
  return definition.phases.flatMap((phase) => phase.steps);
}

export function flattenStages(definition: PlaybookDefinition): PlaybookStageDef[] {
  return definition.phases.flatMap((phase) => phase.stages);
}
