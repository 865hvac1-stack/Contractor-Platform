import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { RemainingItem } from "@/lib/playbooks/engine";
import { remainingHref } from "@/lib/tech/next-step";
import { completeFieldJobAction, overrideCompleteJobAction } from "@/server/actions/field";
import type { JobStatus } from "@prisma/client";

export function CompleteJobPanel({
  jobId,
  remaining,
  canOverride,
  jobStatus,
}: {
  jobId: string;
  remaining: RemainingItem[];
  canOverride: boolean;
  jobStatus: JobStatus;
}) {
  if (jobStatus === "COMPLETED") {
    return <p className="text-sm text-emerald-800">This job is complete.</p>;
  }
  if (jobStatus === "CANCELED") {
    return <p className="text-sm text-[var(--muted-foreground)]">This job was canceled.</p>;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--cy-navy)]">Complete job</h2>
      {remaining.length > 0 ? (
        <div className="rounded-xl border border-[var(--cy-orange)]/30 bg-[var(--cy-orange-muted)] p-3">
          <p className="text-sm font-semibold text-[var(--cy-navy)]">
            {remaining.length} item{remaining.length === 1 ? "" : "s"} left
          </p>
          <ul className="mt-2 space-y-2">
            {remaining.map((item) => (
              <li key={item.stepId}>
                <Link href={remainingHref(item)} className="block min-h-11 rounded-lg bg-white px-3 py-2 text-sm">
                  ○ {item.title}
                  <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{item.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-emerald-800">Required playbook items are done.</p>
      )}
      <form
        action={async () => {
          "use server";
          await completeFieldJobAction(jobId);
        }}
      >
        <Button type="submit" className="h-12 w-full" disabled={remaining.length > 0}>
          Complete job
        </Button>
      </form>
      {remaining.length > 0 && canOverride ? (
        <form
          action={async (formData) => {
            "use server";
            await overrideCompleteJobAction(jobId, String(formData.get("reason") || "Manager override"));
          }}
          className="space-y-2"
        >
          <Textarea name="reason" required rows={2} placeholder="Why this completion is overridden" />
          <Button type="submit" variant="outline" className="h-11 w-full">
            Override and complete
          </Button>
        </form>
      ) : null}
    </div>
  );
}
