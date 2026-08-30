import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function CommunicationsPage() {
  await requirePermission("marketing:view");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">
          Communications
        </h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          Inbox for phone, SMS, email, and website chat. Coming soon — we will not simulate
          conversations or send messages.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {[
          {
            title: "Business phone",
            body: "Call tracking, missed-call alerts, and recordings when a telephony provider is plugged in.",
          },
          {
            title: "SMS",
            body: "Two-way text and lead response time. Required before automations can text a customer.",
          },
          {
            title: "Email",
            body: "Estimate follow-up and reactivation campaigns with booked / sold outcomes.",
          },
          {
            title: "Website chat",
            body: "Normalize chat into the same lead pipeline as Google and Meta.",
          },
        ].map((item) => (
          <article key={item.title} className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-[var(--cy-navy)]">{item.title}</h2>
              <span className="rounded bg-[var(--cy-gray)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--cy-text-muted)]">
                Coming soon
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.body}</p>
          </article>
        ))}
      </div>

      <Link href="/marketing/channels" className={cn(buttonVariants(), "inline-flex")}>
        View channel connections
      </Link>
    </div>
  );
}
