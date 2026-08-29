"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { requirePermission } from "@/lib/tenant";
import { AuthError } from "@/lib/auth";
import { inviteMemberSchema } from "@/lib/validators";
import type { ActionResult } from "@/server/actions/auth";
import { requirePlatformAdmin } from "@/lib/auth";

export async function inviteTeamMemberAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("team:manage");
    const parsed = inviteMemberSchema.safeParse({
      email: formData.get("email"),
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      role: formData.get("role"),
      temporaryPassword: formData.get("temporaryPassword"),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invite." };
    }

    const email = parsed.data.email.toLowerCase();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          passwordHash: await hashPassword(parsed.data.temporaryPassword),
        },
      });
    }

    const existing = await prisma.membership.findUnique({
      where: { companyId_userId: { companyId: ctx.company.id, userId: user.id } },
    });
    if (existing) return { ok: false, error: "User is already a member of this company." };

    const membership = await prisma.membership.create({
      data: {
        companyId: ctx.company.id,
        userId: user.id,
        role: parsed.data.role,
        status: "ACTIVE",
        invitedById: ctx.user.id,
        invitedAt: new Date(),
        joinedAt: new Date(),
      },
    });

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "user.invited",
      entityType: "Membership",
      entityId: membership.id,
      metadata: { email, role: parsed.data.role },
    });

    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

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
