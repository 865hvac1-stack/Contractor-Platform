import Link from "next/link";
import { endOfDay, startOfDay } from "date-fns";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { customerLabel } from "@/lib/tech/today";
import { CompanySmsForm } from "@/components/highlevel/company-sms-form";
import { isDemoCompany } from "@/lib/demo/guard";
import { formatCallDurationLabel } from "@/lib/highlevel/webhook-log";

const COMM_FILTERS = [
  { id: "inbox", label: "Inbox" },
  { id: "today", label: "Today's calls" },
  { id: "missed", label: "Missed" },
] as const;

type MessageMeta = {
  callDuration?: number | null;
  callStatus?: string | null;
  trackingSource?: string | null;
  trackingNumber?: string | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  hasRecording?: boolean;
};

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; compose?: string; customerId?: string; to?: string }>;
}) {
  const ctx = await requirePermission("marketing:view");
  const params = await searchParams;
  const filter = params.filter?.trim() || "inbox";
  const composeCustomerId = params.customerId?.trim() || "";
  const composeTo = params.to?.trim() || "";
  const dayStart = startOfDay(new Date());
  const dayEnd = endOfDay(new Date());
  const connection = await prisma.integrationConnection.findFirst({
    where: { companyId: ctx.company.id, providerKey: HIGHLEVEL_PROVIDER_KEY },
  });
  const threads = await prisma.communicationThread.findMany({
    where: {
      companyId: ctx.company.id,
      ...(filter === "today" ? { lastActivityAt: { gte: dayStart, lte: dayEnd } } : {}),
    },
    orderBy: { lastActivityAt: "desc" },
    take: 80,
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
      lead: { select: { id: true, firstName: true, lastName: true, source: true } },
      messages: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
  });
  const connected = connection?.status === "CONNECTED";
  const loadCalls = filter === "inbox" || filter === "today" || filter === "missed";
  const calls = loadCalls
    ? await prisma.callRecord.findMany({
        where: {
          companyId: ctx.company.id,
          ...(filter === "missed" ? { missed: true, booked: { not: true } } : { startedAt: { gte: dayStart, lte: dayEnd } }),
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
          lead: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 80,
      })
    : [];
  const callThreadRows =
    calls.length > 0
      ? await prisma.communicationMessage.findMany({
          where: {
            companyId: ctx.company.id,
            provider: HIGHLEVEL_PROVIDER_KEY,
            externalId: { in: calls.map((call) => call.recordingRef).filter((value): value is string => Boolean(value)) },
          },
          select: { externalId: true, threadId: true },
        })
      : [];
  const threadByMessageId = new Map(callThreadRows.map((row) => [row.externalId, row.threadId]));
  const composeCustomer = composeCustomerId
    ? await prisma.customer.findFirst({
        where: { id: composeCustomerId, companyId: ctx.company.id },
        select: { id: true, phone: true, firstName: true, lastName: true, businessName: true },
      })
    : null;
  const smsTo = composeTo || composeCustomer?.phone || "";
  const demoCompany = await isDemoCompany(ctx.company.id);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--cy-navy)]">Communications</h1>
          <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
            ContractorYou inbox over HighLevel. Historical conversations appear after Sync communications.
            New inbound calls arrive from the HighLevel webhook.
          </p>
        </div>
        <Link href="/settings/highlevel" className={cn(buttonVariants({ variant: "outline" }))}>
          HighLevel settings
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        {COMM_FILTERS.map((item) => (
          <Link
            key={item.id}
            href={item.id === "inbox" ? "/marketing/communications" : `/marketing/communications?filter=${item.id}`}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === item.id
                ? "bg-[var(--cy-navy)] text-white"
                : "bg-white text-[var(--cy-navy)] ring-1 ring-[var(--border)]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {smsTo ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Company text
          </p>
          <h2 className="mt-1 font-semibold text-[var(--cy-navy)]">
            {composeCustomer ? customerLabel(composeCustomer) : smsTo}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Sends through HighLevel from the approved sender number. Not a personal device SMS.
          </p>
          <CompanySmsForm
            to={smsTo}
            customerId={composeCustomer?.id}
            requireLiveConfirm={demoCompany}
          />
        </section>
      ) : null}

      {!connected ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-6 text-sm text-[var(--muted-foreground)]">
          HighLevel is not connected. Settings → HighLevel. Direct Twilio is not required.
        </p>
      ) : null}

      {calls.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="border-b px-4 py-3">
            <h2 className="font-medium">{filter === "missed" ? "Missed calls" : "Calls"}</h2>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {calls.map((call) => {
              const threadId = call.recordingRef ? threadByMessageId.get(call.recordingRef) : null;
              const href = threadId
                ? `/marketing/communications/${threadId}`
                : call.customer
                  ? `/office/customers/${call.customer.id}`
                  : null;
              const duration = formatCallDurationLabel(call.durationSeconds);
              const name = call.customer
                ? customerLabel(call.customer)
                : call.lead
                  ? `${call.lead.firstName} ${call.lead.lastName}`.trim()
                  : call.caller || "Unknown caller";
              const status = call.missed ? "Missed" : call.answered ? "Answered" : call.direction;
              const inner = (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      Inbound Call
                      {call.caller ? ` · ${call.caller}` : ""}
                      {call.source ? ` · ${call.source}` : ""}
                      {call.trackingNumber ? ` · ${call.trackingNumber}` : ""}
                      {status ? ` · ${status}` : ""}
                      {duration ? ` · ${duration}` : ""}
                      {call.recordingRef ? " · Recording on file" : ""} · {call.startedAt.toLocaleString()}
                    </p>
                  </div>
                  {call.customer ? (
                    <span className="text-sm text-[var(--cy-orange)]">Customer 360</span>
                  ) : null}
                </div>
              );
              return (
                <li key={call.id} className="px-4 py-3">
                  {href ? (
                    <Link href={href} className="block hover:opacity-90">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : filter === "missed" || filter === "today" ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-white px-4 py-6 text-sm text-[var(--muted-foreground)]">
          {filter === "missed" ? "No open missed-call records." : "No calls recorded today."}
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
              const latest = thread.messages[0];
              const meta = (latest?.metadata ?? {}) as MessageMeta;
              const isCall = thread.channel === "CALL" || latest?.kind === "CALL" || latest?.kind === "VOICEMAIL";
              const duration = formatCallDurationLabel(meta.callDuration);
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
                          {isCall ? "Inbound Call" : thread.channel}
                          {thread.phone ? ` · ${thread.phone}` : thread.email ? ` · ${thread.email}` : " · No contact detail"}
                          {meta.trackingSource ? ` · ${meta.trackingSource}` : ""}
                          {latest?.status ? ` · ${latest.status}` : ""}
                          {duration ? ` · ${duration}` : ""}
                          {thread.customerId
                            ? " · Customer"
                            : thread.lead
                              ? ` · Lead ${thread.lead.source}`
                              : thread.externalContactId
                                ? " · HighLevel-only contact"
                                : " · Unmatched"}
                        </p>
                        <p className="mt-1 text-sm">{thread.lastPreview || "No preview"}</p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={isCall ? "Inbound Call" : thread.channel} />
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
