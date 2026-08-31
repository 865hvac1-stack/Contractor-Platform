import { Button } from "@/components/ui/button";
import { updateFieldJobStatusAction } from "@/server/actions/field";
import type { JobStatus } from "@prisma/client";

export function FieldStatusButtons({ jobId, status }: { jobId: string; status: JobStatus }) {
  if (status === "COMPLETED" || status === "CANCELED") return null;

  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {status !== "DISPATCHED" && status !== "IN_PROGRESS" ? (
        <form
          action={async () => {
            "use server";
            await updateFieldJobStatusAction(jobId, "DISPATCHED");
          }}
        >
          <Button type="submit" className="h-12 w-full">
            On my way
          </Button>
        </form>
      ) : null}
      {status === "DISPATCHED" ? (
        <form
          action={async () => {
            "use server";
            await updateFieldJobStatusAction(jobId, "IN_PROGRESS");
          }}
        >
          <Button type="submit" className="h-12 w-full">
            Start job
          </Button>
        </form>
      ) : null}
      {status === "IN_PROGRESS" ? (
        <form
          action={async () => {
            "use server";
            await updateFieldJobStatusAction(jobId, "ON_HOLD");
          }}
        >
          <Button type="submit" variant="outline" className="h-12 w-full">
            Pause / hold
          </Button>
        </form>
      ) : null}
      {status === "ON_HOLD" ? (
        <form
          action={async () => {
            "use server";
            await updateFieldJobStatusAction(jobId, "IN_PROGRESS");
          }}
        >
          <Button type="submit" className="h-12 w-full">
            Resume job
          </Button>
        </form>
      ) : null}
    </div>
  );
}
