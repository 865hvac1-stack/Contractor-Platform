import { prisma } from "@/lib/db";
import { randomOAuthState } from "@/lib/integrations/oauth/pkce";

const TTL_MS = 20 * 60 * 1000;

export async function createOAuthState(input: {
  companyId: string;
  userId: string;
  providerKey: string;
  codeVerifier?: string;
  redirectTo?: string;
  state?: string;
  expiresInMs?: number;
}) {
  await prisma.oAuthState.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return prisma.oAuthState.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      providerKey: input.providerKey,
      state: input.state ?? randomOAuthState(),
      codeVerifier: input.codeVerifier ?? null,
      redirectTo: input.redirectTo ?? null,
      expiresAt: new Date(Date.now() + (input.expiresInMs ?? TTL_MS)),
    },
  });
}

export async function consumeOAuthStateDetailed(state: string, expectedProviderKey?: string) {
  if (!state) return { ok: false as const, reason: "OAUTH_STATE_MISSING" as const, row: null };
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row) return { ok: false as const, reason: "OAUTH_STATE_MISSING" as const, row: null };
  await prisma.oAuthState.delete({ where: { id: row.id } }).catch(() => undefined);
  if (row.expiresAt < new Date()) {
    return { ok: false as const, reason: "OAUTH_STATE_EXPIRED" as const, row: null };
  }
  if (expectedProviderKey && row.providerKey !== expectedProviderKey) {
    return { ok: false as const, reason: "OAUTH_STATE_MISMATCH" as const, row: null };
  }
  return { ok: true as const, reason: null, row };
}

export async function consumeOAuthState(state: string) {
  const result = await consumeOAuthStateDetailed(state);
  return result.ok ? result.row : null;
}
