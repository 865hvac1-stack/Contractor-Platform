"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import type { ActionResult } from "@/server/actions/auth";
import { requirePlatformAdmin } from "@/lib/auth";

export async function updateMemberRoleAction(
  membershipId: string,
  role: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("team:manage");
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, companyId: ctx.company.id },
    });
    if (!membership) return { ok: false, error: "Member not found." };

    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: role as typeof membership.role },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "user.role_changed",
      entityType: "Membership",
      entityId: membership.id,
      metadata: { from: membership.role, to: role },
    });

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function suspendCompanyAction(
  companyId: string,
  reason: string
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return { ok: false, error: "Company not found." };

    await prisma.company.update({
      where: { id: companyId },
      data: {
        status: "SUSPENDED",
        suspendedAt: new Date(),
        suspendedReason: reason || "Suspended by platform admin",
      },
    });

    await writeAudit({
      companyId,
      actorId: admin.id,
      action: "company.suspended",
      entityType: "Company",
      entityId: companyId,
      metadata: { reason },
    });

    revalidatePath("/platform");
    revalidatePath(`/platform/companies/${companyId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function reactivateCompanyAction(companyId: string): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await prisma.company.update({
      where: { id: companyId },
      data: {
        status: "ACTIVE",
        suspendedAt: null,
        suspendedReason: null,
      },
    });

    await writeAudit({
      companyId,
      actorId: admin.id,
      action: "company.reactivated",
      entityType: "Company",
      entityId: companyId,
    });

    revalidatePath("/platform");
    revalidatePath(`/platform/companies/${companyId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function setExternalIntegrationTestingAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const companyId = String(formData.get("companyId") || "").trim();
    const enabled = String(formData.get("enabled") || "") === "true";
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) return { ok: false, error: "Company not found." };
    await prisma.company.update({
      where: { id: companyId },
      data: { allowExternalIntegrationTesting: enabled },
    });
    await writeAudit({
      companyId,
      actorId: admin.id,
      action: enabled ? "company.integration_testing.enabled" : "company.integration_testing.disabled",
      entityType: "Company",
      entityId: companyId,
    });
    revalidatePath(`/platform/companies/${companyId}`);
    return {
      ok: true,
      message: enabled ? "External integration testing enabled." : "External integration testing disabled.",
    };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}
