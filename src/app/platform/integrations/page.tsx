import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getIntegrationReadiness, getOAuthCallbackDocs } from "@/lib/integrations/readiness";
import { StatusBadge } from "@/components/status-badge";
import { missingStripeEnvVars, stripeConfigured, stripeModeLabel, stripeWebhookConfigured } from "@/lib/payments/config";
import { appUrl } from "@/lib/payments/config";

export default async function PlatformIntegrationsPage() {
  await requirePlatformAdmin();
  const rows = getIntegrationReadiness();
  const docs = getOAuthCallbackDocs();
  const [connected, restricted, webhookRecent] = await Promise.all([
    prisma.stripeConnectAccount.count({ where: { onboardingStatus: "CONNECTED", disabledAt: null } }),
    prisma.stripeConnectAccount.count({
      where: { onboardingStatus: { in: ["ACTION_REQUIRED", "RESTRICTED"] }, disabledAt: null },
    }),
    prisma.stripeWebhookEvent.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform" className="text-sm text-[var(--muted-foreground)]">
          ← Companies
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Integration readiness</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Credential presence only — values are never shown.
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5 text-sm">
        <h2 className="font-medium">ContractorYou Payments (Stripe)</h2>
        <p className="mt-1 text-[var(--muted-foreground)]">
          Credential presence and connected-account counts only. Bank details are never shown here.
        </p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>Stripe secret: {stripeConfigured() ? "present" : "missing"}</div>
          <div>Webhook secret: {stripeWebhookConfigured() ? "present" : "missing"}</div>
          <div>Mode: {stripeModeLabel()}</div>
          <div>Webhook URL: {appUrl()}/api/webhooks/stripe</div>
          <div>Connected companies: {connected}</div>
          <div>Restricted / action required: {restricted}</div>
          <div>Webhook events (24h): {webhookRecent}</div>
          <div>Missing: {missingStripeEnvVars().join(", ") || "none"}</div>
        </dl>
      </section>

      <section className="rounded-2xl border bg-white p-5 text-sm">
        <h2 className="font-medium">OAuth callback URIs</h2>
        <ul className="mt-2 space-y-1 break-all">
          <li>Google: {docs.google}</li>
          <li>Meta: {docs.meta}</li>
          <li>TikTok: {docs.tiktok}</li>
          <li>LinkedIn: {docs.linkedin}</li>
          <li>Encryption key: {docs.encryptionConfigured ? "present" : "missing"}</li>
        </ul>
      </section>

      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b text-xs uppercase text-[var(--muted-foreground)]">
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Implementation</th>
              <th className="px-4 py-3">Credentials</th>
              <th className="px-4 py-3">Missing</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{row.provider}</td>
                <td className="px-4 py-3">{row.implementation}</td>
                <td className="px-4 py-3">{row.credentialsPresent ? "Configured" : "Missing"}</td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {row.missing.join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status.replaceAll(" ", "_")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
