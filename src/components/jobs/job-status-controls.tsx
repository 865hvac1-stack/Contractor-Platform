"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobStatus } from "@prisma/client";
import { updateJobStatusAction } from "@/server/actions/jobs";
import { Button } from "@/components/ui/button";

const NEXT_STATUSES: Partial<Record<JobStatus, JobStatus[]>> = {
  NEW: ["UNSCHEDULED", "SCHEDULED", "DISPATCHED", "CANCELED"],
  UNSCHEDULED: ["SCHEDULED", "DISPATCHED", "CANCELED"],
  SCHEDULED: ["DISPATCHED", "IN_PROGRESS", "ON_HOLD", "CANCELED"],
  DISPATCHED: ["IN_PROGRESS", "ON_HOLD", "CANCELED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "CANCELED"],
  ON_HOLD: ["SCHEDULED", "DISPATCHED", "IN_PROGRESS", "CANCELED"],
  COMPLETED: [],
  CANCELED: [],
};

export function JobStatusControls({
  jobId,
  status,
}: {
  jobId: string;
  status: JobStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => NEXT_STATUSES[status] ?? [], [status]);

  if (options.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No further status changes available.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((next) => (
          <Button
            key={next}
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await updateJobStatusAction(jobId, next);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
              });
            }}
          >
            {next.replaceAll("_", " ")}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
