"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import type { ActionResult } from "@/server/actions/auth";
import type { AppointmentDaypart } from "@prisma/client";
import { inferDaypart, validateAppointmentWindow, findActiveWindowOverlaps, canDeleteWindow } from "@/lib/scheduling/windows";
import { parseClockToMinutes } from "@/lib/scheduling/time";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";
import { bookAppointment, cancelAppointment, rescheduleAppointment } from "@/lib/scheduling/booking";
import { setConversationAutoBooking } from "@/lib/scheduling/conversation";

function formString(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function minutesFromForm(formData: FormData, prefix: string) {
  const raw = formString(formData, `${prefix}Minutes`);
  if (raw) {
    const value = Number(raw);
    return Number.isInteger(value) ? value : null;
  }
  const clock = `${formString(formData, `${prefix}Hour`)}:${formString(formData, `${prefix}Minute`) || "00"} ${formString(formData, `${prefix}Period`)}`;
  return parseClockToMinutes(clock);
}

export async function saveSchedulingPolicyAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    await ensureSchedulingSetup(prisma, ctx.company.id);
    await prisma.schedulingPolicy.upsert({
      where: { companyId: ctx.company.id },
      create: { companyId: ctx.company.id },
      update: {
        autoBookingEnabled: formString(formData, "autoBookingEnabled") === "yes",
        allowSameDay: formString(formData, "allowSameDay") === "yes",
        allowWeekend: formString(formData, "allowWeekend") === "yes",
        minNoticeMinutes: Number(formString(formData, "minNoticeMinutes") || 120),
        standardHorizonDays: Number(formString(formData, "standardHorizonDays") || 90),
        maintenanceHorizonDays: Number(formString(formData, "maintenanceHorizonDays") || 365),
        maxJobsPerWindow: formString(formData, "maxJobsPerWindow") ? Number(formString(formData, "maxJobsPerWindow")) : null,
        maxJobsPerDay: formString(formData, "maxJobsPerDay") ? Number(formString(formData, "maxJobsPerDay")) : null,
        emergencyReservePerWindow: Number(formString(formData, "emergencyReservePerWindow") || 0),
        allowEmergencyReserveUse: formString(formData, "allowEmergencyReserveUse") === "yes",
        autoCancelEnabled: formString(formData, "autoCancelEnabled") === "yes",
        showTechnicianName: formString(formData, "showTechnicianName") === "yes",
        allowPaidOneTimeMaintenance: formString(formData, "allowPaidOneTimeMaintenance") === "yes",
        allowOfficeOverride: formString(formData, "allowOfficeOverride") === "yes",
        confirmationTemplate: formString(formData, "confirmationTemplate") || null,
        defaultServiceTypeId: formString(formData, "defaultServiceTypeId") || null,
        maintenanceServiceTypeId: formString(formData, "maintenanceServiceTypeId") || null,
        proactiveOutreachEnabled: formString(formData, "proactiveOutreachEnabled") === "yes",
      },
    });
    const timezone = formString(formData, "timezone");
    if (timezone) {
      await prisma.company.update({ where: { id: ctx.company.id }, data: { timezone } });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.policy_updated",
      entityType: "SchedulingPolicy",
      entityId: ctx.company.id,
    });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveAppointmentWindowAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    await ensureSchedulingSetup(prisma, ctx.company.id);
    const id = formString(formData, "id");
    const startMinutes = minutesFromForm(formData, "start");
    const endMinutes = minutesFromForm(formData, "end");
    if (startMinutes == null || endMinutes == null) return { ok: false, error: "Enter a valid start and end time." };
    const draft = {
      id,
      name: formString(formData, "name"),
      label: formString(formData, "label") || null,
      startMinutes,
      endMinutes,
      daypart: (formString(formData, "daypart") || inferDaypart(startMinutes)) as AppointmentDaypart,
      active: formString(formData, "active") !== "no",
      sortOrder: Number(formString(formData, "sortOrder") || 0),
    };
    const invalid = validateAppointmentWindow(draft);
    if (invalid) return { ok: false, error: invalid };

    const others = await prisma.appointmentWindow.findMany({
      where: { companyId: ctx.company.id, ...(id ? { id: { not: id } } : {}) },
    });
    const overlaps = findActiveWindowOverlaps([
      ...others.map((row) => ({ ...row, active: row.active })),
      draft,
    ]);
    if (overlaps.length) return { ok: false, error: overlaps[0].message };

    if (id) {
      const existing = await prisma.appointmentWindow.findFirst({ where: { id, companyId: ctx.company.id } });
      if (!existing) return { ok: false, error: "Window not found." };
      await prisma.appointmentWindow.update({
        where: { id },
        data: {
          name: draft.name,
          label: draft.label,
          startMinutes,
          endMinutes,
          daypart: draft.daypart,
          active: draft.active,
          sortOrder: draft.sortOrder,
        },
      });
    } else {
      const maxSort = await prisma.appointmentWindow.aggregate({
        where: { companyId: ctx.company.id },
        _max: { sortOrder: true },
      });
      await prisma.appointmentWindow.create({
        data: {
          companyId: ctx.company.id,
          name: draft.name,
          label: draft.label,
          startMinutes,
          endMinutes,
          daypart: draft.daypart,
          active: draft.active,
          sortOrder: maxSort._max.sortOrder != null ? maxSort._max.sortOrder + 1 : 0,
        },
      });
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.window_saved",
      entityType: "AppointmentWindow",
      entityId: id || ctx.company.id,
    });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function deleteAppointmentWindowAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    const id = formString(formData, "id");
    const window = await prisma.appointmentWindow.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!window) return { ok: false, error: "Window not found." };
    const [bookingCount, jobCount] = await Promise.all([
      prisma.schedulingBooking.count({ where: { companyId: ctx.company.id, windowId: id, releasedAt: null } }),
      prisma.job.count({ where: { companyId: ctx.company.id, appointmentWindowId: id, status: { not: "CANCELED" } } }),
    ]);
    const allowed = canDeleteWindow({ bookingCount, jobCount });
    if (!allowed.ok) return { ok: false, error: allowed.error };
    await prisma.appointmentWindow.delete({ where: { id } });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveTechnicianAvailabilityAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    const userId = formString(formData, "userId");
    const windowId = formString(formData, "windowId");
    const weekday = Number(formString(formData, "weekday"));
    const member = await prisma.membership.findFirst({
      where: { companyId: ctx.company.id, userId, status: "ACTIVE" },
    });
    const window = await prisma.appointmentWindow.findFirst({ where: { id: windowId, companyId: ctx.company.id } });
    if (!member || !window) return { ok: false, error: "Technician or window not found." };
    if (ctx.role === "TECHNICIAN" && ctx.user.id !== userId) {
      return { ok: false, error: "Technicians can only view their own schedule." };
    }
    await prisma.technicianWindowAvailability.upsert({
      where: {
        companyId_userId_windowId_weekday: {
          companyId: ctx.company.id,
          userId,
          windowId,
          weekday,
        },
      },
      create: {
        companyId: ctx.company.id,
        userId,
        windowId,
        weekday,
        available: formString(formData, "available") === "yes",
        capacity: Math.max(0, Number(formString(formData, "capacity") || 1)),
      },
      update: {
        available: formString(formData, "available") === "yes",
        capacity: Math.max(0, Number(formString(formData, "capacity") || 1)),
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.capacity_changed",
      entityType: "TechnicianWindowAvailability",
      entityId: userId,
      metadata: { windowId, weekday },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveAvailabilityOverrideAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    const userId = formString(formData, "userId");
    const windowId = formString(formData, "windowId");
    const date = formString(formData, "date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Choose a valid date." };
    const member = await prisma.membership.findFirst({
      where: { companyId: ctx.company.id, userId, status: "ACTIVE" },
    });
    const window = await prisma.appointmentWindow.findFirst({ where: { id: windowId, companyId: ctx.company.id } });
    if (!member || !window) return { ok: false, error: "Technician or window not found." };
    await prisma.availabilityOverride.upsert({
      where: {
        companyId_userId_windowId_date: {
          companyId: ctx.company.id,
          userId,
          windowId,
          date: new Date(`${date}T00:00:00.000Z`),
        },
      },
      create: {
        companyId: ctx.company.id,
        userId,
        windowId,
        date: new Date(`${date}T00:00:00.000Z`),
        available: formString(formData, "available") === "yes",
        capacity: formString(formData, "capacity") ? Number(formString(formData, "capacity")) : null,
        reason: formString(formData, "reason") || null,
      },
      update: {
        available: formString(formData, "available") === "yes",
        capacity: formString(formData, "capacity") ? Number(formString(formData, "capacity")) : null,
        reason: formString(formData, "reason") || null,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.override_created",
      entityType: "AvailabilityOverride",
      entityId: userId,
      metadata: { date, windowId, reason: formString(formData, "reason") || null },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function deleteAvailabilityOverrideAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    const id = formString(formData, "id");
    const row = await prisma.availabilityOverride.findFirst({ where: { id, companyId: ctx.company.id } });
    if (!row) return { ok: false, error: "Override not found." };
    await prisma.availabilityOverride.delete({ where: { id } });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveTechnicianEligibilityAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    const userId = formString(formData, "userId");
    const serviceTypeId = formString(formData, "serviceTypeId");
    const member = await prisma.membership.findFirst({
      where: { companyId: ctx.company.id, userId, status: "ACTIVE" },
    });
    const serviceType = await prisma.serviceType.findFirst({
      where: { id: serviceTypeId, companyId: ctx.company.id },
    });
    if (!member || !serviceType) return { ok: false, error: "Technician or service type not found." };
    await prisma.technicianServiceEligibility.upsert({
      where: {
        companyId_userId_serviceTypeId: {
          companyId: ctx.company.id,
          userId,
          serviceTypeId,
        },
      },
      create: {
        companyId: ctx.company.id,
        userId,
        serviceTypeId,
        eligible: formString(formData, "eligible") === "yes",
      },
      update: { eligible: formString(formData, "eligible") === "yes" },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveServiceTypeRuleAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("company:settings");
    const serviceTypeId = formString(formData, "serviceTypeId");
    const serviceType = await prisma.serviceType.findFirst({
      where: { id: serviceTypeId, companyId: ctx.company.id },
    });
    if (!serviceType) return { ok: false, error: "Service type not found." };
    await prisma.serviceTypeSchedulingRule.upsert({
      where: { companyId_serviceTypeId: { companyId: ctx.company.id, serviceTypeId } },
      create: {
        companyId: ctx.company.id,
        serviceTypeId,
        autoBookAllowed: formString(formData, "autoBookAllowed") === "yes",
        requiresOfficeApproval: formString(formData, "requiresOfficeApproval") === "yes",
        isMaintenance: formString(formData, "isMaintenance") === "yes",
      },
      update: {
        autoBookAllowed: formString(formData, "autoBookAllowed") === "yes",
        requiresOfficeApproval: formString(formData, "requiresOfficeApproval") === "yes",
        isMaintenance: formString(formData, "isMaintenance") === "yes",
      },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function bookFromConversationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:manage");
    const result = await bookAppointment({
      companyId: ctx.company.id,
      customerId: formString(formData, "customerId"),
      propertyId: formString(formData, "propertyId") || null,
      serviceTypeId: formString(formData, "serviceTypeId") || null,
      date: formString(formData, "date"),
      windowId: formString(formData, "windowId"),
      technicianId: formString(formData, "technicianId") || null,
      source: "MANUAL",
      actorId: ctx.user.id,
      threadId: formString(formData, "threadId") || null,
      idempotencyKey: `manual:${ctx.company.id}:${formString(formData, "customerId")}:${formString(formData, "date")}:${formString(formData, "windowId")}:${Date.now()}`,
      sendConfirmation: formString(formData, "sendConfirmation") === "yes",
      maintenance: formString(formData, "maintenance") === "yes",
      maintenanceVisitId: formString(formData, "maintenanceVisitId") || null,
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/dispatch");
    revalidatePath("/marketing/communications");
    revalidatePath("/maintenance");
    return { ok: true, message: "Appointment booked." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function pauseConversationBookingAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("schedule:manage");
    await setConversationAutoBooking({
      companyId: ctx.company.id,
      threadId: formString(formData, "threadId"),
      paused: formString(formData, "paused") === "yes",
      actorId: ctx.user.id,
    });
    revalidatePath("/marketing/communications");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function cancelScheduledJobAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:manage");
    const result = await cancelAppointment({
      companyId: ctx.company.id,
      jobId: formString(formData, "jobId"),
      actorId: ctx.user.id,
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/dispatch");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function rescheduleScheduledJobAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:manage");
    const result = await rescheduleAppointment({
      companyId: ctx.company.id,
      jobId: formString(formData, "jobId"),
      date: formString(formData, "date"),
      windowId: formString(formData, "windowId"),
      technicianId: formString(formData, "technicianId") || null,
      actorId: ctx.user.id,
      sendConfirmation: formString(formData, "sendConfirmation") === "yes",
    });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/dispatch");
    return { ok: true, message: "Appointment rescheduled." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function retryBookingConfirmationAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("jobs:manage");
    const jobId = formString(formData, "jobId");
    const job = await prisma.job.findFirst({
      where: { id: jobId, companyId: ctx.company.id },
      include: { customer: true, appointmentWindow: true, schedulingBooking: true },
    });
    if (!job?.customer?.phone || !job.appointmentWindow) return { ok: false, error: "Job is not ready to confirm." };
    const { confirmationMessage } = await import("@/lib/scheduling/templates");
    const { loadSchedulingPolicy } = await import("@/lib/scheduling/capacity");
    const policy = await loadSchedulingPolicy(prisma, ctx.company.id);
    const body = confirmationMessage({
      policy,
      dateKey: job.schedulingBooking?.localDate.toISOString().slice(0, 10) || "",
      startMinutes: job.appointmentWindow.startMinutes,
      endMinutes: job.appointmentWindow.endMinutes,
      timeZone: ctx.company.timezone,
    });
    const { sendCompanyCommunication } = await import("@/lib/comms/provider");
    const sent = await sendCompanyCommunication({
      companyId: ctx.company.id,
      channel: "SMS",
      to: job.customer.phone,
      body,
      customerId: job.customerId,
    });
    if (!sent.ok) return { ok: false, error: sent.error || "Confirmation still failed." };
    await prisma.job.update({ where: { id: job.id }, data: { confirmationFailed: false } });
    await prisma.schedulingBooking.updateMany({
      where: { jobId: job.id, companyId: ctx.company.id },
      data: { confirmationStatus: "SENT", confirmationError: null },
    });
    return { ok: true, message: "Confirmation sent." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}
