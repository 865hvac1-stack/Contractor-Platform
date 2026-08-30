import type { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  flattenSteps,
  flattenStages,
  isPlaybookDefinition,
  type PlaybookDefinition,
  type PlaybookStepDef,
} from "@/lib/playbooks/types";

export type RemainingItem = {
  stepId: string;
  title: string;
  reason: string;
};

export function parseDefinition(value: Prisma.JsonValue | PlaybookDefinition): PlaybookDefinition {
  if (isPlaybookDefinition(value)) return value;
  throw new Error("Playbook definition is invalid.");
}

export function nextTechnicianAction(definition: PlaybookDefinition, completedStepIds: Set<string>) {
  const steps = flattenSteps(definition).filter(
    (step) =>
      step.enabled &&
      (step.audience === "TECHNICIAN" ||
        step.audience === "INSTALLER" ||
        step.audience === "SALES" ||
        step.audience === "ALL") &&
      (step.kind === "ACTION" || step.actionKey === "ON_MY_WAY" || step.actionKey === "ARRIVED")
  );
  return steps.find((step) => !completedStepIds.has(step.id)) ?? null;
}

export async function getCompletedStepIds(companyId: string, jobId: string) {
  const events = await prisma.jobWorkflowEvent.findMany({
    where: { companyId, jobId },
    select: { stepId: true },
  });
  return new Set(events.map((e) => e.stepId));
}

export async function remainingRequiredItems(input: {
  companyId: string;
  jobId: string;
  definition: PlaybookDefinition;
}): Promise<RemainingItem[]> {
  const { companyId, jobId, definition } = input;
  const completed = await getCompletedStepIds(companyId, jobId);
  const [invoices, estimates, checklist] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, jobId },
      select: { id: true, balanceCents: true, status: true },
    }),
    prisma.estimate.findMany({
      where: { companyId, jobId },
      select: { id: true },
    }),
    prisma.jobChecklistItem.findMany({
      where: { companyId, jobId },
    }),
  ]);

  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: { propertyId: true, description: true },
  });
  const equipmentOnProperty = job
    ? await prisma.equipment.count({
        where: { companyId, propertyId: job.propertyId },
      })
    : 0;

  const remaining: RemainingItem[] = [];

  for (const step of flattenSteps(definition)) {
    if (!step.enabled || !step.required) continue;
    if (completed.has(step.id) && step.kind === "ACTION") continue;

    if (step.kind === "CHECKLIST" && step.checklist) {
      const requiredItems = step.checklist.sections.flatMap((s) => s.items.filter((i) => i.required));
      const incomplete = requiredItems.filter((item) => {
        const row = checklist.find((c) => c.itemId === item.id);
        return !row?.completed;
      });
      if (incomplete.length > 0) {
        remaining.push({
          stepId: step.id,
          title: step.title,
          reason: `${incomplete.length} required checklist item${incomplete.length === 1 ? "" : "s"} left`,
        });
      }
      continue;
    }

    if (step.actionKey === "INVOICE" && invoices.length === 0) {
      remaining.push({ stepId: step.id, title: step.title, reason: "No invoice on this job yet" });
      continue;
    }
    if (step.actionKey === "PAYMENT") {
      const unpaid = invoices.filter((i) => i.balanceCents > 0 && i.status !== "VOID");
      if (invoices.length === 0 || unpaid.length > 0) {
        remaining.push({
          stepId: step.id,
          title: step.title,
          reason: invoices.length === 0 ? "No invoice to collect on" : "Invoice still has a balance",
        });
      }
      continue;
    }
    if (step.actionKey === "ESTIMATE" && estimates.length === 0) {
      remaining.push({ stepId: step.id, title: step.title, reason: "No estimate on this job yet" });
      continue;
    }
    if (step.actionKey === "EQUIPMENT" && equipmentOnProperty === 0) {
      remaining.push({ stepId: step.id, title: step.title, reason: "No equipment recorded on this property" });
      continue;
    }
    if (step.actionKey === "DIAGNOSIS" && !completed.has(step.id)) {
      remaining.push({ stepId: step.id, title: step.title, reason: "Diagnosis not added" });
      continue;
    }
    if (step.actionKey === "RECOMMENDATION" && !completed.has(step.id)) {
      remaining.push({ stepId: step.id, title: step.title, reason: "Recommendation not added" });
      continue;
    }
    if (step.actionKey === "SIGNATURE" && !completed.has(step.id)) {
      remaining.push({ stepId: step.id, title: step.title, reason: "Signature not captured" });
      continue;
    }
    if (step.kind === "PHOTO" && !completed.has(step.id)) {
      remaining.push({
        stepId: step.id,
        title: step.title,
        reason: step.photo?.minCount
          ? `Need at least ${step.photo.minCount} photo${step.photo.minCount === 1 ? "" : "s"}`
          : "Photos not marked added",
      });
      continue;
    }
    if (step.kind === "ACTION" && !completed.has(step.id)) {
      remaining.push({ stepId: step.id, title: step.title, reason: `${step.title} not done yet` });
    }
  }

  return remaining;
}

export function suggestedJobStatus(step: PlaybookStepDef): JobStatus | null {
  return step.mapsToJobStatus ?? null;
}

export function stagesForGuide(definition: PlaybookDefinition, currentStageKey: string | null) {
  const stages = flattenStages(definition);
  const currentIndex = currentStageKey ? stages.findIndex((s) => s.key === currentStageKey) : -1;
  return stages.map((stage, index) => ({
    ...stage,
    state: currentIndex < 0 ? "upcoming" : index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming",
  }));
}
