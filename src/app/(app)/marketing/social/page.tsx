import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { createSocialDraftAction } from "@/server/actions/marketing";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
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
  const drafts = await prisma.socialPost.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Social</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          One place for the contractor&apos;s social presence. Drafts stay in ContractorYou.
          Publishing is disabled until a channel is actually connected.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Create a draft</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            ContractorYou Content Assistant will draft copy here later. You review before
            anything is published.
          </p>
          <ActionForm action={createSocialDraftAction} className="mt-4 space-y-3" successMessage="Draft saved. It was not published.">
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
            <div className="space-y-2">
              <Label htmlFor="body">Post</Label>
              <Textarea
                id="body"
                name="body"
                rows={5}
                placeholder="Write or paste a post. AI suggestions will appear here — they will never auto-publish."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save draft</Button>
              <Button type="button" variant="outline" disabled>
                Publish — not connected
              </Button>
            </div>
          </ActionForm>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--cy-navy)] p-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            Content Assistant
          </p>
          <h2 className="mt-2 text-xl font-semibold">Ask for a draft. You approve it.</h2>
          <ul className="mt-4 space-y-2 text-sm text-white/70">
            <li>“Create a Facebook post about our new install.”</li>
            <li>“Write a spring AC tune-up campaign.”</li>
            <li>“Turn these job photos into a social post.”</li>
            <li>“Give me five posts for next week.”</li>
          </ul>
          <input
            disabled
            placeholder="Assistant is not connected yet"
            className="mt-5 h-11 w-full rounded-xl border border-white/10 bg-white/8 px-3 text-sm text-white placeholder:text-white/35"
          />
        </section>
      </div>

      {drafts.length === 0 ? (
        <EmptyState
          title="No drafts yet"
          description="Save a post as a draft. Calendar, scheduling, and publishing wait on real channel connections."
        />
      ) : (
        <ul className="space-y-3">
          {drafts.map((post) => (
            <li
              key={post.id}
              className="rounded-2xl border border-[var(--border)] bg-white p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--cy-navy)]">
                  {post.channel.replaceAll("_", " ")}
                </p>
                <StatusBadge status={post.status} />
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">
                {post.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
