import { prisma } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { AuthError, requireTenant, type TenantContext } from "@/lib/auth";
import type { CompanyRole } from "@prisma/client";

export async function requirePermission(
  permission: Permission,
  companyIdHint?: string
): Promise<TenantContext> {
  const ctx = await requireTenant(companyIdHint);
  if (!can(ctx.role, permission)) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return ctx;
}

export async function requirePermissions(
  permissions: Permission[],
  companyIdHint?: string
): Promise<TenantContext> {
  const ctx = await requireTenant(companyIdHint);
  const ok = permissions.every((p) => can(ctx.role, p));
  if (!ok) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return ctx;
}

export async function requireAnyPermission(
  permissions: Permission[],
  companyIdHint?: string
): Promise<TenantContext> {
  const ctx = await requireTenant(companyIdHint);
  if (!permissions.some((permission) => can(ctx.role, permission))) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return ctx;
}

/**
 * Tenant-scoped findFirst helper.
 * Always injects companyId from verified membership — never from raw client input alone.
 */
export async function tenantFindFirst<T>(
  ctx: TenantContext,
  model: {
    findFirst: (args: { where: Record<string, unknown> }) => Promise<T | null>;
  },
  where: Record<string, unknown>
): Promise<T | null> {
  return model.findFirst({
    where: { ...where, companyId: ctx.company.id },
  });
}

/**
 * For technician/installer assigned-only access.
 */
export function jobAccessFilter(role: CompanyRole, userId: string): Record<string, unknown> {
  if (role === "TECHNICIAN" || role === "INSTALLER") {
    return {
      assignments: { some: { userId } },
    };
  }
  return {};
}

export { can, prisma };
