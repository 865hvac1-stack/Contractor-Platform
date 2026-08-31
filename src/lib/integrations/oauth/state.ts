import { prisma } from "@/lib/db";
import { randomOAuthState } from "@/lib/integrations/oauth/pkce";

const TTL_MS = 10 * 60 * 1000;

export async function createOAuthState(input: {
  companyId: string;
  userId: string;
  providerKey: string;
  codeVerifier?: string;
  redirectTo?: string;
  state?: string;
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
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
}

export async function consumeOAuthState(state: string) {
  if (!state) return null;
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row) return null;
  await prisma.oAuthState.delete({ where: { id: row.id } }).catch(() => undefined);
  if (row.expiresAt < new Date()) return null;
  return row;
}
