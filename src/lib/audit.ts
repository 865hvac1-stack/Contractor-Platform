import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "user.registered"
  | "user.login"
  | "user.logout"
  | "user.password_reset_requested"
  | "user.password_reset_completed"
  | "user.invited"
  | "user.role_changed"
  | "company.created"
  | "company.updated"
  | "company.suspended"
  | "company.reactivated"
  | "customer.created"
  | "customer.updated"
  | "property.created"
  | "property.updated"
  | "job.created"
  | "job.updated"
  | "job.status_changed"
  | "job.scheduled"
  | "estimate.created"
  | "estimate.updated"
  | "estimate.status_changed"
  | "estimate.approved"
  | "invoice.created"
  | "invoice.updated"
  | "invoice.status_changed"
  | "payment.recorded"
  | "expense.created"
  | "expense.updated"
  | "receipt.uploaded"
  | "membership.created";

export async function writeAudit(params: {
  companyId?: string | null;
  actorId?: string | null;
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        companyId: params.companyId ?? null,
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        metadata: params.metadata,
      },
    });
  } catch (error) {
    console.error("[audit] failed", error);
  }
}
