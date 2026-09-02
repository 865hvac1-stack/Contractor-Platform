import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { getProvider } from "@/lib/integrations/catalog";
import { getProviderEnv, oauthCallbackUrl } from "@/lib/integrations/env";
import { getCompanyConnection } from "@/lib/integrations/store";
import { oauthStartHref } from "@/lib/integrations/oauth-href";
import {
  disconnectIntegrationAction,
  enableInternalChannelAction,
  refreshIntegrationAccountsAction,
  selectIntegrationAccountsAction,
  syncIntegrationAction,
  configureEmailFromAction,
} from "@/server/actions/integrations";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { TrackingNumbersPanel } from "@/components/highlevel/tracking-numbers-panel";

export default async function ChannelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await requirePermission("marketing:view");
  const { provider: providerKey } = await params;
  const { error } = await searchParams;
  const provider = getProvider(providerKey);
  if (!provider) notFound();
  const env = getProviderEnv(providerKey);
  const connection = await getCompanyConnection(ctx.company.id, providerKey);
  const canManage = can(ctx.role, "marketing:manage");
  const callback =
    provider.family === "google"
      ? oauthCallbackUrl("google")
      : provider.family === "meta"
        ? oauthCallbackUrl("meta")
        : provider.family === "tiktok"
          ? oauthCallbackUrl("tiktok")
          : provider.family === "linkedin"
            ? oauthCallbackUrl("linkedin")
            : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/marketing/channels" className="text-sm text-[var(--muted-foreground)]">
          ← Channels
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-[var(--cy-navy)]">{provider.name}</h1>
          <StatusBadge status={connection?.status ?? "NOT_CONNECTED"} />
        </div>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">{provider.description}</p>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{decodeURIComponent(error)}</p>
      ) : null}

      {!env.configured ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
          <h2 className="font-semibold text-[var(--cy-navy)]">Configuration required</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            This integration is built. ContractorYou will not fake a connection. Add these Railway
            variables, then come back and connect.
          </p>
          <ul className="mt-3 list-disc pl-5 text-sm">
            {env.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {callback ? (
            <p className="mt-3 text-sm">
              OAuth callback URI: <code className="rounded bg-[var(--cy-gray)] px-1.5 py-0.5">{callback}</code>
            </p>
          ) : null}
          {env.notes.map((note) => (
            <p key={note} className="mt-2 text-sm text-[var(--muted-foreground)]">
              {note}
            </p>
          ))}
        </section>
      ) : null}

      {connection?.errorMessage ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{connection.errorMessage}</p>
      ) : null}
      {connection?.healthMessage ? (
        <p className="text-sm text-[var(--muted-foreground)]">{connection.healthMessage}</p>
      ) : null}

      {canManage && provider.oauthReady && env.configured ? (
        <div className="flex flex-wrap gap-2">
          <Link href={oauthStartHref(providerKey)} className={cn(buttonVariants())}>
            {connection?.status === "CONNECTED" ? "Reconnect" : "Connect"}
          </Link>
          {connection ? (
            <>
              <ActionForm action={refreshIntegrationAccountsAction}>
                <input type="hidden" name="providerKey" value={providerKey} />
                <Button type="submit" variant="outline">
                  Refresh accounts
                </Button>
              </ActionForm>
              <ActionForm action={syncIntegrationAction}>
                <input type="hidden" name="providerKey" value={providerKey} />
                <Button type="submit" variant="outline">
                  Sync now
                </Button>
              </ActionForm>
            </>
          ) : null}
        </div>
      ) : null}

      {canManage && provider.internalLive ? (
        <ActionForm action={enableInternalChannelAction}>
          <input type="hidden" name="providerKey" value={providerKey} />
          <Button type="submit">Turn on {provider.name}</Button>
        </ActionForm>
      ) : null}

      {providerKey === "email" && canManage ? (
        <ActionForm action={configureEmailFromAction} className="max-w-md space-y-3 rounded-2xl border bg-white p-5">
          <Label htmlFor="fromAddress">From address</Label>
          <Input
            id="fromAddress"
            name="fromAddress"
            placeholder="service@yourcompany.com"
            defaultValue={connection?.accountLabel ?? ""}
          />
          <Button type="submit">Save from address</Button>
        </ActionForm>
      ) : null}

      {connection && connection.accounts.length > 0 ? (
        <ActionForm
          action={selectIntegrationAccountsAction}
          className="space-y-3 rounded-2xl border bg-white p-5"
          successMessage="Account saved."
        >
          <input type="hidden" name="providerKey" value={providerKey} />
          <h2 className="font-semibold text-[var(--cy-navy)]">Select account</h2>
          <ul className="space-y-2">
            {connection.accounts.map((account) => (
              <li key={account.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="accountId"
                    value={account.externalId}
                    defaultChecked={account.selected}
                  />
                  <span>
                    {account.name}{" "}
                    <span className="text-[var(--cy-text-muted)]">({account.kind})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {canManage ? <Button type="submit">Save selection</Button> : null}
        </ActionForm>
      ) : null}

      {connection && canManage ? (
        <ActionForm action={disconnectIntegrationAction} className="max-w-md space-y-3">
          <input type="hidden" name="providerKey" value={providerKey} />
          <Label htmlFor="confirm">Type disconnect to confirm</Label>
          <Input id="confirm" name="confirm" placeholder="disconnect" />
          <Button type="submit" variant="outline">
            Disconnect
          </Button>
        </ActionForm>
      ) : null}

      {providerKey === "tracking_numbers" ? (
        <TrackingNumbersPanel companyId={ctx.company.id} canManage={canManage} />
      ) : null}

      {(providerKey === "website_forms" ||
        providerKey === "landing_pages" ||
        providerKey === "utm_tracking") && (
        <p className="text-sm">
          Manage hosted forms and pages in{" "}
          <Link href="/marketing/forms" className="underline">
            Website
          </Link>
          .
        </p>
      )}
    </div>
  );
}
