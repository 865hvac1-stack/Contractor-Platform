import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { isHighLevelConnected } from "@/lib/highlevel/connection";
import { discoverHighLevelSocialAccounts, socialAccountStatus } from "@/lib/highlevel/social";
import { createSocialDraftAction } from "@/server/actions/marketing";
import { publishSocialPostAction } from "@/server/actions/social";
import { createHighLevelSocialPostAction, refreshHighLevelSocialAccountsAction } from "@/server/actions/highlevel";
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

export default async function SocialPage() {
  const ctx = await requirePermission("marketing:view");
  const canManage = can(ctx.role, "marketing:manage");
  const highlevel = await isHighLevelConnected(prisma, ctx.company.id);
  const discovery = highlevel
    ? await discoverHighLevelSocialAccounts(prisma, ctx.company.id)
    : { authorized: false, connected: false, accounts: [], error: null };
  const drafts = await prisma.socialPost.findMany({
    where: { companyId: ctx.company.id },
    include: { publications: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Social</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          {highlevel
            ? "HighLevel Social Planner is the preferred provider for this company. Direct Facebook/Google OAuth is not required."
            : "Connect HighLevel to use Social Planner, or keep a future direct-provider connection."}
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {CHANNELS.map((channel) => {
          const card = socialAccountStatus(discovery.accounts, channel, highlevel, discovery.authorized);
          return (
            <article key={channel} className="rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-[var(--cy-navy)]">{channel.replaceAll("_", " ")}</p>
                <StatusBadge status={card.status.replaceAll("_", " ")} />
              </div>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{card.detail}</p>
            </article>
          );
        })}
      </section>

      {highlevel && canManage ? (
        <ActionForm action={refreshHighLevelSocialAccountsAction}>
          <Button type="submit" variant="outline">
            Refresh HighLevel social accounts
          </Button>
        </ActionForm>
      ) : null}
      {discovery.error && highlevel ? (
        <p className="text-sm text-rose-700">{discovery.error}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Composer</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Save, schedule, or publish only when you click the button. AI copy never publishes itself.
          </p>
          {canManage && highlevel ? (
            <ActionForm action={createHighLevelSocialPostAction} className="mt-4 space-y-3" successMessage="Saved.">
              {discovery.accounts.length ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">HighLevel accounts</legend>
                  {discovery.accounts.map((account) => (
                    <label key={account.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="accountId" value={account.id} />
                      {account.name} · {account.channel.replaceAll("_", " ")}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">
                  No HighLevel social accounts were discovered. Connect them in HighLevel Social Planner, then refresh.
                </p>
              )}
              <Textarea id="body" name="body" rows={5} required placeholder="Write the post." />
              <Input name="linkUrl" placeholder="Optional link" />
              <Input name="mediaUrl" placeholder="Optional public image/video URL" />
              <Input name="ctaLabel" placeholder="Optional call to action" />
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Schedule</Label>
                <Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
                <p className="text-xs text-[var(--cy-text-muted)]">
                  Schedule stores a future time in HighLevel. It does not publish immediately.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="intent">Action</Label>
                <select
                  id="intent"
                  name="intent"
                  className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm"
                  defaultValue="draft"
                >
                  <option value="draft">Save draft — do not publish</option>
                  <option value="schedule">Schedule in HighLevel — do not publish now</option>
                  <option value="publish">Publish now through HighLevel</option>
                </select>
              </div>
              <Button type="submit">Continue</Button>
            </ActionForm>
          ) : canManage ? (
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
              <Button type="submit">Save draft</Button>
            </ActionForm>
          ) : null}
        </section>
        <section className="rounded-2xl border bg-[var(--cy-navy)] p-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Provider
          </p>
          <p className="mt-2 text-sm text-white/70">
            {highlevel
              ? "Publishing goes through HighLevel Social Planner only. Instagram, TikTok, and YouTube need media. Facebook, LinkedIn, and Google need caption or media."
              : "HighLevel is not connected, so drafts stay in ContractorYou until a provider is selected."}
          </p>
        </section>
      </div>

      {drafts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          description="Save a draft, schedule, or publish. Nothing is sent until you click."
        />
      ) : (
        <ul className="space-y-3">
          {drafts.map((post) => (
            <li key={post.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--cy-navy)]">
                  {post.channel.replaceAll("_", " ")}
                  {post.provider === "highlevel" ? " · HighLevel" : ""}
                </p>
                <StatusBadge status={post.status} />
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">{post.body}</p>
              {post.scheduledAt ? (
                <p className="mt-1 text-xs text-[var(--cy-text-muted)]">
                  Scheduled {post.scheduledAt.toLocaleString()}
                </p>
              ) : null}
              {post.publishedAt ? (
                <p className="mt-1 text-xs text-[var(--cy-text-muted)]">
                  Published {post.publishedAt.toLocaleString()}
                </p>
              ) : null}
              {post.publications.map((publication) => (
                <p key={publication.id} className="mt-2 text-xs text-[var(--cy-text-muted)]">
                  {publication.channel.replaceAll("_", " ")}: {publication.status}
                  {publication.errorMessage ? ` — ${publication.errorMessage}` : ""}
                </p>
              ))}
              {canManage && !highlevel && (post.status === "DRAFT" || post.status === "SCHEDULED") ? (
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
