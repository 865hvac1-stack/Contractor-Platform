import Link from "next/link";
import { mapsUrl, propertyAddress, fieldStatusLabel } from "@/lib/tech/access";
import { customerLabel } from "@/lib/tech/today";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { updateFieldJobStatusAction } from "@/server/actions/field";

export function TechJobCard({
  job,
}: {
  job: {
    id: string;
    jobType: string | null;
    status: Parameters<typeof fieldStatusLabel>[0];
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    customerNotes: string | null;
    customer: { firstName: string; lastName: string; businessName: string | null; phone: string | null };
    property: { address: string; city: string; state: string; zip: string };
    playbook: { name: string } | null;
    customerMemberships: { plan: { name: string } }[];
    assignments?: { user: { firstName: string; lastName: string } }[];
  };
}) {
  const address = propertyAddress(job.property);
  const name = customerLabel(job.customer);
  const window = job.scheduledStart
    ? `${job.scheduledStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${
        job.scheduledEnd
          ? ` – ${job.scheduledEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : ""
      }`
    : "Unscheduled";

  return (
    <article className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-[var(--cy-navy)]">{name}</p>
          <p className="text-sm text-[var(--muted-foreground)]">
            {job.playbook?.name || job.jobType || "Job"} · {window}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>
      <p className="mt-2 text-sm">{address}</p>
      {job.customerMemberships[0] ? (
        <p className="mt-2 text-xs font-medium text-emerald-800">{job.customerMemberships[0].plan.name}</p>
      ) : null}
      {job.customerNotes ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{job.customerNotes}</p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={mapsUrl(address)} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium">
          Directions
        </a>
        {job.customer.phone ? (
          <a href={`tel:${job.customer.phone}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium">
            Call
          </a>
        ) : (
          <span className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm text-[var(--muted-foreground)]">
            No phone
          </span>
        )}
        {job.customer.phone ? (
          <a href={`sms:${job.customer.phone}`} className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-medium">
            Text
          </a>
        ) : null}
        {job.status !== "DISPATCHED" && job.status !== "IN_PROGRESS" && job.status !== "COMPLETED" ? (
          <form
            action={async () => {
              "use server";
              await updateFieldJobStatusAction(job.id, "DISPATCHED");
            }}
          >
            <Button type="submit" className="h-11 w-full">
              On my way
            </Button>
          </form>
        ) : null}
        {job.status === "DISPATCHED" ? (
          <form
            action={async () => {
              "use server";
              await updateFieldJobStatusAction(job.id, "IN_PROGRESS");
            }}
          >
            <Button type="submit" className="h-11 w-full">
              Start job
            </Button>
          </form>
        ) : null}
      </div>
      <Link href={`/tech/jobs/${job.id}`} className="mt-3 block text-center text-sm font-medium text-[var(--cy-orange)]">
        Open job
      </Link>
    </article>
  );
}
