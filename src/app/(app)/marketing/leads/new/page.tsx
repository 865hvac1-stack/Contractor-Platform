import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { createLeadAction } from "@/server/actions/leads";
import { LEAD_SOURCE_LABELS, LEAD_SOURCES } from "@/lib/leads/sources";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default async function NewLeadPage() {
  const ctx = await requirePermission("leads:manage");
  const team = await prisma.membership.findMany({
    where: { companyId: ctx.company.id, status: "ACTIVE" },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/marketing/leads" className="text-sm text-[var(--muted-foreground)]">
          ← Leads
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
          Record a lead
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Manual entry into the same model Google, Meta, phone, and website will use. Matching
          looks at this company only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lead details</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={createLeadAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" required />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="source">Source</Label>
                <select id="source" name="source" defaultValue="MANUAL" className={selectClassName}>
                  {LEAD_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {LEAD_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assignedUserId">Assigned team member</Label>
                <select id="assignedUserId" name="assignedUserId" className={selectClassName}>
                  <option value="">Unassigned</option>
                  {team.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.firstName} {m.user.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="campaignName">Campaign</Label>
                <Input id="campaignName" name="campaignName" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimatedOpportunity">Estimated opportunity ($)</Label>
                <Input id="estimatedOpportunity" name="estimatedOpportunity" inputMode="decimal" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea id="message" name="message" rows={3} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nextAction">Next action</Label>
              <Input id="nextAction" name="nextAction" placeholder="Call back, book estimate…" />
            </div>

            <div className="rounded-xl bg-[var(--cy-gray)] p-4">
              <p className="text-sm font-medium text-[var(--cy-navy)]">Website / UTM attribution</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Optional. Used when this lead came from a page or ad.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input name="landingPage" placeholder="Landing page URL" />
                <Input name="referrer" placeholder="Referrer" />
                <Input name="utmSource" placeholder="utm_source" />
                <Input name="utmMedium" placeholder="utm_medium" />
                <Input name="utmCampaign" placeholder="utm_campaign" />
                <Input name="utmContent" placeholder="utm_content" />
                <Input name="utmTerm" placeholder="utm_term" className="sm:col-span-2" />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Link href="/marketing/leads">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit">Save lead</Button>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
