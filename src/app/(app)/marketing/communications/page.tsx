import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";

export default async function CommunicationsPage() {
  const ctx = await requirePermission("marketing:view");
  const connection = await prisma.integrationConnection.findFirst({
    where: { companyId: ctx.company.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
  });
  const threads = await prisma.communicationThread.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { lastActivityAt: "desc" },
    take: 80,
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
      lead: { select: { id: true, firstName: true, lastName: true, source: true } },
    },
  });
  const connected = connection?.status === "CONNECTED";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Communications</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            ContractorYou inbox over HighLevel. Historical conversations appear after Sync communications.
            New messages arrive from webhooks after that.
          </p>
        </div>
        <Link href="/settings/highlevel" className={cn(buttonVariants({ variant: "outline" }))}>
          HighLevel settings
        </Link>
      </header>

      {!connected ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-6 text-sm text-[var(--muted-foreground)]">
          HighLevel is not connected. Settings → HighLevel. Direct Twilio is not required.
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">Inbox</h2>
        </div>
        {threads.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--muted-foreground)]">
            {connected
              ? "No conversations are stored yet. Settings → HighLevel → Sync communications. That fetch is read-only and does not send messages."
              : "Connect HighLevel to load conversations."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {threads.map((thread) => {
              const name = thread.customer
                ? thread.customer.businessName || `${thread.customer.firstName} ${thread.customer.lastName}`
                : thread.contactName || thread.phone || thread.email || "Unknown contact";
              return (
                <li key={thread.id}>
                  <Link href={`/marketing/communications/${thread.id}`} className="block px-4 py-3 hover:bg-[var(--cy-gray)]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {name}
                          {thread.unread ? <span className="ml-2 text-xs text-[var(--cy-orange)]">Unread</span> : null}
                        </p>
                        <p className="text-sm text-[var(--muted-foreground)]">
                          {thread.channel} · {thread.phone || thread.email || "No contact detail"}
                          {thread.lead ? ` · Lead ${thread.lead.source}` : thread.customerId ? " · Customer" : " · Unmatched"}
                        </p>
                        <p className="mt-1 text-sm">{thread.lastPreview || "No preview"}</p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={thread.channel} />
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                          {thread.lastActivityAt.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
