import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { HIGHLEVEL_DEEP_LINKS, HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { highlevelOAuthConfigured, highlevelOAuthNotes, highlevelWebhookUrl } from "@/lib/highlevel/env";
import { formatHighLevelCapabilityStatus, highlevelCapabilities } from "@/lib/highlevel/capabilities";
import { highlevelAuthMode, resolveHighLevelConnection } from "@/lib/highlevel/connection";
import { ensureCurrentHighLevelDiagnostics } from "@/lib/highlevel/current-diagnostics";
import { sanitizeHighLevelLocationId } from "@/lib/highlevel/location-id";
import {
  formatConversationsDiagnostic,
  type HighLevelConversationsDiagnostic,
} from "@/lib/highlevel/conversations-diagnostic";
import { formatTokenTypeDiagnostic, type HighLevelTokenTypeDiagnostic } from "@/lib/highlevel/token-type-diagnostic";
import { formatOauthInstallDiagnostic, type FreshOauthLocationResolution } from "@/lib/highlevel/oauth-location";
import { highlevelSettingsHealth } from "@/lib/highlevel/settings-health";
import { publicHighLevelConnectionView } from "@/lib/highlevel/location-id";
import { AgentToolSettings } from "@/components/highlevel/agent-tool-settings";
import { ConversationOwnerForm } from "@/components/highlevel/conversation-owner-form";
import { ReceptionistSettingsForm } from "@/components/highlevel/receptionist-settings-form";
import { loadReceptionistSettings } from "@/lib/intelligence/receptionist/settings";
import { HighLevelSettingsForm } from "@/components/highlevel/settings-form";
import { parseCustomerConversationOwner } from "@/lib/comms/conversation-owner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/datetime";
import { getHighLevelTestGrant, toHighLevelTestGrantView } from "@/lib/highlevel/test-grant";
import { companyAllowsExternalIntegrationTesting } from "@/lib/demo/guard";

function commsSummaryText(summary: unknown, fallback: string) {
  if (!summary || typeof summary !== "object") return fallback;
  const row = summary as {
    conversationsScanned?: number;
    conversationsImported?: number;
    conversationsUpdated?: number;
    smsImported?: number;
    callsImported?: number;
    unmatchedCommunications?: number;
    duplicates?: number;
    failures?: number;
    checkpointTo?: string;
    conversationsFound?: number;
    mapped?: number;
    providerOnly?: number;
    unmatched?: number;
    skipped?: number;
    failed?: number;
    messagesImported?: number;
  };
  if (typeof row.conversationsScanned === "number") {
    return [
      `${row.conversationsScanned} scanned`,
      `${row.conversationsImported ?? 0} new threads`,
      `${row.conversationsUpdated ?? 0} updated threads`,
      `${row.smsImported ?? 0} SMS`,
      `${row.callsImported ?? 0} calls`,
      `${row.unmatchedCommunications ?? 0} unmatched`,
      `${row.duplicates ?? 0} duplicates`,
      `${row.failures ?? 0} failures`,
    ].join(" · ");
  }
  if (typeof row.conversationsFound !== "number") return fallback;
  return [
    `${row.conversationsFound} found`,
    `${row.mapped ?? 0} mapped`,
    `${row.providerOnly ?? 0} HighLevel-only`,
    `${row.unmatched ?? 0} unmatched`,
    `${row.skipped ?? 0} skipped`,
    `${row.failed ?? 0} failed`,
    `${row.messagesImported ?? 0} messages`,
  ].join(" · ");
}

export const maxDuration = 300;

export default async function HighLevelSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; test_connected?: string }>;
}) {
  const ctx = await requirePermission("marketing:manage");
  const { error, connected, test_connected: testConnected } = await searchParams;
  const [testGrantRow, sandboxEnabled, agentToolKeys, agentToolCalls] = await Promise.all([
    getHighLevelTestGrant(prisma, ctx.company.id),
    companyAllowsExternalIntegrationTesting(ctx.company.id, prisma),
    prisma.agentToolCredential.findMany({
      where: { companyId: ctx.company.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, lastFour: true, lastUsedAt: true, createdAt: true },
    }),
    prisma.agentToolCall.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, tool: true, success: true, errorCode: true, customerId: true, jobId: true, createdAt: true },
    }),
  ]);
  const testGrant = toHighLevelTestGrantView(testGrantRow);
  const resolved = await resolveHighLevelConnection(prisma, ctx.company.id);
  const connection = resolved.connection;
  const lastEvent = connection
    ? await prisma.integrationEvent.findFirst({
        where: { companyId: ctx.company.id, connectionId: connection.id },
        orderBy: { receivedAt: "desc" },
      })
    : null;
  const failedEvents = connection
    ? await prisma.integrationEvent.count({
        where: { companyId: ctx.company.id, connectionId: connection.id, processedAt: null },
      })
    : 0;
  const mapped = await prisma.providerIdentityMap.count({
    where: { companyId: ctx.company.id, provider: HIGHLEVEL_PROVIDER_KEY },
  });
  const lastCommsSync = connection
    ? await prisma.integrationSync.findFirst({
        where: { companyId: ctx.company.id, connectionId: connection.id, kind: "communications" },
        orderBy: { startedAt: "desc" },
      })
    : null;
  const lastConversationsDiagnostic = connection
    ? await prisma.integrationSync.findFirst({
        where: { companyId: ctx.company.id, connectionId: connection.id, kind: "conversations_diagnostic" },
        orderBy: { startedAt: "desc" },
      })
    : null;
  const lastTokenTypeDiagnostic = connection
    ? await prisma.integrationSync.findFirst({
        where: { companyId: ctx.company.id, connectionId: connection.id, kind: "token_type_diagnostic" },
        orderBy: { startedAt: "desc" },
      })
    : null;
  const lastOauthInstall = connection
    ? await prisma.integrationSync.findFirst({
        where: { companyId: ctx.company.id, connectionId: connection.id, kind: "oauth_install" },
        orderBy: { startedAt: "desc" },
      })
    : null;
  const socialAccounts = connection
    ? await prisma.integrationAccount.count({
        where: { companyId: ctx.company.id, connectionId: connection.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
      })
    : 0;
  const credential = connection
    ? await prisma.integrationCredential.findFirst({
        where: { companyId: ctx.company.id, connectionId: connection.id },
        select: { id: true },
      })
    : null;
  const connectionStatus = resolved.connected ? resolved.status : connection?.status ?? null;
  const canonicalLocationId = resolved.connected
    ? resolved.locationId
    : sanitizeHighLevelLocationId(connection?.externalAccountId);
  const currentDiagnostics =
    connection && canonicalLocationId
      ? await ensureCurrentHighLevelDiagnostics(prisma, ctx.company.id, {
          connectionId: connection.id,
          canonicalLocationId,
          connected: resolved.connected,
          lastConversations: lastConversationsDiagnostic,
          lastTokenType: lastTokenTypeDiagnostic,
        })
      : { conversations: null, tokenType: null };
  const publicConnection = publicHighLevelConnectionView({
    status: connectionStatus ?? connection?.status,
    externalAccountId: canonicalLocationId ?? connection?.externalAccountId,
    accountLabel: connection?.accountLabel,
    hasCredential: Boolean(credential),
    companyEmail: ctx.company.email,
    userEmail: ctx.user.email,
  });
  const oauth = highlevelOAuthNotes();
  const isConnected = resolved.connected;
  const authenticated = Boolean(isConnected || credential);
  const conversationsDiagnostic = currentDiagnostics.conversations;
  const settingsHealth = highlevelSettingsHealth({
    authenticated,
    operationalTokens: isConnected,
    connectionStatus: connectionStatus ?? connection?.status ?? "NOT_CONNECTED",
    testGrant: Boolean(testGrant),
    diagnostic: conversationsDiagnostic,
    canonicalLocationId,
    socialAccounts,
  });
  const connectionHealthStatus = settingsHealth.headerStatus;
  const wrongWorkspace =
    !isConnected &&
    (/865\s*hvac/i.test(ctx.company.businessName) || ctx.user.email.toLowerCase() === "owner@865hvac.local");
  const capabilities = highlevelCapabilities({
    connected: settingsHealth.operational,
    authenticated,
    scopes: connection?.scopes ?? [],
    verifiedKeys: settingsHealth.verifiedKeys,
    errorKeys: settingsHealth.errorKeys,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          ← Settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">HighLevel</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Platform: ContractorYou. Company: {ctx.company.businessName}. HighLevel is the location-level
          communications provider, not the company name.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {decodeURIComponent(error.replaceAll("+", " "))}
        </p>
      ) : null}
      {wrongWorkspace ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
          This 865 HVAC workspace has no HighLevel location. The Marketplace-connected company is a
          different login. Do not click Connect HighLevel here — that can block the real location. Sign
          out and use the account that already completed Marketplace OAuth.
        </p>
      ) : null}
      {connected ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">HighLevel location connected.</p>
      ) : null}
      {testConnected || testGrant ? (
        <section className="rounded-2xl border-2 border-[var(--cy-orange)] bg-[#fff7f0] p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--cy-orange)]">
            HIGHLEVEL TEST CONNECTION
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">TEST ONLY</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-foreground)]">ContractorYou company</dt>
              <dd className="font-medium">{ctx.company.businessName}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Provider location</dt>
              <dd className="font-medium">
                {testGrant?.accountLabel || testGrant?.ownerCompanyName || "865 HVAC"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Owner company</dt>
              <dd className="font-medium">{testGrant?.ownerCompanyName ?? "865 HVAC"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Mode</dt>
              <dd className="font-medium">{testGrant?.mode ?? "TEST ONLY"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            This is not {ctx.company.businessName}&apos;s production HighLevel location.{" "}
            {testGrant?.ownerCompanyName ?? "865 HVAC"} remains the owner. ContractorYou will not import that
            company&apos;s contacts, customers, conversations, leads, or history from this grant.
          </p>
        </section>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Connection</CardTitle>
          <StatusBadge status={connectionHealthStatus} />
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted-foreground)]">ContractorYou company</dt>
              <dd>{ctx.company.businessName}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">HighLevel location</dt>
              <dd>{connection?.accountLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Location ID</dt>
              <dd className="break-all">{publicConnection.locationId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Private Integration Token</dt>
              <dd>{publicConnection.tokenStored ? "Stored securely" : "Not stored"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Auth mode</dt>
              <dd>
                {connection
                  ? highlevelAuthMode(connection.scopes) === "oauth"
                    ? "Marketplace OAuth"
                    : "Private location token (testing)"
                  : "Not connected"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Connected</dt>
              <dd>{connection?.updatedAt ? formatDateTime(connection.updatedAt, ctx.company.timezone) : "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Last successful sync</dt>
              <dd>{connection?.lastSyncAt ? formatDateTime(connection.lastSyncAt, ctx.company.timezone) : "Never"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Last webhook</dt>
              <dd>{lastEvent ? `${lastEvent.eventType} · ${formatDateTime(lastEvent.receivedAt, ctx.company.timezone)}` : "None"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Failed events</dt>
              <dd>{failedEvents}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Records mapped</dt>
              <dd>{mapped}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Last communications sync</dt>
              <dd>
                {lastCommsSync?.finishedAt
                  ? `${formatDateTime(lastCommsSync.finishedAt, ctx.company.timezone)} · ${commsSummaryText(
                      lastCommsSync.summary,
                      `${lastCommsSync.recordsIn} conversations / ${lastCommsSync.recordsOut} messages`
                    )}`
                  : "Never"}
              </dd>
            </div>
          </dl>
          {connection?.healthMessage ? (
            <p className="text-[var(--muted-foreground)]">{connection.healthMessage}</p>
          ) : null}
          {connection?.errorMessage ? <p className="text-rose-700">{connection.errorMessage}</p> : null}
          {lastOauthInstall?.summary ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--cy-gray)] px-3 py-2 text-xs text-[var(--cy-navy)]">
              {formatOauthInstallDiagnostic(lastOauthInstall.summary as FreshOauthLocationResolution & {
                authorizeUrlHasLocationId?: boolean | null;
              })}
            </pre>
          ) : null}
          {currentDiagnostics.tokenType ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--cy-gray)] px-3 py-2 text-xs text-[var(--cy-navy)]">
              {formatTokenTypeDiagnostic(currentDiagnostics.tokenType)}
            </pre>
          ) : null}
          {currentDiagnostics.conversations ? (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--cy-gray)] px-3 py-2 text-xs text-[var(--cy-navy)]">
              {formatConversationsDiagnostic(currentDiagnostics.conversations)}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {capabilities.map((capability) => (
              <li key={capability.key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span>{capability.label}</span>
                <StatusBadge status={formatHighLevelCapabilityStatus(capability.status)} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            CONNECTED is shown only after a live HighLevel API verification succeeds. Stored credentials alone
            are not an operational connection. AVAILABLE means the authorized scopes include that capability.
          </p>
        </CardContent>
      </Card>

      <ConversationOwnerForm value={parseCustomerConversationOwner(ctx.company.customerConversationOwner)} />
      <ReceptionistSettingsForm settings={await loadReceptionistSettings(ctx.company.id)} />
      <AgentToolSettings
        keys={agentToolKeys.map((row) => ({
          id: row.id,
          lastFour: row.lastFour,
          lastUsedAt: row.lastUsedAt ? formatDateTime(row.lastUsedAt) : null,
          createdAt: formatDateTime(row.createdAt),
        }))}
        recentCalls={agentToolCalls.map((row) => ({
          id: row.id,
          tool: row.tool,
          success: row.success,
          errorCode: row.errorCode,
          customerId: row.customerId,
          jobId: row.jobId,
          createdAt: formatDateTime(row.createdAt),
        }))}
      />

      <HighLevelSettingsForm
        oauthReady={highlevelOAuthConfigured()}
        connected={Boolean(isConnected)}
        missing={oauth.missing}
        webhookUrl={highlevelWebhookUrl()}
        storedLocationId={publicConnection.locationId}
        storedLocationName={publicConnection.locationName}
        tokenStored={publicConnection.tokenStored}
        sandboxOAuth={sandboxEnabled}
        testOnly={Boolean(testGrant)}
      />

      <Card>
        <CardHeader>
          <CardTitle>Advanced HighLevel settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-[var(--muted-foreground)]">
            Campaigns, funnels, and workflow builders stay in HighLevel. Daily work stays in ContractorYou.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={HIGHLEVEL_DEEP_LINKS.workflows} className="underline" target="_blank" rel="noreferrer">
              Manage workflows in HighLevel
            </a>
            <a href={HIGHLEVEL_DEEP_LINKS.campaigns} className="underline" target="_blank" rel="noreferrer">
              Manage campaigns in HighLevel
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
