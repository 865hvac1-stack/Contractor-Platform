import type { CompanyRole, MembershipStatus } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";

export const SCHEDULING_FIELD_ROLES = ["TECHNICIAN", "INSTALLER"] as const satisfies readonly CompanyRole[];

export const SCHEDULING_ELIGIBLE_ROLES = [
  "TECHNICIAN",
  "INSTALLER",
  "COMPANY_OWNER",
  "ADMIN",
  "MANAGER",
] as const satisfies readonly CompanyRole[];

type Db = PrismaClient | Prisma.TransactionClient;

export type RosterMember = {
  userId: string;
  role: CompanyRole;
  status: MembershipStatus;
  firstName: string;
  lastName: string;
  name: string;
};

export function isSchedulingFieldRole(role: string): role is (typeof SCHEDULING_FIELD_ROLES)[number] {
  return (SCHEDULING_FIELD_ROLES as readonly string[]).includes(role);
}

export function isSchedulingEligibleRole(role: string): role is (typeof SCHEDULING_ELIGIBLE_ROLES)[number] {
  return (SCHEDULING_ELIGIBLE_ROLES as readonly string[]).includes(role);
}

export function memberDisplayName(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function resolveSchedulingRoster(input: {
  members: Array<{
    userId: string;
    role: CompanyRole;
    status: MembershipStatus;
    user: { id: string; firstName: string; lastName: string };
  }>;
  configuredUserIds: Iterable<string>;
}) {
  const configured = new Set(input.configuredUserIds);
  const active = input.members.filter((member) => member.status === "ACTIVE");
  const technicians: RosterMember[] = active
    .filter((member) => isSchedulingFieldRole(member.role) || configured.has(member.userId))
    .map((member) => ({
      userId: member.user.id,
      role: member.role,
      status: member.status,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      name: memberDisplayName(member.user),
    }));
  const technicianIds = new Set(technicians.map((row) => row.userId));
  const eligibleToAdd: RosterMember[] = active
    .filter((member) => isSchedulingEligibleRole(member.role) && !technicianIds.has(member.user.id))
    .map((member) => ({
      userId: member.user.id,
      role: member.role,
      status: member.status,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      name: memberDisplayName(member.user),
    }));
  return { technicians, eligibleToAdd };
}

export async function loadSchedulingRoster(db: Db, companyId: string) {
  const [members, weekly, eligibility] = await Promise.all([
    db.membership.findMany({
      where: { companyId, status: "ACTIVE" },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.technicianWindowAvailability.findMany({
      where: { companyId },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.technicianServiceEligibility.findMany({
      where: { companyId },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  return resolveSchedulingRoster({
    members,
    configuredUserIds: [...weekly.map((row) => row.userId), ...eligibility.map((row) => row.userId)],
  });
}
