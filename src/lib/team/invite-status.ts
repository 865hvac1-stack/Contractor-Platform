export type InviteStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export function inviteStatus(invite: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  now?: Date;
}): InviteStatus {
  if (invite.revokedAt) return "REVOKED";
  if (invite.acceptedAt) return "ACCEPTED";
  if (invite.expiresAt.getTime() <= (invite.now ?? new Date()).getTime()) return "EXPIRED";
  return "PENDING";
}
