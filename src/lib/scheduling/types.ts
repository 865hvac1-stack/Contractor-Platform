import type { AppointmentDaypart } from "@prisma/client";
import type { RankingComponents } from "@/lib/scheduling/ranking";

export type SchedulingPolicyView = {
  autoBookingEnabled: boolean;
  allowSameDay: boolean;
  allowWeekend: boolean;
  minNoticeMinutes: number;
  standardHorizonDays: number;
  maintenanceHorizonDays: number;
  maxJobsPerWindow: number | null;
  maxJobsPerDay: number | null;
  emergencyReservePerWindow: number;
  allowEmergencyReserveUse: boolean;
  allowTechnicianPreference: boolean;
  allowOfficeOverride: boolean;
  autoCancelEnabled: boolean;
  showTechnicianName: boolean;
  allowPaidOneTimeMaintenance: boolean;
  confirmationTemplate: string | null;
  noAvailabilityTemplate: string | null;
  clarificationTemplate: string | null;
  maintenanceDuplicateTemplate: string | null;
  noPlanTemplate: string | null;
  defaultServiceTypeId: string | null;
  maintenanceServiceTypeId: string | null;
  proactiveOutreachEnabled: boolean;
};

export type CapacityQuery = {
  companyId: string;
  date: string;
  appointmentWindowId?: string | null;
  serviceTypeId?: string | null;
  technicianId?: string | null;
  maintenance?: boolean;
  allowEmergencyReserve?: boolean;
  now?: Date;
};

export type CapacityRejectionReason =
  | "technician_inactive"
  | "not_working"
  | "window_unavailable"
  | "no_remaining_capacity"
  | "ineligible_service_type"
  | "locked_conflict"
  | "company_window_full"
  | "company_day_full"
  | "outside_horizon"
  | "same_day_disabled"
  | "weekend_disabled"
  | "min_notice"
  | "window_inactive"
  | "preference_mismatch";

export type CapacityOption = {
  technicianId: string;
  technicianName: string;
  windowId: string;
  windowName: string;
  windowLabel: string;
  startMinutes: number;
  endMinutes: number;
  daypart: AppointmentDaypart;
  date: string;
  configuredCapacity: number;
  usedCapacity: number;
  remainingCapacity: number;
  dayWorkload: number;
  companyRemaining: number | null;
  eligibility: "eligible";
  ranking: RankingComponents;
};

export type RejectedCapacityOption = {
  technicianId: string;
  technicianName: string;
  windowId: string;
  date: string;
  reasons: CapacityRejectionReason[];
};

export type CapacityResult = {
  date: string;
  options: CapacityOption[];
  rejected: RejectedCapacityOption[];
  companyWindowUsed: Record<string, number>;
  companyDayUsed: number;
};

export type SchedulingIntent = {
  requestedDate?: string | null;
  requestedDateEnd?: string | null;
  requestedDaypart?: AppointmentDaypart | null;
  requestedWindowId?: string | null;
  requestedStartMinutes?: number | null;
  requestedEndMinutes?: number | null;
  serviceIntent?: string | null;
  maintenanceIntent?: boolean;
  urgency?: "normal" | "emergency" | null;
  rescheduleIntent?: boolean;
  cancelIntent?: boolean;
  humanRequested?: boolean;
  missingField?: "date" | "daypart" | "window" | "appointment" | "service" | null;
  confidence: "high" | "low";
};

export const DEFAULT_POLICY: SchedulingPolicyView = {
  autoBookingEnabled: false,
  allowSameDay: true,
  allowWeekend: false,
  minNoticeMinutes: 120,
  standardHorizonDays: 90,
  maintenanceHorizonDays: 365,
  maxJobsPerWindow: null,
  maxJobsPerDay: null,
  emergencyReservePerWindow: 0,
  allowEmergencyReserveUse: false,
  allowTechnicianPreference: true,
  allowOfficeOverride: true,
  autoCancelEnabled: false,
  showTechnicianName: false,
  allowPaidOneTimeMaintenance: false,
  confirmationTemplate: null,
  noAvailabilityTemplate: null,
  clarificationTemplate: null,
  maintenanceDuplicateTemplate: null,
  noPlanTemplate: null,
  defaultServiceTypeId: null,
  maintenanceServiceTypeId: null,
  proactiveOutreachEnabled: false,
};
