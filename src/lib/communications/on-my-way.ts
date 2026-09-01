import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { renderMergeFields, type MergeContext } from "@/lib/playbooks/merge-fields";
import { flattenSteps } from "@/lib/playbooks/types";
import { parseDefinition } from "@/lib/playbooks/engine";
import { resolveCommunicationProvider, sendCompanyCommunication } from "@/lib/comms/provider";
import { isHistoricalImport } from "@/lib/imports/safety";
import { customerLabel } from "@/lib/tech/today";
import { propertyAddress } from "@/lib/tech/access";

/**
 * Send the playbook On My Way SMS only when Communications is actually configured.
 * Never claims delivery. Duplicate sends are blocked by a prior workflow event.
 */
export async function maybeSendOnMyWayMessage(input: {
  companyId: string;
  jobId: string;
  actorId: string;
  actorFirstName: string;
  actorLastName: string;
}) {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId: input.companyId },
    include: {
      customer: true,
      property: true,
      company: true,
      playbookSnapshot: true,
    },
  });
  if (!job) return { attempted: false, sent: false, reason: "no_job" as const };
  if (isHistoricalImport(job.importMode)) {
    return { attempted: false, sent: false, reason: "historical" as const };
  }
  if (!job.playbookSnapshot) return { attempted: false, sent: false, reason: "no_playbook" as const };

  const definition = parseDefinition(job.playbookSnapshot.definition);
  const step = flattenSteps(definition).find((item) => item.actionKey === "ON_MY_WAY");
  const template = step?.message?.channel === "SMS" ? step.message.body : null;
  if (!template) return { attempted: false, sent: false, reason: "no_template" as const };

  const already = await prisma.jobWorkflowEvent.findFirst({
    where: {
      companyId: input.companyId,
      jobId: job.id,
      stepId: step!.id,
      note: { contains: "sms:" },
    },
  });
  if (already) return { attempted: false, sent: false, reason: "already_sent" as const };

  const provider = await resolveCommunicationProvider(input.companyId);
  if (provider === "none") {
    await writeAudit({
      companyId: input.companyId,
      actorId: input.actorId,
      action: "job.on_my_way_sms_skipped",
      entityType: "Job",
      entityId: job.id,
      metadata: { reason: "communications_not_configured" },
    });
    return { attempted: false, sent: false, reason: "not_configured" as const };
  }

  if (!job.customer.phone) {
    await writeAudit({
      companyId: input.companyId,
      actorId: input.actorId,
      action: "job.on_my_way_sms_skipped",
      entityType: "Job",
      entityId: job.id,
      metadata: { reason: "no_customer_phone" },
    });
    return { attempted: true, sent: false, reason: "no_phone" as const };
  }

  const context: MergeContext = {
    "customer.firstName": job.customer.firstName,
    "customer.lastName": job.customer.lastName,
    "customer.fullName": customerLabel(job.customer),
    "company.name": job.company.businessName,
    "company.phone": job.company.phone ?? "",
    "technician.firstName": input.actorFirstName,
    "technician.fullName": `${input.actorFirstName} ${input.actorLastName}`.trim(),
    "job.date": job.scheduledStart ? job.scheduledStart.toLocaleDateString() : "",
    "job.time": job.scheduledStart
      ? job.scheduledStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "",
    "job.arrivalWindow": job.arrivalWindowStart
      ? job.arrivalWindowStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "",
    "property.address": propertyAddress(job.property),
  };
  const body = renderMergeFields(template, context);
  const result = await sendCompanyCommunication({
    companyId: input.companyId,
    channel: "SMS",
    to: job.customer.phone,
    body,
    customerId: job.customerId,
  });

  await writeAudit({
    companyId: input.companyId,
    actorId: input.actorId,
    action: result.ok ? "job.on_my_way_sms_sent" : "job.on_my_way_sms_failed",
    entityType: "Job",
    entityId: job.id,
    metadata: result.ok
      ? { provider: result.provider }
      : { configured: result.configured, error: result.error, provider: result.provider },
  });

  if (result.ok && step) {
    await prisma.jobWorkflowEvent.create({
      data: {
        companyId: input.companyId,
        jobId: job.id,
        stepId: step.id,
        actorId: input.actorId,
        kind: "MESSAGE",
        note: `sms:sent`,
      },
    });
  }

  return result.ok
    ? { attempted: true, sent: true, reason: "sent" as const }
    : { attempted: true, sent: false, reason: "provider_failed" as const };
}
