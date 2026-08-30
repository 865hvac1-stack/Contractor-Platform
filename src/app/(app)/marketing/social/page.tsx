import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { createSocialDraftAction } from "@/server/actions/marketing";
import { publishSocialPostAction } from "@/server/actions/social";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

const CHANNELS = [
  "FACEBOOK",
  "INSTAGRAM",
  "GOOGLE_BUSINESS_PROFILE",
  "TIKTOK",
  "LINKEDIN",
  "YOUTUBE",
] as const;

const PROVIDER_FOR_CHANNEL: Record<(typeof CHANNELS)[number], string> = {
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  GOOGLE_BUSINESS_PROFILE: "google_business_profile",
  TIKTOK: "tiktok",
  LINKEDIN: "linkedin",
  YOUTUBE: "youtube",
};

export default async function SocialPage() {
  const ctx = await requirePermission("marketing:view");
  const canManage = can(ctx.role, "marketing:manage");
  const [drafts, connections] = await Promise.all([
    prisma.socialPost.findMany({
      where: { companyId: ctx.company.id },
      include: { publications: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.integrationConnection.findMany({
      where: {
        companyId: ctx.company.id,
        providerKey: { in: Object.values(PROVIDER_FOR_CHANNEL) },
      },
    }),
  ]);
  const byProvider = new Map(connections.map((row) => [row.providerKey, row]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Social</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          Connected accounts appear here. Publishing is provider-aware and never automatic.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {CHANNELS.map((channel) => {
          const connection = byProvider.get(PROVIDER_FOR_CHANNEL[channel]);
          return (
            <article key={channel} className="rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-[var(--cy-navy)]">{channel.replaceAll("_", " ")}</p>
                <StatusBadge status={connection?.status ?? "NOT_CONNECTED"} />
              </div>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                {connection?.accountLabel || "Not connected"}
              </p>
              <p className="mt-1 text-xs text-[var(--cy-text-muted)]">
                {connection?.lastSyncAt
                  ? `Last sync ${connection.lastSyncAt.toLocaleString()}`
                  : connection?.healthMessage || "Connect this channel to publish."}
              </p>
            </article>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Composer</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Save a draft, preview the words, then publish only to a connected network. AI copy will
            never post itself.
          </p>
          {canManage ? (
            <ActionForm
              action={createSocialDraftAction}
              className="mt-4 space-y-3"
              successMessage="Draft saved. It was not published."
            >
              <div className="space-y-2">
                <Label htmlFor="channel">Channel</Label>
                <select
                  id="channel"
                  name="channel"
                  className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm"
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {channel.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <Textarea id="body" name="body" rows={5} required placeholder="Write the post." />
              <Input name="linkUrl" placeholder="Optional link" />
              <Input name="mediaUrl" placeholder="Optional image URL" />
              <Input name="ctaLabel" placeholder="Optional call to action" />
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Schedule (optional)</Label>
                <Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
                <p className="text-xs text-[var(--cy-text-muted)]">
                  Scheduling stores the time. Publishing still requires an explicit Publish now — we will
                  not auto-post AI or draft content.
                </p>
              </div>
              <Button type="submit">Save draft</Button>
            </ActionForm>
          ) : null}
        </section>
        <section className="rounded-2xl border bg-[var(--cy-navy)] p-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Preview
          </p>
          <p className="mt-2 text-sm text-white/70">
            Each network gets its own payload. A Facebook post is not automatically an Instagram
            reel or a Google Business update.
          </p>
        </section>
      </div>

      {drafts.length === 0 ? (
        <EmptyState
          title="No drafts yet"
          description="Save a post as a draft. Publishing stays off until that channel is actually connected and the provider allows it."
        />
      ) : (
        <ul className="space-y-3">
          {drafts.map((post) => (
            <li key={post.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--cy-navy)]">
                  {post.channel.replaceAll("_", " ")}
                </p>
                <StatusBadge status={post.status} />
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">
                {post.body}
              </p>
              {post.publications.map((publication) => (
                <p key={publication.id} className="mt-2 text-xs text-[var(--cy-text-muted)]">
                  {publication.channel}: {publication.status}
                  {publication.errorMessage ? ` — ${publication.errorMessage}` : ""}
                </p>
              ))}
              {canManage && (post.status === "DRAFT" || post.status === "SCHEDULED") ? (
                <ActionForm action={publishSocialPostAction} className="mt-3">
                  <input type="hidden" name="postId" value={post.id} />
                  <Button type="submit" variant="outline">
                    Publish now
                  </Button>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
