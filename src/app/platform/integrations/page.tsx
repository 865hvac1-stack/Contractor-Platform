import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { getIntegrationReadiness, getOAuthCallbackDocs } from "@/lib/integrations/readiness";
import { StatusBadge } from "@/components/status-badge";

export default async function PlatformIntegrationsPage() {
  await requirePlatformAdmin();
  const rows = getIntegrationReadiness();
  const docs = getOAuthCallbackDocs();

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
