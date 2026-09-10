"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireAnyPermission, requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import type { ActionResult } from "@/server/actions/auth";
import type { AppointmentDaypart } from "@prisma/client";
import { inferDaypart, validateAppointmentWindow, findActiveWindowOverlaps, canDeleteWindow, windowNameFromTimes } from "@/lib/scheduling/windows";
import { parseClockToMinutes } from "@/lib/scheduling/time";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";
import { bookAppointment, cancelAppointment, rescheduleAppointment } from "@/lib/scheduling/booking";
import { setConversationAutoBooking } from "@/lib/scheduling/conversation";
import {
  dateKeysInclusive,
  expandExceptionToOverrides,
  parseExceptionKind,
} from "@/lib/scheduling/exceptions";
import { isSchedulingEligibleRole, loadSchedulingRoster } from "@/lib/scheduling/roster";
import {
  parseFormBoolean,
  parseFormFieldBoolean,
  parseFormCapacity,
  parseFormWeekday,
  parseTechnicianWeekSlots,
} from "@/lib/scheduling/persist";

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
    const ctx = await requireAnyPermission(["company:settings", "schedule:manage"]);
    await ensureSchedulingSetup(prisma, ctx.company.id);
    await prisma.schedulingPolicy.upsert({
      where: { companyId: ctx.company.id },
      create: { companyId: ctx.company.id },
      update: {
        autoBookingEnabled: parseFormBoolean(formData.get("autoBookingEnabled")),
        allowSameDay: parseFormBoolean(formData.get("allowSameDay")),
        allowWeekend: parseFormBoolean(formData.get("allowWeekend")),
        minNoticeMinutes: Number(formString(formData, "minNoticeMinutes") || 120),
        standardHorizonDays: Number(formString(formData, "standardHorizonDays") || 90),
        maintenanceHorizonDays: Number(formString(formData, "maintenanceHorizonDays") || 365),
        maxJobsPerWindow: formString(formData, "maxJobsPerWindow") ? Number(formString(formData, "maxJobsPerWindow")) : null,
        maxJobsPerDay: formString(formData, "maxJobsPerDay") ? Number(formString(formData, "maxJobsPerDay")) : null,
        emergencyReservePerWindow: Number(formString(formData, "emergencyReservePerWindow") || 0),
        allowEmergencyReserveUse: parseFormBoolean(formData.get("allowEmergencyReserveUse")),
        autoCancelEnabled: parseFormBoolean(formData.get("autoCancelEnabled")),
        showTechnicianName: parseFormBoolean(formData.get("showTechnicianName")),
        allowPaidOneTimeMaintenance: parseFormBoolean(formData.get("allowPaidOneTimeMaintenance")),
        allowOfficeOverride: parseFormBoolean(formData.get("allowOfficeOverride") ?? "yes"),
        allowTechnicianPreference: parseFormBoolean(formData.get("allowTechnicianPreference") ?? "yes"),
        confirmationTemplate: formString(formData, "confirmationTemplate") || null,
        defaultServiceTypeId: formString(formData, "defaultServiceTypeId") || null,
        maintenanceServiceTypeId: formString(formData, "maintenanceServiceTypeId") || null,
        proactiveOutreachEnabled: parseFormBoolean(formData.get("proactiveOutreachEnabled")),
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

export async function saveAutoBookingEnabledAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["company:settings", "schedule:manage"]);
    await ensureSchedulingSetup(prisma, ctx.company.id);
    const autoBookingEnabled = parseFormFieldBoolean(formData, "autoBookingEnabled");
    await prisma.schedulingPolicy.upsert({
      where: { companyId: ctx.company.id },
      create: { companyId: ctx.company.id, autoBookingEnabled },
      update: { autoBookingEnabled },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.policy_updated",
      entityType: "SchedulingPolicy",
      entityId: ctx.company.id,
      metadata: { autoBookingEnabled },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true, message: autoBookingEnabled ? "Auto booking is on." : "Auto booking is off." };
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
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
    await ensureSchedulingSetup(prisma, ctx.company.id);
    const id = formString(formData, "id");
    const startMinutes = minutesFromForm(formData, "start");
    const endMinutes = minutesFromForm(formData, "end");
    if (startMinutes == null || endMinutes == null) return { ok: false, error: "Enter a valid start and end time." };
    const draft = {
      id,
      name: formString(formData, "name") || windowNameFromTimes(startMinutes, endMinutes),
      label: formString(formData, "label") || null,
      startMinutes,
      endMinutes,
      daypart: (formString(formData, "daypart") || inferDaypart(startMinutes)) as AppointmentDaypart,
      active: formData.has("active") ? parseFormFieldBoolean(formData, "active") : true,
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
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
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

export async function reorderAppointmentWindowsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
    const ids = formData.getAll("windowId").map(String).filter(Boolean);
    const windows = await prisma.appointmentWindow.findMany({
      where: { companyId: ctx.company.id },
      select: { id: true },
    });
    const known = new Set(windows.map((row) => row.id));
    if (!ids.length || ids.some((id) => !known.has(id))) {
      return { ok: false, error: "Choose a valid window order." };
    }
    await prisma.$transaction(
      ids.map((id, index) => prisma.appointmentWindow.update({ where: { id }, data: { sortOrder: index } }))
    );
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.windows_reordered",
      entityType: "AppointmentWindow",
      entityId: ctx.company.id,
    });
    revalidatePath("/settings/scheduling");
    return { ok: true, message: "Window order saved." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function addSchedulingTechnicianAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
    if (ctx.role === "TECHNICIAN" || ctx.role === "INSTALLER") {
      return { ok: false, error: "Technicians cannot change company scheduling." };
    }
    const userId = formString(formData, "userId");
    const member = await prisma.membership.findFirst({
      where: { companyId: ctx.company.id, userId, status: "ACTIVE" },
    });
    if (!member || !isSchedulingEligibleRole(member.role)) {
      return { ok: false, error: "Choose an existing eligible team member." };
    }
    const roster = await loadSchedulingRoster(prisma, ctx.company.id);
    if (roster.technicians.some((row) => row.userId === userId)) {
      return { ok: true, message: "That teammate is already on the schedule." };
    }
    const windows = await prisma.appointmentWindow.findMany({
      where: { companyId: ctx.company.id },
      select: { id: true },
    });
    if (windows.length) {
      await prisma.technicianWindowAvailability.createMany({
        data: windows.flatMap((window) =>
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            companyId: ctx.company.id,
            userId,
            windowId: window.id,
            weekday,
            available: false,
            capacity: 1,
          }))
        ),
        skipDuplicates: true,
      });
    } else {
      const serviceType = await prisma.serviceType.findFirst({
        where: { companyId: ctx.company.id, active: true, archivedAt: null },
        select: { id: true },
      });
      if (serviceType) {
        await prisma.technicianServiceEligibility.upsert({
          where: {
            companyId_userId_serviceTypeId: {
              companyId: ctx.company.id,
              userId,
              serviceTypeId: serviceType.id,
            },
          },
          create: { companyId: ctx.company.id, userId, serviceTypeId: serviceType.id, eligible: true },
          update: {},
        });
      }
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.technician_added",
      entityType: "User",
      entityId: userId,
    });
    revalidatePath("/settings/scheduling");
    return { ok: true, message: "Technician added. Set their weekly availability next." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function removeSchedulingTechnicianAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
    if (ctx.role === "TECHNICIAN" || ctx.role === "INSTALLER") {
      return { ok: false, error: "Technicians cannot change company scheduling." };
    }
    const userId = formString(formData, "userId");
    const member = await prisma.membership.findFirst({
      where: { companyId: ctx.company.id, userId, status: "ACTIVE" },
    });
    if (!member) return { ok: false, error: "Team member not found." };
    const keepOnRoster = member.role === "TECHNICIAN" || member.role === "INSTALLER";
    if (keepOnRoster) {
      await prisma.technicianWindowAvailability.updateMany({
        where: { companyId: ctx.company.id, userId },
        data: { available: false },
      });
    } else {
      await prisma.$transaction([
        prisma.technicianWindowAvailability.deleteMany({ where: { companyId: ctx.company.id, userId } }),
        prisma.technicianServiceEligibility.deleteMany({ where: { companyId: ctx.company.id, userId } }),
      ]);
    }
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.technician_removed",
      entityType: "User",
      entityId: userId,
    });
    revalidatePath("/settings/scheduling");
    return { ok: true, message: "Technician removed from the live schedule." };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveServiceTypeRulesBatchAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["company:settings", "schedule:manage"]);
    const serviceTypeIds = formData.getAll("serviceTypeId").map(String).filter(Boolean);
    const types = await prisma.serviceType.findMany({
      where: { companyId: ctx.company.id, id: { in: serviceTypeIds }, active: true, archivedAt: null },
      select: { id: true },
    });
    const known = new Set(types.map((row) => row.id));
    await prisma.$transaction(
      serviceTypeIds.filter((id) => known.has(id)).map((serviceTypeId) => {
        const autoBookAllowed = parseFormFieldBoolean(formData, `autoBookAllowed:${serviceTypeId}`);
        return prisma.serviceTypeSchedulingRule.upsert({
          where: { companyId_serviceTypeId: { companyId: ctx.company.id, serviceTypeId } },
          create: {
            companyId: ctx.company.id,
            serviceTypeId,
            autoBookAllowed,
            requiresOfficeApproval: false,
            isMaintenance: false,
          },
          update: { autoBookAllowed },
        });
      })
    );
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.auto_book_rules_updated",
      entityType: "ServiceTypeSchedulingRule",
      entityId: ctx.company.id,
      metadata: { count: serviceTypeIds.length },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true, message: "Auto-book settings saved." };
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
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
    const userId = formString(formData, "userId");
    const windowId = formString(formData, "windowId");
    const weekday = parseFormWeekday(formData.get("weekday"));
    const available = parseFormBoolean(formData.get("available"));
    const capacity = parseFormCapacity(formData.get("capacity"), 1);
    if (weekday == null) return { ok: false, error: "Choose a valid weekday." };
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
        available,
        capacity,
      },
      update: {
        available,
        capacity,
      },
    });
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.capacity_changed",
      entityType: "TechnicianWindowAvailability",
      entityId: userId,
      metadata: { windowId, weekday, available, capacity },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveTechnicianWeekAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
    const userId = formString(formData, "userId");
    const member = await prisma.membership.findFirst({
      where: { companyId: ctx.company.id, userId, status: "ACTIVE" },
    });
    if (!member) return { ok: false, error: "Technician not found." };
    if (ctx.role === "TECHNICIAN" && ctx.user.id !== userId) {
      return { ok: false, error: "Technicians can only view their own schedule." };
    }
    const windows = await prisma.appointmentWindow.findMany({
      where: { companyId: ctx.company.id },
      select: { id: true },
    });
    const windowIds = windows.map((window) => window.id);
    const slots = parseTechnicianWeekSlots(formData, windowIds);
    await prisma.$transaction(
      slots.map((slot) =>
        prisma.technicianWindowAvailability.upsert({
          where: {
            companyId_userId_windowId_weekday: {
              companyId: ctx.company.id,
              userId,
              windowId: slot.windowId,
              weekday: slot.weekday,
            },
          },
          create: {
            companyId: ctx.company.id,
            userId,
            windowId: slot.windowId,
            weekday: slot.weekday,
            available: slot.available,
            capacity: slot.capacity,
          },
          update: {
            available: slot.available,
            capacity: slot.capacity,
          },
        })
      )
    );
    const eligibility = formData.getAll("eligibleServiceTypeId").map(String);
    const serviceTypes = await prisma.serviceType.findMany({
      where: { companyId: ctx.company.id, active: true, archivedAt: null },
      select: { id: true },
    });
    await prisma.$transaction(
      serviceTypes.map((type) =>
        prisma.technicianServiceEligibility.upsert({
          where: {
            companyId_userId_serviceTypeId: {
              companyId: ctx.company.id,
              userId,
              serviceTypeId: type.id,
            },
          },
          create: {
            companyId: ctx.company.id,
            userId,
            serviceTypeId: type.id,
            eligible: eligibility.includes(type.id),
          },
          update: { eligible: eligibility.includes(type.id) },
        })
      )
    );
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.capacity_changed",
      entityType: "TechnicianWindowAvailability",
      entityId: userId,
      metadata: { weekSlots: slots.length, availableSlots: slots.filter((slot) => slot.available).length },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true, message: "Technician schedule saved." };
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
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
    const date = formString(formData, "date");
    const endDate = formString(formData, "endDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Choose a valid date." };
    const dates = dateKeysInclusive(date, endDate || date);
    if (!dates.length) return { ok: false, error: "Choose a valid date range." };

    const roster = await loadSchedulingRoster(prisma, ctx.company.id);
    const selectedUserId = formString(formData, "userId");
    const userIds =
      selectedUserId === "__all__"
        ? roster.technicians.map((row) => row.userId)
        : roster.technicians.some((row) => row.userId === selectedUserId)
          ? [selectedUserId]
          : [];
    if (!userIds.length) return { ok: false, error: "Choose a technician on the schedule." };

    const windows = await prisma.appointmentWindow.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }],
    });
    if (!windows.length) return { ok: false, error: "Add appointment windows first." };

    const kind = parseExceptionKind(formString(formData, "kind")) ?? "CUSTOM";
    const startMinutes = minutesFromForm(formData, "start");
    const endMinutes = minutesFromForm(formData, "end");
    const needsHours = kind === "LATE_START" || kind === "EARLY_FINISH" || kind === "EXTRA_HOURS";
    if (kind === "LATE_START" && startMinutes == null) return { ok: false, error: "Enter the late-start time." };
    if (kind === "EARLY_FINISH" && endMinutes == null) return { ok: false, error: "Enter the early-finish time." };
    if (kind === "EXTRA_HOURS" && (startMinutes == null || endMinutes == null)) {
      return { ok: false, error: "Enter extra-hour start and end times." };
    }
    const capacityRaw = formString(formData, "capacity");
    const slots = expandExceptionToOverrides({
      kind,
      windows: windows.map((window) => ({
        id: window.id,
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
      })),
      startMinutes: needsHours || kind === "CUSTOM" ? startMinutes : null,
      endMinutes: needsHours || kind === "CUSTOM" ? endMinutes : null,
      capacity: capacityRaw ? parseFormCapacity(capacityRaw, 0) : null,
      available: parseFormBoolean(formData.get("available") ?? (kind === "EXTRA_HOURS" || kind === "CAPACITY_OVERRIDE" ? "yes" : "no")),
    });
    const reason = formString(formData, "reason") || null;

    await prisma.$transaction(
      userIds.flatMap((userId) =>
        dates.flatMap((day) =>
          slots.map((slot) =>
            prisma.availabilityOverride.upsert({
              where: {
                companyId_userId_windowId_date: {
                  companyId: ctx.company.id,
                  userId,
                  windowId: slot.windowId,
                  date: new Date(`${day}T00:00:00.000Z`),
                },
              },
              create: {
                companyId: ctx.company.id,
                userId,
                windowId: slot.windowId,
                date: new Date(`${day}T00:00:00.000Z`),
                available: slot.available,
                capacity: slot.capacity,
                kind,
                reason,
              },
              update: {
                available: slot.available,
                capacity: slot.capacity,
                kind,
                reason,
              },
            })
          )
        )
      )
    );
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "scheduling.override_created",
      entityType: "AvailabilityOverride",
      entityId: userIds[0],
      metadata: { date, endDate: endDate || date, kind, userIds },
    });
    revalidatePath("/settings/scheduling");
    return { ok: true, message: "Exception saved. Availability updates immediately." };
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
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
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
    const ctx = await requireAnyPermission(["schedule:manage", "company:settings"]);
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
        eligible: parseFormBoolean(formData.get("eligible")),
      },
      update: { eligible: parseFormBoolean(formData.get("eligible")) },
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
    const ctx = await requireAnyPermission(["company:settings", "schedule:manage"]);
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
        autoBookAllowed: parseFormFieldBoolean(formData, "autoBookAllowed"),
        requiresOfficeApproval: parseFormFieldBoolean(formData, "requiresOfficeApproval"),
        isMaintenance: parseFormFieldBoolean(formData, "isMaintenance"),
      },
      update: {
        autoBookAllowed: parseFormFieldBoolean(formData, "autoBookAllowed"),
        requiresOfficeApproval: parseFormFieldBoolean(formData, "requiresOfficeApproval"),
        isMaintenance: parseFormFieldBoolean(formData, "isMaintenance"),
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
      origin: "SCHEDULING_CONFIRMATION",
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
