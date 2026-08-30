import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

export default async function ReviewsPage() {
  const ctx = await requirePermission("marketing:view");
  const [reviews, requests, completedJobs] = await Promise.all([
    prisma.review.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.reviewRequest.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.job.count({
      where: { companyId: ctx.company.id, status: "COMPLETED" },
    }),
  ]);

  const ratings = reviews.filter((r) => r.rating != null).map((r) => r.rating as number);
  const average =
    ratings.length > 0 ? (ratings.reduce((s, n) => s + n, 0) / ratings.length).toFixed(1) : null;
  const needsResponse = reviews.filter((r) => r.needsResponse).length;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Reviews</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          Reputation center. Ratings appear after Google Business Profile (or another official
          source) is connected. We will not scrape Google or invent reviews.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
            Current rating
          </p>
          <p className="mt-2 text-2xl font-semibold">{average ?? "—"}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {average ? "From imported reviews" : "No imported reviews"}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
            Total reviews
          </p>
          <p className="mt-2 text-2xl font-semibold">{reviews.length}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
            Needs response
          </p>
          <p className="mt-2 text-2xl font-semibold">{needsResponse}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-[var(--cy-text-muted)]">
            Review requests
          </p>
          <p className="mt-2 text-2xl font-semibold">{requests.length}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {completedJobs} completed jobs on file
            {completedJobs > 0 && requests.length === 0
              ? " — request sending is not configured"
              : ""}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">Future workflow</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Job completed → review request. Positive feedback → Google review opportunity.
          Negative feedback → internal recovery. SMS/email send is Coming Soon.
        </p>
        <p className="mt-3 text-xs text-[var(--cy-text-muted)]">
          Completed jobs on file are operational context only
          {completedJobs ? ` (${completedJobs} jobs)` : ""} — not a review metric.
        </p>
      </section>

      {reviews.length === 0 ? (
        <EmptyState
          title="Connect Google Business Profile"
          description="Reviews, response queues, and request conversion rates stay empty until an official API connection imports them."
          actionLabel="Open channels"
          actionHref="/marketing/channels"
        />
      ) : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-[var(--cy-navy)]">
                  {review.authorName || "Reviewer"} · {review.rating ?? "—"}★
                </p>
                {review.needsResponse ? <StatusBadge status="REVIEW_REQUIRED" /> : null}
              </div>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{review.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
