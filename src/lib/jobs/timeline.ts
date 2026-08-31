export type JobTimelineItem = {
  at: Date;
  title: string;
  detail?: string;
};

export function buildJobTimeline(input: {
  createdAt: Date;
  importedAt?: Date | null;
  occurredAt?: Date | null;
  scheduledStart?: Date | null;
  completedAt?: Date | null;
  historical?: boolean;
  assignedNames?: string[];
  importedTechnicianName?: string | null;
  estimates?: { estimateNumber: string; createdAt: Date; approvedAt?: Date | null; importMode?: string | null }[];
  invoices?: { invoiceNumber: string; createdAt: Date; importMode?: string | null }[];
  payments?: { amountLabel: string; paidAt: Date; importMode?: string | null }[];
  workflow?: { kind: string; note?: string | null; createdAt: Date }[];
}): JobTimelineItem[] {
  const items: JobTimelineItem[] = [];
  if (input.occurredAt) {
    items.push({ at: input.occurredAt, title: "Original job date", detail: "From the imported record" });
  }
  items.push({
    at: input.createdAt,
    title: input.historical ? "Imported into ContractorYou" : "Job created",
  });
  if (input.importedAt && input.historical && input.importedAt.getTime() !== input.createdAt.getTime()) {
    items.push({ at: input.importedAt, title: "Import completed" });
  }
  if (input.scheduledStart) items.push({ at: input.scheduledStart, title: "Scheduled" });
  if (input.assignedNames?.length) {
    items.push({
      at: input.scheduledStart ?? input.createdAt,
      title: "Assigned",
      detail: input.assignedNames.join(", "),
    });
  } else if (input.importedTechnicianName) {
    items.push({
      at: input.occurredAt ?? input.createdAt,
      title: "Historical technician",
      detail: input.importedTechnicianName,
    });
  }
  for (const event of input.workflow ?? []) {
    items.push({
      at: event.createdAt,
      title: event.kind.replaceAll("_", " "),
      detail: event.note ?? undefined,
    });
  }
  for (const estimate of input.estimates ?? []) {
    items.push({ at: estimate.createdAt, title: "Estimate created", detail: estimate.estimateNumber });
    if (estimate.approvedAt) {
      items.push({ at: estimate.approvedAt, title: "Estimate approved", detail: estimate.estimateNumber });
    }
  }
  for (const invoice of input.invoices ?? []) {
    items.push({ at: invoice.createdAt, title: "Invoice created", detail: invoice.invoiceNumber });
  }
  for (const payment of input.payments ?? []) {
    items.push({ at: payment.paidAt, title: "Payment recorded", detail: payment.amountLabel });
  }
  if (input.completedAt) items.push({ at: input.completedAt, title: "Job completed" });

  return items
    .filter((item) => item.at instanceof Date && !Number.isNaN(item.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
