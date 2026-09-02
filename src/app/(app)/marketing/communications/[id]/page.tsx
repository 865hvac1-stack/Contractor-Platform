import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { isHighLevelConnected } from "@/lib/highlevel/connection";
import { CompanySmsForm } from "@/components/highlevel/company-sms-form";
import { StatusBadge } from "@/components/status-badge";
import { formatCallDurationLabel } from "@/lib/highlevel/webhook-log";

export default async function CommunicationThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("marketing:view");
  const thread = await prisma.communicationThread.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      customer: true,
      lead: true,
      messages: { orderBy: { occurredAt: "asc" }, take: 200 },
    },
  });
  if (!thread) notFound();

  const jobs = thread.customerId
    ? await prisma.job.findMany({
        where: { companyId: ctx.company.id, customerId: thread.customerId },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { id: true, jobNumber: true, status: true, jobType: true },
      })
    : [];
  const highlevel = await isHighLevelConnected(prisma, ctx.company.id);
  const name = thread.customer
    ? thread.customer.businessName || `${thread.customer.firstName} ${thread.customer.lastName}`
    : thread.contactName || thread.phone || thread.email || "Unknown contact";

  return (
    <div className="space-y-6">
      <Link href="/marketing/communications" className="text-sm text-[var(--muted-foreground)] hover:underline">
        ← Inbox
      </Link>
      <header className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--cy-navy)]">{name}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {thread.channel} · {thread.phone || thread.email || "No phone or email"}
            </p>
            {thread.customer ? (
              <Link href={`/customers/${thread.customer.id}`} className="mt-2 inline-block text-sm underline">
                Open customer
              </Link>
            ) : thread.lead ? (
              <Link href={`/marketing/leads/${thread.lead.id}`} className="mt-2 inline-block text-sm underline">
                Open lead
              </Link>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                HighLevel-only conversation. It is visible without a ContractorYou customer match.
              </p>
            )}
          </div>
          <StatusBadge status={thread.channel} />
        </div>
        {jobs.length ? (
          <ul className="mt-3 text-sm">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="underline">
                  {job.jobNumber}
                </Link>{" "}
                · {job.status}
                {job.jobType ? ` · ${job.jobType}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <section className="space-y-3">
        {thread.messages.length === 0 ? (
          <p className="rounded-2xl border bg-white px-4 py-6 text-sm text-[var(--muted-foreground)]">
            This conversation was found, but HighLevel did not return message bodies.
          </p>
        ) : (
          thread.messages.map((message) => {
            const outbound = message.direction === "OUTBOUND";
            const metadata = (message.metadata ?? {}) as {
              hasRecording?: boolean;
              recordingUrl?: string | null;
              callDuration?: number | null;
              callStatus?: string | null;
              trackingSource?: string | null;
              trackingNumber?: string | null;
              fromNumber?: string | null;
              toNumber?: string | null;
            };
            const isCall = message.kind === "CALL" || message.kind === "VOICEMAIL" || message.channel === "CALL";
            const hasRecording = Boolean(metadata.hasRecording) || metadata.recordingUrl === "available";
            const duration = formatCallDurationLabel(metadata.callDuration);
            return (
              <article
                key={message.id}
                className={`max-w-2xl rounded-2xl border px-4 py-3 ${outbound ? "ml-auto bg-[var(--cy-navy)] text-white" : "bg-white"}`}
              >
                <p className={`text-xs ${outbound ? "text-white/70" : "text-[var(--muted-foreground)]"}`}>
                  {outbound ? "Outbound" : "Inbound"} · {isCall ? "Inbound Call" : message.channel}
                  {metadata.callStatus || message.status ? ` · ${metadata.callStatus || message.status}` : ""}
                  {duration ? ` · ${duration}` : ""}
                  {metadata.trackingSource ? ` · ${metadata.trackingSource}` : ""}
                  {" · "}
                  {message.occurredAt.toLocaleString()}
                </p>
                {metadata.fromNumber || metadata.toNumber ? (
                  <p className={`mt-1 text-xs ${outbound ? "text-white/70" : "text-[var(--muted-foreground)]"}`}>
                    {metadata.fromNumber ? `From ${metadata.fromNumber}` : ""}
                    {metadata.fromNumber && metadata.toNumber ? " · " : ""}
                    {metadata.toNumber ? `To ${metadata.toNumber}` : ""}
                    {metadata.trackingNumber && metadata.trackingNumber !== metadata.toNumber
                      ? ` · Tracking ${metadata.trackingNumber}`
                      : ""}
                  </p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {message.body || (isCall ? "Inbound call" : `${message.kind} event`)}
                </p>
                {hasRecording ? (
                  <p className={`mt-2 text-xs ${outbound ? "text-white/80" : "text-[var(--muted-foreground)]"}`}>
                    Recording on file in HighLevel. ContractorYou does not store or open the provider URL.
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      {highlevel && thread.phone ? (
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="font-medium">Reply by SMS</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Sends through HighLevel only. Twilio is not used while HighLevel is the communications provider.
          </p>
          <CompanySmsForm to={thread.phone} customerId={thread.customerId} leadId={thread.leadId} />
        </section>
      ) : highlevel ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          This thread has no phone number, so ContractorYou will not send SMS.
        </p>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">Connect HighLevel to reply from the company number.</p>
      )}
    </div>
  );
}
