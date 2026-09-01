import type { EstimateStatus, Prisma } from "@prisma/client";

const ESTIMATE_STATUSES = new Set<string>([
  "DRAFT",
  "SENT",
  "VIEWED",
  "APPROVED",
  "DECLINED",
  "EXPIRED",
]);

export type EstimatesListQuery = {
  status?: string;
};

export function parseEstimatesListQuery(input: { status?: string }): EstimatesListQuery {
  return { status: input.status?.trim() || undefined };
}

export function estimatesWhere(companyId: string, status?: string): Prisma.EstimateWhereInput {
  if (!status || status === "ALL") return { companyId };
  if (status === "open") {
    return { companyId, status: { in: ["DRAFT", "SENT", "VIEWED"] } };
  }
  if (status === "follow_up") {
    return { companyId, status: { in: ["SENT", "VIEWED"] } };
  }
  if (status === "needs_scheduling") {
    return { companyId, status: "APPROVED", linkedJob: null, job: { is: null } };
  }
  if (ESTIMATE_STATUSES.has(status)) {
    return { companyId, status: status as EstimateStatus };
  }
  return { companyId };
}

export function estimatesListHref(status?: string) {
  if (!status || status === "ALL") return "/estimates";
  return `/estimates?status=${encodeURIComponent(status)}`;
}
