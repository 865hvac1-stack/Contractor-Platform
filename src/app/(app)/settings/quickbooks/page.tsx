import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getCompanyConnection } from "@/lib/integrations/store";
import { describeSavedQuickBooksApp } from "@/lib/quickbooks/app";
import { QUICKBOOKS_PROVIDER_KEY, quickbooksConfigured, quickbooksSetupSnapshot } from "@/lib/quickbooks/config";
import { getQuickBooksSettings } from "@/lib/quickbooks/connection";
import { INVOICE_TRIGGER_COPY, QUICKBOOKS_STATUS_COPY, publicQuickBooksStatus, quickBooksCardState } from "@/lib/quickbooks/status";
import { maskRealmId } from "@/lib/quickbooks/errors";
import { verifyQuickBooksCompany } from "@/lib/quickbooks/verify";
import { quickbooksWebhookConfigured } from "@/lib/quickbooks/webhook";
import { formatDateTime } from "@/lib/datetime";
import {
  clearQuickBooksAppAction,
  disconnectQuickBooksAction,
  saveQuickBooksAppAction,
  saveQuickBooksSettingsAction,
  syncNowQuickBooksAction,
} from "@/server/actions/quickbooks";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default async function QuickBooksSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const ctx = await requirePermission("accounting:view");
  const { error, connected } = await searchParams;
  const [connection, settings] = await Promise.all([
    getCompanyConnection(ctx.company.id, QUICKBOOKS_PROVIDER_KEY),
    getQuickBooksSettings(ctx.company.id),
  ]);
  if (
    connection?.status === "CONNECTED" &&
    connection.externalAccountId &&
    !settings.qboCompanyName &&
    can(ctx.role, "accounting:manage")
  ) {
    await verifyQuickBooksCompany(prisma, ctx.company.id);
  }
  const freshSettings = await getQuickBooksSettings(ctx.company.id);
  const status = publicQuickBooksStatus(connection);
  const card = quickBooksCardState({
    connection,
    verifiedCompanyName: freshSettings.qboCompanyName,
  });
  const savedApp = describeSavedQuickBooksApp(freshSettings);
  const setup = quickbooksSetupSnapshot(savedApp);
  const configured = quickbooksConfigured(savedApp);
  const canManage = can(ctx.role, "accounting:manage");
  const environment = savedApp.environment === "production" ? "Production" : "Sandbox";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">QuickBooks</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ContractorYou runs the job. QuickBooks keeps the books. Connecting never pushes historical invoices on its
          own.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error === "missing_credentials"
            ? "Add your Intuit Client ID and Client Secret below, or set them on the server, then try Connect again."
            : decodeURIComponent(error)}
        </p>
      ) : null}
      {connected && card === "CONNECTED" ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          QuickBooks company verified. Finish setup before automatic sync turns on.
        </p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Integrations</p>
            <h2 className="mt-2 font-medium">QuickBooks Online</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {card === "CONNECTED"
                ? "Connected"
                : card === "NEEDS_ATTENTION"
                  ? "Needs attention — verify the QuickBooks company or reconnect."
                  : card === "REAUTH_REQUIRED"
                    ? "Authorization expired. Reconnect to continue."
                    : card === "CONNECTING"
                      ? "Waiting for QuickBooks approval."
                      : "No QuickBooks company is linked."}
            </p>
          </div>
          <StatusBadge status={QUICKBOOKS_STATUS_COPY[card] ?? card} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted-foreground)]">Company</dt>
            <dd className="mt-0.5">{freshSettings.qboCompanyName || "Not verified"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Realm / Company ID</dt>
            <dd className="mt-0.5">{maskRealmId(connection?.externalAccountId)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Environment</dt>
            <dd className="mt-0.5">{environment}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Last successful sync</dt>
            <dd className="mt-0.5">
              {connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt, ctx.company.timezone) : "Never"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Automatic sync</dt>
            <dd className="mt-0.5">
              {freshSettings.syncActivated
                ? "On after the chosen start date"
                : "Safe mode — preview only until you finish setup"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted-foreground)]">Webhooks</dt>
            <dd className="mt-0.5">
              {quickbooksWebhookConfigured() ? "Verifier token is set" : "Not configured — polling and Sync Now remain the guarantee"}
            </dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          {canManage && card !== "CONNECTED" && card !== "NEEDS_ATTENTION" ? (
            configured ? (
              <Link href="/api/integrations/quickbooks/start" className={cn(buttonVariants())}>
                {card === "REAUTH_REQUIRED" ? "Reconnect QuickBooks" : "Connect QuickBooks"}
              </Link>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                Save Intuit app keys below, then Connect will send you to QuickBooks to approve access.
              </p>
            )
          ) : null}
          {canManage && (card === "CONNECTED" || card === "NEEDS_ATTENTION") ? (
            <>
              <ActionForm action={syncNowQuickBooksAction}>
                <Button type="submit" size="sm">
                  Sync now
                </Button>
              </ActionForm>
              <Link href="/settings/quickbooks/manage" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Manage
              </Link>
              {!freshSettings.wizardCompletedAt ? (
                <Link href="/settings/quickbooks/setup" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Finish setup
                </Link>
              ) : null}
              <form
                action={async () => {
                  "use server";
                  await disconnectQuickBooksAction();
                }}
              >
                <Button type="submit" variant="outline" size="sm">
                  Disconnect
                </Button>
              </form>
            </>
          ) : null}
          {canManage && card === "REAUTH_REQUIRED" && configured ? (
            <Link href="/api/integrations/quickbooks/start" className={cn(buttonVariants())}>
              Reauthorize
            </Link>
          ) : null}
        </div>
        {status === "CONNECTED" ? (
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Disconnecting removes the login. Invoice history, payments, receipts, and past sync records stay in
            ContractorYou.
          </p>
        ) : null}
      </section>

      {canManage ? (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6">
          <div>
            <h2 className="font-medium">Intuit app keys</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Create a QuickBooks Online app at developer.intuit.com, add the redirect URI below, then paste the Client
              ID and Client Secret here. Keys are encrypted on this server. We never show the secret again after you
              save it.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="redirectUri">Redirect URI to paste in Intuit</Label>
            <Input id="redirectUri" readOnly value={setup.redirectUri} className="font-mono text-xs" />
            <p className="text-xs text-[var(--muted-foreground)]">
              {setup.appUrlSet
                ? "This comes from APP_URL on the server. It must match Intuit exactly, including https."
                : "APP_URL is not set. Set it to your public site URL in Railway so this URI matches production."}
            </p>
          </div>
          <ActionForm action={saveQuickBooksAppAction} successMessage="Intuit app keys saved. You can connect QuickBooks now." className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID</Label>
              <Input
                id="clientId"
                name="clientId"
                defaultValue={savedApp.clientId}
                autoComplete="off"
                required
                placeholder="Intuit Client ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientSecret">Client secret</Label>
              <Input
                id="clientSecret"
                name="clientSecret"
                type="password"
                autoComplete="new-password"
                placeholder={savedApp.hasSecret ? "Saved — leave blank to keep it" : "Intuit Client Secret"}
                required={!savedApp.hasSecret}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Environment</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="environment"
                  value="sandbox"
                  defaultChecked={savedApp.environment !== "production"}
                />
                Sandbox (use this until Intuit approves production)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="environment"
                  value="production"
                  defaultChecked={savedApp.environment === "production"}
                />
                Production
              </label>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Save Intuit keys</Button>
            </div>
          </ActionForm>
          {savedApp.hasClientId || savedApp.hasSecret ? (
            <form
              action={async () => {
                "use server";
                await clearQuickBooksAppAction();
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Remove saved keys
              </Button>
            </form>
          ) : null}
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
            <li>Keys on this page override Railway variables when both are present.</li>
            <li>
              Railway fallback: Client ID {setup.hasEnvClientId ? "is set" : "is missing"}, Client Secret{" "}
              {setup.hasEnvClientSecret ? "is set" : "is missing"}.
            </li>
            <li>Default invoice push stays manual. Imported history never goes to QuickBooks unless you press Sync.</li>
          </ul>
        </section>
      ) : null}

      <ActionForm
        action={saveQuickBooksSettingsAction}
        successMessage="Sync setting saved."
        className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6"
      >
        <h2 className="font-medium">When to send invoices</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          These rules apply only after setup activates automatic sync. Imported history still stays here unless you
          press Sync on that invoice.
        </p>
        <fieldset className="space-y-3">
          {INVOICE_TRIGGER_COPY.map((option) => (
            <label key={option.value} className="flex cursor-pointer gap-3 rounded-xl border border-[var(--border)] p-3">
              <input
                type="radio"
                name="invoiceSyncTrigger"
                value={option.value}
                defaultChecked={freshSettings.invoiceSyncTrigger === option.value}
                className="mt-1"
                disabled={!canManage}
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="mt-1 block text-sm text-[var(--muted-foreground)]">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {canManage ? <Button type="submit">Save setting</Button> : null}
      </ActionForm>
    </div>
  );
}
