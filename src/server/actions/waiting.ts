"use server";

import { revalidatePath } from "next/cache";
import type { WaitingCadence } from "@prisma/client";
import { AuthError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { jobAccessFilter, requirePermission } from "@/lib/tenant";
import type { ActionResult } from "@/server/actions/auth";
import { columnKeyFromName, ensureWaitingSetup } from "@/lib/waiting/columns";
import { sendWaitingCommunication } from "@/lib/waiting/messages";
import {
  addWaitingNote,
  createWaitingRecord,
  resolveWaitingRecord,
  transitionWaitingRecord,
  updateWaitingRecord,
} from "@/lib/waiting/records";
import { parseWaitingMetadata, type WaitingMetadata } from "@/lib/waiting/types";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

function revalidateWaiting(jobId?: string, customerId?: string) {
  revalidatePath("/operations/waiting");
  revalidatePath("/actions");
  revalidatePath("/dashboard");
  revalidatePath("/settings/waiting");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

async function requireWaitingMutation(jobId?: string | null) {
  const ctx = await requirePermission("jobs:view");
  const office = can(ctx.role, "jobs:manage");
  if (office) return { ctx, assignedOnly: false };
  if (!can(ctx.role, "jobs:field_status")) {
    throw new AuthError("Insufficient permissions", 403);
  }
  if (!jobId) throw new AuthError("Insufficient permissions", 403);
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId: ctx.company.id, ...jobAccessFilter(ctx.role, ctx.user.id) },
    select: { id: true },
  });
  if (!job) throw new AuthError("You can only update assigned jobs.", 403);
  return { ctx, assignedOnly: true };
}

function dateOrNull(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cadenceOf(value: FormDataEntryValue | null): WaitingCadence | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const allowed: WaitingCadence[] = ["DAILY", "EVERY_2_DAYS", "EVERY_3_DAYS", "WEEKLY", "CUSTOM", "MANUAL"];
  return allowed.includes(raw as WaitingCadence) ? (raw as WaitingCadence) : undefined;
}

function metadataFromForm(form: FormData, columnKey?: string | null): WaitingMetadata {
  const waitingFor = String(form.get("waitingFor") ?? "").trim();
  const meta: WaitingMetadata = {
    waitingFor: waitingFor || undefined,
    vendor: String(form.get("vendor") ?? "").trim() || undefined,
    poNumber: String(form.get("poNumber") ?? "").trim() || undefined,
    dateOrdered: String(form.get("dateOrdered") ?? "").trim() || undefined,
    reminderFrequency: String(form.get("reminderFrequency") ?? "").trim() || undefined,
  };
  if (!columnKey || columnKey === "WAITING_ON_PART") {
    const name = String(form.get("partName") ?? "").trim() || waitingFor;
    if (name || form.get("partNumber") || form.get("vendor")) {
      const cost = Number(String(form.get("partCost") ?? "").replace(/[^0-9.]/g, ""));
      meta.part = {
        name: name || undefined,
        partNumber: String(form.get("partNumber") ?? "").trim() || undefined,
        quantity: String(form.get("quantity") ?? "").trim() || undefined,
        vendor: String(form.get("vendor") ?? "").trim() || undefined,
        poNumber: String(form.get("poNumber") ?? "").trim() || undefined,
        orderedAt: String(form.get("dateOrdered") ?? "").trim() || undefined,
        notes: String(form.get("partNotes") ?? "").trim() || undefined,
        costCents: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 100) : undefined,
      };
    }
  }
  if (columnKey === "WAITING_ON_WARRANTY") {
    meta.warranty = {
      manufacturer: String(form.get("manufacturer") ?? "").trim() || undefined,
      claimNumber: String(form.get("claimNumber") ?? "").trim() || undefined,
      submittedAt: String(form.get("submittedAt") ?? "").trim() || undefined,
      expectedResponseAt: String(form.get("expectedResolutionAt") ?? "").trim() || undefined,
      notes: String(form.get("warrantyNotes") ?? "").trim() || undefined,
    };
  }
  if (columnKey === "WAITING_ON_CUSTOMER") {
    meta.customerWait = {
      needed: waitingFor || undefined,
      deadlineAt: String(form.get("deadlineAt") ?? "").trim() || undefined,
    };
  }
  if (columnKey === "WAITING_ON_APPROVAL") {
    const amount = Number(String(form.get("approvalAmount") ?? "").replace(/[^0-9.]/g, ""));
    meta.approval = {
      estimateNumber: String(form.get("estimateNumber") ?? "").trim() || undefined,
      amountCents: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined,
      sentAt: String(form.get("sentAt") ?? "").trim() || undefined,
    };
  }
  if (columnKey === "WAITING_ON_THIRD_PARTY") {
    meta.thirdParty = {
      party: String(form.get("thirdParty") ?? "").trim() || waitingFor || undefined,
      contact: String(form.get("thirdPartyContact") ?? "").trim() || undefined,
      reference: String(form.get("thirdPartyReference") ?? "").trim() || undefined,
      expectedResponseAt: String(form.get("expectedResolutionAt") ?? "").trim() || undefined,
      notes: String(form.get("thirdPartyNotes") ?? "").trim() || undefined,
    };
  }
  return meta;
}

export async function putJobInWaitingAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const jobId = String(formData.get("jobId") ?? "");
    const { ctx } = await requireWaitingMutation(jobId);
    const columnId = String(formData.get("columnId") ?? "");
    if (!jobId || !columnId) return { ok: false, error: "Choose a job and a waiting status." };
    const column = await prisma.waitingColumn.findFirst({
      where: { id: columnId, companyId: ctx.company.id },
    });
    if (!column) return { ok: false, error: "Waiting status not found." };
    const record = await createWaitingRecord({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      jobId,
      columnId,
      reason: String(formData.get("reason") ?? "").trim() || column.name,
      notes: String(formData.get("notes") ?? "").trim() || null,
      assignedOwnerUserId: String(formData.get("assignedOwnerUserId") ?? "").trim() || ctx.user.id,
      cadence: cadenceOf(formData.get("cadence")),
      customCadenceDays: Number(formData.get("customCadenceDays") || 0) || null,
      communicationEnabled: formData.get("communicationEnabled") !== "no",
      expectedResolutionAt: dateOrNull(formData.get("expectedResolutionAt")),
      metadata: metadataFromForm(formData, column.key),
      sendInitial: formData.get("communicationEnabled") !== "no",
    });
    revalidateWaiting(record.jobId, record.customerId);
    return { ok: true, message: `Moved to ${column.name}.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not put this job in waiting." };
  }
}

export async function transitionWaitingAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const recordId = String(formData.get("recordId") ?? "");
    const existing = await prisma.waitingRecord.findFirst({
      where: { id: recordId },
      select: { companyId: true, jobId: true, customerId: true },
    });
    if (!existing) return { ok: false, error: "Waiting record not found." };
    const { ctx } = await requireWaitingMutation(existing.jobId);
    if (existing.companyId !== ctx.company.id) return { ok: false, error: "Waiting record not found." };
    const toColumnId = String(formData.get("toColumnId") ?? "");
    if (!toColumnId) return { ok: false, error: "Choose the next waiting status." };
    await transitionWaitingRecord({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      recordId,
      toColumnId,
      note: String(formData.get("note") ?? "").trim() || null,
      actions: {
        stopUpdates: formData.get("stopUpdates") !== "no",
        notifyCustomer: formData.get("notifyCustomer") === "yes",
        createSchedulingTask: formData.get("createSchedulingTask") === "yes",
        markPartArrived: formData.get("markPartArrived") === "yes",
      },
    });
    revalidateWaiting(existing.jobId, existing.customerId);
    return { ok: true, message: "Waiting status updated." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not move this waiting job." };
  }
}

export async function markPartArrivedAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  formData.set("markPartArrived", "yes");
  formData.set("stopUpdates", "yes");
  if (!formData.get("notifyCustomer")) formData.set("notifyCustomer", "yes");
  if (!formData.get("createSchedulingTask")) formData.set("createSchedulingTask", "yes");
  return transitionWaitingAction(_prev, formData);
}

export async function resolveWaitingAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const recordId = String(formData.get("recordId") ?? "");
    const existing = await prisma.waitingRecord.findFirst({
      where: { id: recordId },
      select: { companyId: true, jobId: true, customerId: true },
    });
    if (!existing) return { ok: false, error: "Waiting record not found." };
    const { ctx } = await requireWaitingMutation(existing.jobId);
    if (existing.companyId !== ctx.company.id) return { ok: false, error: "Waiting record not found." };
    await resolveWaitingRecord({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      recordId,
      note: String(formData.get("note") ?? "").trim() || null,
      notifyCustomer: formData.get("notifyCustomer") === "yes",
    });
    revalidateWaiting(existing.jobId, existing.customerId);
    return { ok: true, message: "Waiting record resolved. History is preserved." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not resolve waiting record." };
  }
}

export async function sendWaitingUpdateNowAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const recordId = String(formData.get("recordId") ?? "");
    const existing = await prisma.waitingRecord.findFirst({
      where: { id: recordId },
      select: { companyId: true, jobId: true, customerId: true },
    });
    if (!existing) return { ok: false, error: "Waiting record not found." };
    const { ctx } = await requireWaitingMutation(existing.jobId);
    if (existing.companyId !== ctx.company.id) return { ok: false, error: "Waiting record not found." };
    const sent = await sendWaitingCommunication({
      companyId: ctx.company.id,
      recordId,
      kind: "MANUAL",
      actorId: ctx.user.id,
      manual: true,
      idempotencySlot: new Date(),
    });
    revalidateWaiting(existing.jobId, existing.customerId);
    if (!sent.ok) return { ok: false, error: sent.reason ?? "Update was not sent." };
    return { ok: true, message: sent.skipped ? "That update was already sent." : "Customer update sent." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not send the update." };
  }
}

export async function updateWaitingDetailsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const recordId = String(formData.get("recordId") ?? "");
    const existing = await prisma.waitingRecord.findFirst({
      where: { id: recordId },
      include: { column: true },
    });
    if (!existing) return { ok: false, error: "Waiting record not found." };
    const { ctx } = await requireWaitingMutation(existing.jobId);
    if (existing.companyId !== ctx.company.id) return { ok: false, error: "Waiting record not found." };
    if (can(ctx.role, "jobs:assigned_only") && formData.get("cadence") && !can(ctx.role, "jobs:manage")) {
      // Technicians may edit details but not company-wide defaults; per-record cadence is allowed for assigned jobs.
    }
    await updateWaitingRecord({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      recordId,
      notes: formData.get("notes") != null ? String(formData.get("notes")) : undefined,
      assignedOwnerUserId: formData.has("assignedOwnerUserId")
        ? String(formData.get("assignedOwnerUserId") ?? "").trim() || null
        : undefined,
      cadence: cadenceOf(formData.get("cadence")),
      customCadenceDays: formData.has("customCadenceDays")
        ? Number(formData.get("customCadenceDays") || 0) || null
        : undefined,
      communicationEnabled: formData.has("communicationEnabled")
        ? formData.get("communicationEnabled") !== "no"
        : undefined,
      expectedResolutionAt: formData.has("expectedResolutionAt")
        ? dateOrNull(formData.get("expectedResolutionAt"))
        : undefined,
      metadata: { ...parseWaitingMetadata(existing.metadata), ...metadataFromForm(formData, existing.column.key) },
    });
    revalidateWaiting(existing.jobId, existing.customerId);
    return { ok: true, message: "Waiting record updated." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update waiting record." };
  }
}

export async function addWaitingNoteAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const recordId = String(formData.get("recordId") ?? "");
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return { ok: false, error: "Enter a note." };
    const existing = await prisma.waitingRecord.findFirst({
      where: { id: recordId },
      select: { companyId: true, jobId: true, customerId: true },
    });
    if (!existing) return { ok: false, error: "Waiting record not found." };
    const { ctx } = await requireWaitingMutation(existing.jobId);
    if (existing.companyId !== ctx.company.id) return { ok: false, error: "Waiting record not found." };
    await addWaitingNote({ companyId: ctx.company.id, actorId: ctx.user.id, recordId, note });
    revalidateWaiting(existing.jobId, existing.customerId);
    return { ok: true, message: "Note added." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add the note." };
  }
}

export async function saveWaitingBoardSettingsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    await ensureWaitingSetup(ctx.company.id);
    const cadence = cadenceOf(formData.get("defaultCadence")) ?? "EVERY_3_DAYS";
    await prisma.waitingBoardSetting.update({
      where: { companyId: ctx.company.id },
      data: {
        automaticUpdatesEnabled: formData.get("automaticUpdatesEnabled") !== "no",
        defaultCadence: cadence,
        defaultCustomCadenceDays: Number(formData.get("defaultCustomCadenceDays") || 0) || null,
        businessHoursStart: Math.min(20, Math.max(6, Number(formData.get("businessHoursStart") || 10))),
        overdueAlertUserIds: String(formData.get("overdueAlertUserIds") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      },
    });
    const columnIds = formData.getAll("columnId").map(String);
    for (const [index, columnId] of columnIds.entries()) {
      const name = String(formData.get(`columnName-${columnId}`) ?? "").trim();
      const warningDays = Number(formData.get(`warningDays-${columnId}`) || 5);
      const urgentDays = Number(formData.get(`urgentDays-${columnId}`) || 10);
      const archived = formData.get(`archive-${columnId}`) === "yes";
      await prisma.waitingColumn.update({
        where: { id: columnId },
        data: {
          name: name || undefined,
          warningDays: Number.isFinite(warningDays) ? warningDays : 5,
          urgentDays: Number.isFinite(urgentDays) ? urgentDays : 10,
          sortOrder: index,
          archivedAt: archived ? new Date() : null,
        },
      });
    }
    const templates = await prisma.waitingTemplate.findMany({ where: { companyId: ctx.company.id } });
    for (const template of templates) {
      const body = formData.get(`template-${template.id}`);
      if (typeof body === "string") {
        await prisma.waitingTemplate.update({ where: { id: template.id }, data: { body } });
      }
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "waiting.settings_updated",
      entityType: "WaitingBoardSetting",
      entityId: ctx.company.id,
    });
    revalidateWaiting();
    return { ok: true, message: "Waiting Board settings saved." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save settings." };
  }
}

export async function createWaitingColumnAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "Enter a status name." };
    const kind = String(formData.get("kind") ?? "WAITING") === "READY" ? "READY" : "WAITING";
    const count = await prisma.waitingColumn.count({ where: { companyId: ctx.company.id } });
    await prisma.waitingColumn.create({
      data: {
        companyId: ctx.company.id,
        key: columnKeyFromName(name),
        name,
        kind,
        sortOrder: count,
      },
    });
    revalidateWaiting();
    return { ok: true, message: "Waiting status added." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add the status." };
  }
}
