import { prisma } from "@/lib/db";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";
import { loadCapacitySnapshot } from "@/lib/scheduling/capacity";
import { evaluateCapacity } from "@/lib/scheduling/capacity-engine";
import { companyTodayKey } from "@/lib/scheduling/time";
import { DEFAULT_POLICY } from "@/lib/scheduling/types";

export async function loadSchedulingSettings(companyId: string, timeZone: string) {
  await ensureSchedulingSetup(prisma, companyId);
  const today = companyTodayKey(new Date(), timeZone);
  const [windows, policy, techs, weekly, overrides, serviceTypes, rules, eligibility] = await Promise.all([
    prisma.appointmentWindow.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }],
    }),
    prisma.schedulingPolicy.findUnique({ where: { companyId } }),
    prisma.membership.findMany({
      where: { companyId, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.technicianWindowAvailability.findMany({ where: { companyId } }),
    prisma.availabilityOverride.findMany({
      where: { companyId, date: { gte: new Date(`${today}T00:00:00.000Z`) } },
      include: { user: { select: { id: true, firstName: true, lastName: true } }, window: true },
      orderBy: { date: "asc" },
      take: 40,
    }),
    prisma.serviceType.findMany({
      where: { companyId, active: true, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.serviceTypeSchedulingRule.findMany({ where: { companyId } }),
    prisma.technicianServiceEligibility.findMany({ where: { companyId } }),
  ]);

  const snapshot = await loadCapacitySnapshot(prisma, companyId, [today]);
  const todayCapacity = evaluateCapacity(snapshot, { companyId, date: today });
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
    technicians: techs.map((tech) => ({
      userId: tech.user.id,
      firstName: tech.user.firstName,
      lastName: tech.user.lastName,
      name: `${tech.user.firstName} ${tech.user.lastName}`.trim(),
    })),
    weekly: weekly.map((row) => ({
      userId: row.userId,
      windowId: row.windowId,
      weekday: row.weekday,
      available: row.available,
      capacity: row.capacity,
    })),
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
      reason: row.reason,
    })),
    todayCapacity: todayCapacity.options,
    todayRejected: todayCapacity.rejected,
  };
}

export type SchedulingSettingsData = Awaited<ReturnType<typeof loadSchedulingSettings>>;
