import type { JobStatus, Prisma } from "@prisma/client";

export function jobCheckoutWrite(input: {
  next: JobStatus;
  checkedInAt?: Date | null;
  checkedOutAt?: Date | null;
  completedAt?: Date | null;
  now?: Date;
}): Prisma.JobUpdateInput {
  const now = input.now ?? new Date();
  const data: Prisma.JobUpdateInput = { status: input.next };
  if (input.next === "IN_PROGRESS" && !input.checkedInAt) {
    data.checkedInAt = now;
  }
  if (input.next === "COMPLETED") {
    if (!input.checkedOutAt) data.checkedOutAt = now;
    if (!input.completedAt) data.completedAt = now;
  }
  return data;
}

export function jobWasCheckedOut(job: { status: string; checkedOutAt?: Date | null; completedAt?: Date | null }) {
  return job.status === "COMPLETED" && Boolean(job.checkedOutAt || job.completedAt);
}

export function jobWasCheckedIn(job: { status: string; checkedInAt?: Date | null }) {
  return Boolean(job.checkedInAt) || job.status === "IN_PROGRESS";
}
