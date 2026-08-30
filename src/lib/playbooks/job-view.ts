import { prisma } from "@/lib/db";
import {
  getCompletedStepIds,
  parseDefinition,
  remainingRequiredItems,
} from "@/lib/playbooks/engine";
import type { PlaybookDefinition } from "@/lib/playbooks/types";
import type { RemainingItem } from "@/lib/playbooks/engine";

export type JobWorkflowView = {
  definition: PlaybookDefinition;
  remaining: RemainingItem[];
  completedStepIds: string[];
  checklist: { itemId: string; completed: boolean }[];
  playbookName: string;
  currentStageKey: string | null;
};

export async function loadJobWorkflowView(
  companyId: string,
  jobId: string
): Promise<JobWorkflowView | null> {
  const snapshot = await prisma.jobPlaybookSnapshot.findFirst({
    where: { companyId, jobId },
  });
  if (!snapshot) return null;

  let definition: PlaybookDefinition;
  try {
    definition = parseDefinition(snapshot.definition);
  } catch {
    return null;
  }

  const [completed, remaining, checklist, playbook] = await Promise.all([
    getCompletedStepIds(companyId, jobId),
    remainingRequiredItems({ companyId, jobId, definition }),
    prisma.jobChecklistItem.findMany({ where: { companyId, jobId } }),
    prisma.playbook.findFirst({
      where: { id: snapshot.playbookId, companyId },
      select: { name: true },
    }),
  ]);

  return {
    definition,
    remaining,
    completedStepIds: [...completed],
    checklist: checklist.map((row) => ({ itemId: row.itemId, completed: row.completed })),
    playbookName: playbook?.name ?? "Playbook",
    currentStageKey: snapshot.currentStageKey,
  };
}
