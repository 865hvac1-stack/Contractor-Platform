import type { CompanyRole, PrismaClient } from "@prisma/client";
import { generateToken, hashPassword, hashToken } from "@/lib/auth";
import { inviteStatus, type InviteStatus } from "@/lib/team/invite-status";
import { inviteEmailCopy, inviteSetupUrl } from "@/lib/email/invite";
import { sendTransactionalEmail, type EmailSendResult } from "@/lib/email/resend";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function appBaseUrl() {
  return (process.env.APP_URL || "http://127.0.0.1:43123").replace(/\/$/, "");
}

export function inviteActionResult(
  email: EmailSendResult,
  setupUrl: string
): { ok: true; message: string } | { ok: false; error: string; setupUrl?: string } {
  if (email.ok) {
    return { ok: true, message: "Invite email sent." };
  }
  if (!email.configured) {
    return {
      ok: false,
      error:
        "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM (or RESEND_FROM) on the server. The invitation was saved as Pending so you can resend after configuration.",
      setupUrl,
    };
  }
  return {
    ok: false,
    error: `The invitation was saved, but the email provider did not send it. ${email.error} Retry from the Team page.`,
    setupUrl,
  };
}

export async function persistTeamInvite(
  prisma: PrismaClient,
  input: {
    companyId: string;
    invitedById: string;
    email: string;
    firstName: string;
    lastName: string;
    role: CompanyRole;
    now?: Date;
  }
) {
  const email = input.email.toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const member = await prisma.membership.findUnique({
      where: { companyId_userId: { companyId: input.companyId, userId: existingUser.id } },
    });
    if (member) {
      return { ok: false as const, error: "User is already a member of this company." };
    }
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date((input.now ?? new Date()).getTime() + INVITE_TTL_MS);

  const pending = await prisma.teamInvite.findFirst({
    where: {
      companyId: input.companyId,
      email,
      acceptedAt: null,
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  const invite = pending
    ? await prisma.teamInvite.update({
        where: { id: pending.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          tokenHash,
          expiresAt,
          userId: existingUser?.id ?? pending.userId,
        },
      })
    : await prisma.teamInvite.create({
        data: {
          companyId: input.companyId,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          tokenHash,
          invitedById: input.invitedById,
          userId: existingUser?.id ?? null,
          expiresAt,
        },
      });

  return { ok: true as const, invite, token, reused: Boolean(pending) };
}

export async function deliverInviteEmail(input: {
  to: string;
  companyName: string;
  role: CompanyRole;
  token: string;
}): Promise<{ result: EmailSendResult; setupUrl: string }> {
  const setupUrl = inviteSetupUrl(appBaseUrl(), input.token);
  const copy = inviteEmailCopy({
    companyName: input.companyName,
    role: input.role,
    setupUrl,
  });
  const result = await sendTransactionalEmail({
    to: input.to,
    subject: copy.subject,
    html: copy.html,
    text: copy.text,
  });
  return { result, setupUrl };
}

export async function acceptTeamInvite(
  prisma: PrismaClient,
  input: { token: string; password: string; now?: Date }
) {
  const tokenHash = hashToken(input.token);
  const invite = await prisma.teamInvite.findUnique({ where: { tokenHash } });
  if (!invite) return { ok: false as const, error: "This invitation is invalid." };

  const status: InviteStatus = inviteStatus({ ...invite, now: input.now });
  if (status === "REVOKED") return { ok: false as const, error: "This invitation was revoked." };
  if (status === "EXPIRED") return { ok: false as const, error: "This invitation has expired." };
  if (status === "ACCEPTED") return { ok: false as const, error: "This invitation was already used." };

  const passwordHash = await hashPassword(input.password);
  const email = invite.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, firstName: user.firstName || invite.firstName, lastName: user.lastName || invite.lastName },
    });
  }

  const existing = await prisma.membership.findUnique({
    where: { companyId_userId: { companyId: invite.companyId, userId: user.id } },
  });
  const membership =
    existing ??
    (await prisma.membership.create({
      data: {
        companyId: invite.companyId,
        userId: user.id,
        role: invite.role,
        status: "ACTIVE",
        invitedById: invite.invitedById,
        invitedAt: invite.createdAt,
        joinedAt: new Date(),
      },
    }));

  await prisma.teamInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date(), userId: user.id, tokenHash: hashToken(generateToken()) },
  });

  return { ok: true as const, user, membership, role: invite.role, companyId: invite.companyId };
}

export async function rotateInviteToken(
  prisma: PrismaClient,
  inviteId: string,
  companyId: string,
  now?: Date
) {
  const invite = await prisma.teamInvite.findFirst({ where: { id: inviteId, companyId } });
  if (!invite) return { ok: false as const, error: "Invite not found." };
  if (invite.acceptedAt) return { ok: false as const, error: "This invitation was already accepted." };
  if (invite.revokedAt) return { ok: false as const, error: "This invitation was revoked." };
  const token = generateToken();
  const updated = await prisma.teamInvite.update({
    where: { id: invite.id },
    data: {
      tokenHash: hashToken(token),
      expiresAt: new Date((now ?? new Date()).getTime() + INVITE_TTL_MS),
    },
  });
  return { ok: true as const, invite: updated, token };
}

export async function revokeTeamInvite(prisma: PrismaClient, inviteId: string, companyId: string) {
  const invite = await prisma.teamInvite.findFirst({ where: { id: inviteId, companyId } });
  if (!invite) return { ok: false as const, error: "Invite not found." };
  if (invite.acceptedAt) return { ok: false as const, error: "Accepted invitations cannot be revoked." };
  if (invite.revokedAt) return { ok: true as const, invite };
  const updated = await prisma.teamInvite.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });
  return { ok: true as const, invite: updated };
}
