import { prisma } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";
import { loadCapacitySnapshot } from "@/lib/scheduling/capacity";
import { evaluateCapacity, summarizeDayWindows } from "@/lib/scheduling/capacity-engine";
import { formatExceptionSummary } from "@/lib/scheduling/exceptions";
import { loadSchedulingRoster } from "@/lib/scheduling/roster";
import { companyTodayKey } from "@/lib/scheduling/time";
import { DEFAULT_POLICY } from "@/lib/scheduling/types";
import { technicianIsScheduled } from "@/lib/scheduling/persist";

export async function loadSchedulingSettings(companyId: string, timeZone: string) {
  await ensureSchedulingSetup(prisma, companyId);
  const today = companyTodayKey(new Date(), timeZone);
  const [windows, policy, roster, weekly, overrides, serviceTypes, rules, eligibility, todayBookings] =
    await Promise.all([
      prisma.appointmentWindow.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }],
      }),
      prisma.schedulingPolicy.findUnique({ where: { companyId } }),
      loadSchedulingRoster(prisma, companyId),
      prisma.technicianWindowAvailability.findMany({ where: { companyId } }),
      prisma.availabilityOverride.findMany({
        where: { companyId, date: { gte: new Date(`${today}T00:00:00.000Z`) } },
        include: { user: { select: { id: true, firstName: true, lastName: true } }, window: true },
        orderBy: { date: "asc" },
        take: 80,
      }),
      prisma.serviceType.findMany({
        where: { companyId, active: true, archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.serviceTypeSchedulingRule.findMany({ where: { companyId } }),
      prisma.technicianServiceEligibility.findMany({ where: { companyId } }),
      prisma.schedulingBooking.findMany({
        where: {
          companyId,
          releasedAt: null,
          localDate: new Date(`${today}T00:00:00.000Z`),
          job: { status: { not: "CANCELED" } },
        },
        include: {
          job: { select: { id: true, jobNumber: true, customer: { select: { firstName: true, lastName: true } } } },
          technician: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

  const snapshot = await loadCapacitySnapshot(prisma, companyId, [today]);
  const todayCapacity = evaluateCapacity(snapshot, { companyId, date: today });
  const todayWindows = summarizeDayWindows(snapshot, { companyId, date: today });
  const resolvedPolicy = policy
    ? {
        autoBookingEnabled: policy.autoBookingEnabled,
        allowSameDay: policy.allowSameDay,
        allowWeekend: policy.allowWeekend,
        minNoticeMinutes: policy.minNoticeMinutes,
        standardHorizonDays: policy.standardHorizonDays,
        maintenanceHorizonDays: policy.maintenanceHorizonDays,
        maxJobsPerWindow: policy.maxJobsPerWindow,
        maxJobsPerDay: policy.maxJobsPerDay,
        emergencyReservePerWindow: policy.emergencyReservePerWindow,
        allowEmergencyReserveUse: policy.allowEmergencyReserveUse,
        allowTechnicianPreference: policy.allowTechnicianPreference,
        allowOfficeOverride: policy.allowOfficeOverride,
        autoCancelEnabled: policy.autoCancelEnabled,
        showTechnicianName: policy.showTechnicianName,
        allowPaidOneTimeMaintenance: policy.allowPaidOneTimeMaintenance,
        confirmationTemplate: policy.confirmationTemplate,
        defaultServiceTypeId: policy.defaultServiceTypeId,
        maintenanceServiceTypeId: policy.maintenanceServiceTypeId,
        proactiveOutreachEnabled: policy.proactiveOutreachEnabled,
        timezone: timeZone,
      }
    : { ...DEFAULT_POLICY, timezone: timeZone };

  const weeklyRows = weekly.map((row) => ({
    userId: row.userId,
    windowId: row.windowId,
    weekday: row.weekday,
    available: row.available,
    capacity: row.capacity,
  }));

  return {
    today,
    timeZone,
    policy: resolvedPolicy,
    windows: windows.map((window) => ({
      id: window.id,
      name: window.name,
      label: window.label,
      startMinutes: window.startMinutes,
      endMinutes: window.endMinutes,
      daypart: window.daypart,
      active: window.active,
      sortOrder: window.sortOrder,
    })),
    technicians: roster.technicians.map((tech) => ({
      userId: tech.userId,
      firstName: tech.firstName,
      lastName: tech.lastName,
      name: tech.name,
      role: tech.role,
      roleLabel: ROLE_LABELS[tech.role],
      scheduled: technicianIsScheduled(weeklyRows, tech.userId),
    })),
    eligibleToAdd: roster.eligibleToAdd.map((tech) => ({
      userId: tech.userId,
      firstName: tech.firstName,
      lastName: tech.lastName,
      name: tech.name,
      role: tech.role,
      roleLabel: ROLE_LABELS[tech.role],
    })),
    weekly: weeklyRows,
    eligibility: eligibility.map((row) => ({
      userId: row.userId,
      serviceTypeId: row.serviceTypeId,
      eligible: row.eligible,
    })),
    serviceTypes: serviceTypes.map((type) => ({
      id: type.id,
      name: type.name,
      key: type.key,
    })),
    rules: rules.map((rule) => ({
      serviceTypeId: rule.serviceTypeId,
      autoBookAllowed: rule.autoBookAllowed,
      requiresOfficeApproval: rule.requiresOfficeApproval,
      isMaintenance: rule.isMaintenance,
    })),
    exceptions: overrides.map((row) => ({
      id: row.id,
      userId: row.userId,
      technicianName: `${row.user.firstName} ${row.user.lastName}`.trim(),
      windowId: row.windowId,
      windowName: row.window.name,
      startMinutes: row.window.startMinutes,
      endMinutes: row.window.endMinutes,
      date: row.date.toISOString().slice(0, 10),
      available: row.available,
      capacity: row.capacity,
      kind: row.kind,
      reason: row.reason,
      summary: formatExceptionSummary({
        kind: row.kind,
        available: row.available,
        capacity: row.capacity,
        reason: row.reason,
      }),
    })),
    todayCapacity: todayCapacity.options,
    todayRejected: todayCapacity.rejected,
    todayWindows,
    todayBookings: todayBookings.map((row) => ({
      jobId: row.jobId,
      jobNumber: row.job.jobNumber,
      windowId: row.windowId,
      technicianId: row.technicianUserId,
      technicianName: `${row.technician.firstName} ${row.technician.lastName}`.trim(),
      customerName: `${row.job.customer.firstName} ${row.job.customer.lastName}`.trim(),
    })),
  };
}

export type SchedulingSettingsData = Awaited<ReturnType<typeof loadSchedulingSettings>>;
