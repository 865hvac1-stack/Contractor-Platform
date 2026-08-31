import { prisma } from "@/lib/db";
import { scopedCompanyWhere } from "@/lib/intelligence/scope";
import {
  decryptProviderTokens,
  encryptProviderTokens,
  type ProviderTokenPayload,
} from "@/lib/integrations/crypto";
import { refreshGoogleToken } from "@/lib/integrations/oauth/google";
import { refreshTikTokToken } from "@/lib/integrations/oauth/tiktok";
import { refreshQuickBooksToken } from "@/lib/quickbooks/oauth";
import { loadQuickBooksAppCredentials } from "@/lib/quickbooks/app";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import type { IntegrationStatus } from "@prisma/client";

export async function upsertConnection(input: {
  companyId: string;
  providerKey: string;
  status?: IntegrationStatus;
  accountLabel?: string | null;
  externalAccountId?: string | null;
  scopes?: string[];
  healthMessage?: string | null;
  errorMessage?: string | null;
}) {
  return prisma.integrationConnection.upsert({
    where: { companyId_providerKey: { companyId: input.companyId, providerKey: input.providerKey } },
    create: {
      companyId: input.companyId,
      providerKey: input.providerKey,
      status: input.status ?? "CONNECTING",
      accountLabel: input.accountLabel ?? null,
      externalAccountId: input.externalAccountId ?? null,
      scopes: input.scopes ?? [],
      healthMessage: input.healthMessage ?? null,
      errorMessage: input.errorMessage ?? null,
    },
    update: {
      status: input.status,
      accountLabel: input.accountLabel === undefined ? undefined : input.accountLabel,
      externalAccountId: input.externalAccountId === undefined ? undefined : input.externalAccountId,
      scopes: input.scopes,
      healthMessage: input.healthMessage === undefined ? undefined : input.healthMessage,
      errorMessage: input.errorMessage === undefined ? undefined : input.errorMessage,
      disabledAt: input.status === "DISABLED" ? new Date() : null,
    },
  });
}

export async function saveConnectionTokens(input: {
  companyId: string;
  connectionId: string;
  tokens: ProviderTokenPayload;
}) {
  const encrypted = encryptProviderTokens(input.tokens);
  const expiresAt = input.tokens.expiresAt ? new Date(input.tokens.expiresAt) : null;
  await prisma.integrationCredential.upsert({
    where: { connectionId: input.connectionId },
    create: {
      companyId: input.companyId,
      connectionId: input.connectionId,
      ciphertext: Uint8Array.from(encrypted.ciphertext),
      iv: Uint8Array.from(encrypted.iv),
      authTag: Uint8Array.from(encrypted.authTag),
      keyVersion: encrypted.keyVersion,
      tokenExpiresAt: expiresAt,
    },
    update: {
      ciphertext: Uint8Array.from(encrypted.ciphertext),
      iv: Uint8Array.from(encrypted.iv),
      authTag: Uint8Array.from(encrypted.authTag),
      keyVersion: encrypted.keyVersion,
      tokenExpiresAt: expiresAt,
    },
  });
}

export async function loadConnectionTokens(companyId: string, connectionId: string) {
  const row = await prisma.integrationCredential.findFirst({
    where: { companyId, connectionId },
  });
  if (!row) return null;
  return decryptProviderTokens({
    ciphertext: Buffer.from(row.ciphertext),
    iv: Buffer.from(row.iv),
    authTag: Buffer.from(row.authTag),
    keyVersion: row.keyVersion,
  });
}

export async function getValidAccessToken(input: {
  companyId: string;
  connectionId: string;
  providerKey: string;
}) {
  const tokens = await loadConnectionTokens(input.companyId, input.connectionId);
  if (!tokens) return null;
  const expires = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : 0;
  const soon = Date.now() + 60_000;
  if (expires && expires > soon) return tokens;

  if (!tokens.refreshToken) return tokens;
  try {
    const refreshed =
      input.providerKey.startsWith("google_") || input.providerKey === "youtube"
        ? await refreshGoogleToken(tokens.refreshToken)
        : input.providerKey.startsWith("tiktok")
          ? await refreshTikTokToken(tokens.refreshToken)
          : input.providerKey === QUICKBOOKS_PROVIDER_KEY
            ? await refreshQuickBooksToken(tokens.refreshToken, await loadQuickBooksAppCredentials(prisma, input.companyId))
            : tokens;
    await saveConnectionTokens({
      companyId: input.companyId,
      connectionId: input.connectionId,
      tokens: { ...tokens, ...refreshed },
    });
    return { ...tokens, ...refreshed };
  } catch {
    await prisma.integrationConnection.update({
      where: { id: input.connectionId },
      data: {
        status: "REAUTH_REQUIRED",
        errorMessage: "Authorization expired. Reconnect this provider.",
      },
    });
    return null;
  }
}

export async function deleteConnectionCredentials(companyId: string, connectionId: string) {
  await prisma.integrationCredential.deleteMany({
    where: { companyId, connectionId },
  });
}

export async function getCompanyConnection(companyId: string, providerKey: string) {
  return prisma.integrationConnection.findFirst({
    where: scopedCompanyWhere(companyId, { providerKey }),
    include: { accounts: true },
  });
}
