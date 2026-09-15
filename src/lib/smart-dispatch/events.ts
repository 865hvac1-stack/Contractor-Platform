import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SMART_DISPATCH_EVENTS = {
  RECOMMENDATION_CREATED: "SMART_DISPATCH_RECOMMENDATION_CREATED",
  ASSIGNMENT_ACCEPTED: "SMART_DISPATCH_ASSIGNMENT_ACCEPTED",
  RECOMMENDATION_OVERRIDDEN: "SMART_DISPATCH_RECOMMENDATION_OVERRIDDEN",
  ROUTE_PROPOSED: "SMART_DISPATCH_ROUTE_PROPOSED",
  ROUTE_APPLIED: "SMART_DISPATCH_ROUTE_APPLIED",
  APPOINTMENT_AT_RISK: "SMART_DISPATCH_APPOINTMENT_AT_RISK",
  CAPACITY_FOUND: "SMART_DISPATCH_CAPACITY_FOUND",
} as const;

export async function recordSmartDispatchEvent(input: {
  companyId: string;
  kind: string;
  jobId?: string | null;
  technicianId?: string | null;
  payload?: Record<string, unknown>;
}) {
  return prisma.smartDispatchEvent.create({
    data: {
      companyId: input.companyId,
      kind: input.kind,
      jobId: input.jobId ?? null,
      technicianId: input.technicianId ?? null,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
