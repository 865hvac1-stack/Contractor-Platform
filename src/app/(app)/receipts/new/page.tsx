import Link from "next/link";
import { requirePermission, jobAccessFilter } from "@/lib/tenant";
import { uploadReceiptAction } from "@/server/actions/receipts";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/db";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const ctx = await requirePermission("receipts:manage");
  const { jobId } = await searchParams;
  const access = jobAccessFilter(ctx.role, ctx.user.id);
  const jobs = await prisma.job.findMany({
    where: { companyId: ctx.company.id, status: { not: "CANCELED" }, ...access },
    select: { id: true, jobNumber: true, jobType: true, customer: { select: { firstName: true, lastName: true } } },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link href="/receipts" className="text-sm text-[var(--muted-foreground)]">
          ← Receipts
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Add receipt</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Take a photo or upload a file. You can assign it after we try to read it.
        </p>
      </div>

      <ActionForm action={uploadReceiptAction} className="space-y-5 rounded-2xl border border-[var(--border)] bg-white p-5">
        {jobId ? <input type="hidden" name="jobId" value={jobId} /> : null}
        <div className="space-y-2">
          <Label htmlFor="file" className="text-base">
            Photo or PDF
          </Label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept="image/*,application/pdf"
            capture="environment"
            className="block w-full rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)] p-6 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--cy-navy)] file:px-4 file:py-2 file:text-white"
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            On a phone, this opens the camera. You can also pick a photo from your library.
          </p>
        </div>
        {!jobId && jobs.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="jobId">Assign to a job now (optional)</Label>
            <select
              id="jobId"
              name="jobId"
              className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base"
              defaultValue=""
            >
              <option value="">Leave unassigned</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobNumber}
                  {job.customer ? ` · ${job.customer.firstName} ${job.customer.lastName}` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button type="submit" className="h-12 w-full text-base">
          Upload and review
        </Button>
      </ActionForm>

      <Link href="/receipts" className={cn(buttonVariants({ variant: "ghost" }), "w-full")}>
        Cancel
      </Link>
    </div>
  );
}
