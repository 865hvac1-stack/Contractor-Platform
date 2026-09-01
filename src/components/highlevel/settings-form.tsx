"use client";

import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyHighLevelSyncAction,
  connectHighLevelPrivateTokenAction,
  disconnectHighLevelAction,
  previewHighLevelSyncAction,
  refreshHighLevelConnectionAction,
} from "@/server/actions/highlevel";
import { cn } from "@/lib/utils";

export function HighLevelSettingsForm({
  oauthReady,
  connected,
  missing,
  webhookUrl,
}: {
  oauthReady: boolean;
  connected: boolean;
  missing: string[];
  webhookUrl: string;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
        <h2 className="font-medium">Marketplace OAuth</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Production contractors connect their own HighLevel location through a Marketplace app. This is the
          multi-tenant path.
        </p>
        {oauthReady ? (
          <a href="/api/integrations/highlevel/start" className={cn(buttonVariants())}>
            {connected ? "Reconnect HighLevel" : "Connect HighLevel"}
          </a>
        ) : (
          <div className="rounded-xl bg-[var(--cy-gray)] px-4 py-3 text-sm">
            <p className="font-medium">Provider configuration required</p>
            <p className="mt-1 text-[var(--muted-foreground)]">
              Set {missing.join(" and ") || "HIGHLEVEL_CLIENT_ID and HIGHLEVEL_CLIENT_SECRET"} on Railway,
              create a HighLevel Marketplace app, and add redirect URI plus webhook URL:
            </p>
            <p className="mt-2 break-all font-mono text-xs">{webhookUrl}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
        <h2 className="font-medium">865 HVAC / single-location testing</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Paste the existing location Private Integration Token. This is not the long-term SaaS architecture.
          Tokens are encrypted and never shown again.
        </p>
        <ActionForm action={connectHighLevelPrivateTokenAction} className="space-y-3" successMessage="Location saved.">
          <div className="space-y-1.5">
            <Label htmlFor="locationId">HighLevel Location ID</Label>
            <Input id="locationId" name="locationId" placeholder="Existing 865 HVAC location id" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="locationName">Location name</Label>
            <Input id="locationName" name="locationName" placeholder="865 HVAC" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="privateToken">Private Integration Token</Label>
            <Input id="privateToken" name="privateToken" type="password" autoComplete="off" required />
          </div>
          <Button type="submit">Connect existing location</Button>
        </ActionForm>
      </section>

      {connected ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
          <h2 className="font-medium">Actions</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ActionForm action={refreshHighLevelConnectionAction}>
              <Button type="submit" variant="outline">
                Refresh
              </Button>
            </ActionForm>
            <ActionForm action={previewHighLevelSyncAction}>
              <Button type="submit" variant="outline">
                Preview initial sync
              </Button>
            </ActionForm>
            <ActionForm action={applyHighLevelSyncAction}>
              <Button type="submit" variant="outline">
                Run initial sync
              </Button>
            </ActionForm>
            <ActionForm action={disconnectHighLevelAction}>
              <Button type="submit" variant="outline" className="text-rose-700">
                Disconnect
              </Button>
            </ActionForm>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Preview first. Sync matches existing customers by HighLevel ID, verified email, or normalized phone.
            Name-only never creates a duplicate customer. Historical jobs are not touched and no campaigns are sent.
          </p>
        </section>
      ) : null}
    </div>
  );
}
