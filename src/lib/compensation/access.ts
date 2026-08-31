import type { CompanyRole } from "@prisma/client";
import { can } from "@/lib/permissions";

export function compensationUserFilter(role: CompanyRole, viewerId: string, requestedUserId?: string | null) {
  if (can(role, "compensation:view_all")) {
    return requestedUserId ? { userId: requestedUserId } : {};
  }
  if (can(role, "compensation:view_own")) {
    return { userId: viewerId };
  }
  return null;
}

export function canViewOtherCompensation(role: CompanyRole) {
  return can(role, "compensation:view_all");
}

export function canViewTeamPerformance(role: CompanyRole) {
  return can(role, "performance:view_team");
}
