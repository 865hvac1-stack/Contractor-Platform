"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { CompanyRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AuthError, createSession, setActiveCompany } from "@/lib/auth";
import { landingPath } from "@/lib/workspaces";
import { requirePermission } from "@/lib/tenant";
import { acceptInviteSchema, inviteMemberSchema } from "@/lib/validators";
import { isNextRedirect, publicActionError } from "@/lib/action-errors";
import {
  acceptTeamInvite,
  deliverInviteEmail,
  inviteActionResult,
  persistTeamInvite,
  revokeTeamInvite,
  rotateInviteToken,
} from "@/lib/team/invite";
import type { ActionResult } from "@/server/actions/auth";

async function markInviteEmail(
  inviteId: string,
  result: { ok: boolean; configured?: boolean; error?: string }
) {
  await prisma.teamInvite.update({
    where: { id: inviteId },
    data: {
      lastEmailStatus: result.ok ? "sent" : result.configured === false ? "not_configured" : "failed",
      lastEmailError: result.ok ? null : result.error ?? "send_failed",
      lastEmailedAt: new Date(),
    },
  });
}

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
      temporaryPassword: formData.get("temporaryPassword") || "",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invite." };
    }

    const persisted = await persistTeamInvite(prisma, {
      companyId: ctx.company.id,
      invitedById: ctx.user.id,
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: parsed.data.role as CompanyRole,
    });
    if (!persisted.ok) return { ok: false, error: persisted.error };

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: persisted.reused ? "team.invite_refreshed" : "team.invite_created",
      entityType: "TeamInvite",
      entityId: persisted.invite.id,
      metadata: { email: persisted.invite.email, role: persisted.invite.role },
    });

    const delivered = await deliverInviteEmail({
      to: persisted.invite.email,
      companyName: ctx.company.businessName,
      role: persisted.invite.role,
      token: persisted.token,
      companyId: ctx.company.id,
    });
    await markInviteEmail(persisted.invite.id, delivered.result);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: delivered.result.ok ? "team.invite_email_sent" : "team.invite_email_failed",
      entityType: "TeamInvite",
      entityId: persisted.invite.id,
      metadata: delivered.result.ok
        ? { provider: "resend" }
        : { configured: "configured" in delivered.result ? delivered.result.configured : true },
    });

    revalidatePath("/team");
    return inviteActionResult(delivered.result, delivered.setupUrl);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function resendTeamInviteAction(inviteId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("team:manage");
    const rotated = await rotateInviteToken(prisma, inviteId, ctx.company.id);
    if (!rotated.ok) return { ok: false, error: rotated.error };

    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "team.invite_resent",
      entityType: "TeamInvite",
      entityId: rotated.invite.id,
      metadata: { email: rotated.invite.email },
    });

    const delivered = await deliverInviteEmail({
      to: rotated.invite.email,
      companyName: ctx.company.businessName,
      role: rotated.invite.role,
      token: rotated.token,
      companyId: ctx.company.id,
    });
    await markInviteEmail(rotated.invite.id, delivered.result);
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: delivered.result.ok ? "team.invite_email_sent" : "team.invite_email_failed",
      entityType: "TeamInvite",
      entityId: rotated.invite.id,
      metadata: delivered.result.ok
        ? { provider: "resend" }
        : { configured: "configured" in delivered.result ? delivered.result.configured : true },
    });
    revalidatePath("/team");
    return inviteActionResult(delivered.result, delivered.setupUrl);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function revokeTeamInviteAction(inviteId: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("team:manage");
    const result = await revokeTeamInvite(prisma, inviteId, ctx.company.id);
    if (!result.ok) return { ok: false, error: result.error };
    await writeAudit({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "team.invite_revoked",
      entityType: "TeamInvite",
      entityId: result.invite.id,
      metadata: { email: result.invite.email },
    });
    revalidatePath("/team");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function acceptInviteAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const parsed = acceptInviteSchema.safeParse({
      token: formData.get("token"),
      password: formData.get("password"),
    });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid setup request." };

    const accepted = await acceptTeamInvite(prisma, {
      token: parsed.data.token,
      password: parsed.data.password,
    });
    if (!accepted.ok) return { ok: false, error: accepted.error };

    await createSession(accepted.user.id);
    await setActiveCompany(accepted.companyId, accepted.user.id);
    await writeAudit({
      companyId: accepted.companyId,
      actorId: accepted.user.id,
      action: "team.invite_accepted",
      entityType: "TeamInvite",
      entityId: accepted.membership.id,
      metadata: { role: accepted.role },
    });

    redirect(landingPath(accepted.role));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return { ok: false, error: publicActionError(error) };
  }
}
