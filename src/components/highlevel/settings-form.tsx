"use client";

import { useState } from "react";
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
  refreshHighLevelSocialAccountsAction,
  syncHighLevelCommunicationsAction,
  syncHighLevelNumbersAction,
} from "@/server/actions/highlevel";
import { cn } from "@/lib/utils";

export function HighLevelSettingsForm({
  oauthReady,
  connected,
  missing,
  webhookUrl,
  storedLocationId,
  storedLocationName,
  tokenStored,
  sandboxOAuth = false,
  testOnly = false,
}: {
  oauthReady: boolean;
  connected: boolean;
  missing: string[];
  webhookUrl: string;
  storedLocationId: string | null;
  storedLocationName: string | null;
  tokenStored: boolean;
  sandboxOAuth?: boolean;
  testOnly?: boolean;
}) {
  const [replaceToken, setReplaceToken] = useState(false);
  const tokenRequired = !tokenStored || replaceToken;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
        <h2 className="font-medium">Marketplace OAuth</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Production contractors connect their own HighLevel location through a Marketplace app. Click Connect
          HighLevel in this company first. A HighLevel Marketplace install link cannot create ContractorYou
          authorization state.
          {sandboxOAuth
            ? " This Summit sandbox may authorize an existing location as TEST ONLY. It cannot take ownership of another company location."
            : ""}
        </p>
        {oauthReady ? (
          <a href="/api/integrations/highlevel/start" className={cn(buttonVariants())}>
            {testOnly ? "Reauthorize TEST ONLY HighLevel" : connected ? "Reconnect HighLevel" : "Connect HighLevel"}
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
        <h2 className="font-medium">Inbound webhooks</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Connecting HighLevel does not subscribe Marketplace webhooks. In Marketplace → your app → Advanced
          Settings → Webhooks, turn on <strong>InboundMessage</strong> and <strong>OutboundMessage</strong> and
          paste this URL on each event. Location-level HighLevel Settings → Webhooks is a different path.
          Official inbound phone calls arrive as InboundMessage with messageType CALL.
        </p>
        <p className="break-all font-mono text-xs">{webhookUrl}</p>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-3">
        <h2 className="font-medium">Testing / single-location</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Paste the existing location Private Integration Token once. ContractorYou keeps the encrypted token
          after refresh. This is for 865 HVAC testing only — not the long-term multi-tenant SaaS path.
        </p>
        <ActionForm
          action={connectHighLevelPrivateTokenAction}
          className="space-y-3"
          successMessage="Location saved."
        >
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <input type="text" name="username" tabIndex={-1} autoComplete="username" />
            <input type="password" name="password" tabIndex={-1} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="highlevelLocationId">HighLevel Location ID</Label>
            <Input
              id="highlevelLocationId"
              name="highlevelLocationId"
              defaultValue={storedLocationId ?? ""}
              placeholder="Provider location id only"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              required={!storedLocationId}
              data-1p-ignore
              data-lpignore="true"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              Must be the HighLevel location id. Never a login, company, or contact email.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="locationName">Location name</Label>
            <Input
              id="locationName"
              name="locationName"
              defaultValue={storedLocationName ?? ""}
              placeholder="865 HVAC"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="highlevelPrivateToken">Private Integration Token</Label>
            {tokenStored && !replaceToken ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">Stored securely</p>
                  <p className="text-xs text-[var(--muted-foreground)]">•••••••• · token is not shown again</p>
                </div>
                <Button type="button" variant="outline" onClick={() => setReplaceToken(true)}>
                  Replace token
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="highlevelPrivateToken"
                  name="highlevelPrivateToken"
                  type="password"
                  autoComplete="new-password"
                  required={tokenRequired}
                  data-1p-ignore
                  data-lpignore="true"
                />
                {tokenStored ? (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Submitting a new token replaces the stored credential. Leave this closed if you only need to
                    keep the current connection.
                  </p>
                ) : (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Encrypted server-side. ContractorYou never returns the raw token to the browser.
                  </p>
                )}
              </>
            )}
          </div>
          <Button type="submit">{tokenStored ? "Update connection" : "Connect existing location"}</Button>
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
            <ActionForm action={syncHighLevelCommunicationsAction}>
              <Button type="submit" variant="outline">
                Sync Communications
              </Button>
            </ActionForm>
            <ActionForm action={syncHighLevelNumbersAction}>
              <Button type="submit" variant="outline">
                Sync phone numbers
              </Button>
            </ActionForm>
            <ActionForm action={refreshHighLevelSocialAccountsAction}>
              <Button type="submit" variant="outline">
                Refresh social accounts
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
