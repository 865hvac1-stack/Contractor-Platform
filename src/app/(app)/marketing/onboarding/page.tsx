import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { getChannelCards } from "@/lib/integrations/connections";
import { StatusBadge } from "@/components/status-badge";

const STEPS = [
  { title: "Google", keys: ["google_business_profile", "google_ads", "google_lsa", "google_analytics", "google_search_console"] },
  { title: "Meta", keys: ["facebook", "instagram", "meta_ads"] },
  { title: "Website", keys: ["website_forms", "landing_pages", "utm_tracking"] },
  { title: "Phone", keys: ["business_phone", "sms", "tracking_numbers"] },
  { title: "Email", keys: ["email"] },
  { title: "Other social", keys: ["tiktok", "linkedin", "youtube"] },
];

export default async function MarketingOnboardingPage() {
  const ctx = await requirePermission("marketing:view");
  const cards = await getChannelCards(ctx.company.id);
  const byKey = new Map(cards.map((card) => [card.provider.key, card]));
  const complete = STEPS.filter((step) =>
    step.keys.some((key) => {
      const status = byKey.get(key)?.status;
      return status === "CONNECTED" || status === "SYNCING" || status === "SELECT_ACCOUNT";
    })
  ).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-[var(--cy-navy)]">Connect your marketing</h1>
        <p className="mt-2 text-[var(--muted-foreground)]">
          {complete} of {STEPS.length} core channels started. Connect only what you actually use.
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--cy-gray)]">
          <div
            className="h-full bg-[var(--cy-orange)]"
            style={{ width: `${Math.round((complete / STEPS.length) * 100)}%` }}
          />
        </div>
      </header>
      <ol className="space-y-4">
        {STEPS.map((step, index) => {
          const connected = step.keys.some((key) => byKey.get(key)?.status === "CONNECTED");
          return (
            <li key={step.title} className="rounded-2xl border bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[var(--cy-navy)]">
                  Step {index + 1}: {step.title}
                </h2>
                <StatusBadge status={connected ? "CONNECTED" : "NOT_CONNECTED"} />
              </div>
              <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                {step.keys.map((key) => {
                  const card = byKey.get(key);
                  return (
                    <li key={key}>
                      <Link href={`/marketing/channels/${key}`} className="underline">
                        {card?.provider.name ?? key}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
