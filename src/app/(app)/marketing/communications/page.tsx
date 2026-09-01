import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InboxReplyForm } from "@/components/highlevel/inbox-reply-form";

export default async function CommunicationsPage() {
  const ctx = await requirePermission("marketing:view");
  const connection = await prisma.integrationConnection.findFirst({
    where: { companyId: ctx.company.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
  });
  const threads = await prisma.communicationThread.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { lastActivityAt: "desc" },
    take: 40,
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
      lead: { select: { id: true, firstName: true, lastName: true, source: true } },
      messages: { orderBy: { occurredAt: "desc" }, take: 8 },
    },
  });
  const calls = await prisma.callRecord.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Communications</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            ContractorYou inbox over HighLevel conversations. Messages are not invented. Connect HighLevel
            to see texts, calls, and missed-call results.
          </p>
        </div>
        <Link href="/settings/highlevel" className={cn(buttonVariants({ variant: "outline" }))}>
          HighLevel settings
        </Link>
      </header>

      {connection?.status !== "CONNECTED" ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-6 text-sm text-[var(--muted-foreground)]">
          HighLevel is not connected. Settings → HighLevel. Direct Twilio is not required when HighLevel is
          the communications provider.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">Inbox</h2>
        {threads.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No conversations have been received yet. After HighLevel webhooks are configured, inbound SMS
            and call events appear here.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border bg-white">
            {threads.map((thread) => (
              <li key={thread.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {thread.customer
                        ? thread.customer.businessName ||
                          `${thread.customer.firstName} ${thread.customer.lastName}`
                        : thread.contactName || thread.phone || "Unknown"}
                    </p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {thread.channel} · {thread.phone || "No phone"} ·{" "}
                      {thread.lead ? `Lead · ${thread.lead.source}` : thread.customerId ? "Customer" : "Unmatched"}
                    </p>
                    <p className="mt-1 text-sm">{thread.lastPreview}</p>
                  </div>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {thread.lastActivityAt.toLocaleString()}
                  </span>
                </div>
                {thread.phone ? (
                  <InboxReplyForm
                    to={thread.phone}
                    customerId={thread.customerId}
                    leadId={thread.leadId}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Recent calls</h2>
        {calls.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No HighLevel call events have been ingested. Browser calling is not implemented.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {calls.map((call) => (
              <li key={call.id} className="rounded-xl border bg-white px-4 py-3">
                {call.missed ? "Missed call" : call.answered ? "Answered call" : "Call"} ·{" "}
                {call.caller || "Unknown"} · {call.startedAt.toLocaleString()}
                {call.missed ? " · Missed-call recovery stays in HighLevel workflows" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
