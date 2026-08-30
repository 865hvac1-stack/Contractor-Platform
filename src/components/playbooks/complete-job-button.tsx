"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeJobWithPlaybookAction } from "@/server/actions/playbooks";
import { Button } from "@/components/ui/button";

export function CompleteJobButton({
  jobId,
  remainingCount,
}: {
  jobId: string;
  remainingCount: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--muted-foreground)]">
        {remainingCount > 0
          ? `${remainingCount} item${remainingCount === 1 ? "" : "s"} remaining before this job can be completed.`
          : "All required playbook items are done."}
      </p>
      <Button
        disabled={pending}
        className="h-12 w-full text-base"
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await completeJobWithPlaybookAction(jobId);
          setPending(false);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
        }}
      >
        {pending ? "Completing…" : "Complete job"}
      </Button>
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
