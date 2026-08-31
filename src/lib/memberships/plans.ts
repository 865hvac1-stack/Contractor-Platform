export function membershipPlanValueLines(plan: {
  includedVisits: number | null;
  priorityService: boolean;
  discountPercent: number;
  benefits: string | null;
  description?: string | null;
}) {
  const lines: string[] = [];
  if (plan.includedVisits) {
    lines.push(`${plan.includedVisits} maintenance visit${plan.includedVisits === 1 ? "" : "s"}`);
  }
  if (plan.priorityService) lines.push("Priority service");
  if (plan.discountPercent) lines.push(`${plan.discountPercent}% repair discount`);
  if (plan.description?.trim()) lines.push(plan.description.trim());
  if (plan.benefits?.trim()) {
    for (const line of plan.benefits.split(/\n|,/).map((item) => item.trim()).filter(Boolean)) {
      if (!lines.includes(line)) lines.push(line);
    }
  }
  return lines;
}
