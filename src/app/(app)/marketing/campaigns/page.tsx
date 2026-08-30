import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { createCampaignDraftAction } from "@/server/actions/marketing";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

const TYPES = [
  "SMS",
  "EMAIL",
  "SOCIAL",
  "PAID_AD_REFERENCE",
  "CUSTOMER_REACTIVATION",
  "SEASONAL",
  "MAINTENANCE",
  "UNSOLD_ESTIMATE",
  "MEMBERSHIP",
  "REVIEW",
] as const;

export default async function CampaignsPage() {
  const ctx = await requirePermission("marketing:view");
  const campaigns = await prisma.campaign.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Campaigns</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          Track seasonal, reactivation, review, and paid-ad campaigns. Sending is disabled until
          SMS/email providers are configured. Outcomes (booked, sold, revenue) attach later.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-semibold text-[var(--cy-navy)]">New campaign draft</h2>
        <ActionForm action={createCampaignDraftAction} className="mt-4 space-y-3" successMessage="Draft saved. Nothing was sent.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="Spring tune-up" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                name="type"
                className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm"
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Save draft</Button>
            <Button type="button" variant="outline" disabled>
              Send — communications not configured
            </Button>
          </div>
        </ActionForm>
      </section>

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns"
          description="Draft a campaign so future sends can report booked jobs, revenue, and profit — not just opens."
        />
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <li
              key={campaign.id}
              className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-[var(--cy-navy)]">{campaign.name}</p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {campaign.type.replaceAll("_", " ")}
                </p>
              </div>
              <StatusBadge status={campaign.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
