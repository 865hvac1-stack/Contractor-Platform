import type { PrismaClient, QuickBooksSettings } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  parseQuickBooksEnvironment,
  resolveQuickBooksApp,
  type QuickBooksAppCredentials,
  type QuickBooksEnvironment,
} from "@/lib/quickbooks/config";

export function describeSavedQuickBooksApp(settings: QuickBooksSettings | null) {
  return {
    hasClientId: Boolean(settings?.appClientId?.trim()),
    hasSecret: Boolean(settings?.appSecretCipher && settings.appSecretIv && settings.appSecretAuthTag),
    clientId: settings?.appClientId?.trim() || "",
    environment: settings?.appEnvironment
      ? parseQuickBooksEnvironment(settings.appEnvironment)
      : parseQuickBooksEnvironment(process.env.QUICKBOOKS_ENVIRONMENT),
  };
}

export function decryptCompanyQuickBooksApp(settings: QuickBooksSettings | null): QuickBooksAppCredentials | null {
  const described = describeSavedQuickBooksApp(settings);
  if (!described.hasClientId || !described.hasSecret || !settings) return null;
  try {
    const clientSecret = decryptSecret({
      ciphertext: Buffer.from(settings.appSecretCipher!),
      iv: Buffer.from(settings.appSecretIv!),
      authTag: Buffer.from(settings.appSecretAuthTag!),
      keyVersion: settings.appSecretKeyVersion ?? 1,
    });
    if (!clientSecret) return null;
    return {
      clientId: described.clientId,
      clientSecret,
      environment: described.environment,
      source: "company",
    };
  } catch {
    return null;
  }
}

export async function loadQuickBooksAppCredentials(
  prisma: PrismaClient,
  companyId: string
): Promise<QuickBooksAppCredentials | null> {
  const settings = await prisma.quickBooksSettings.findUnique({ where: { companyId } });
  return resolveQuickBooksApp(decryptCompanyQuickBooksApp(settings));
}

export async function saveCompanyQuickBooksApp(
  prisma: PrismaClient,
  companyId: string,
  input: { clientId: string; clientSecret?: string; environment: QuickBooksEnvironment }
) {
  const existing = await prisma.quickBooksSettings.findUnique({ where: { companyId } });
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error("Enter the Intuit Client ID.");
  let cipher = existing?.appSecretCipher ?? null;
  let iv = existing?.appSecretIv ?? null;
  let authTag = existing?.appSecretAuthTag ?? null;
  let keyVersion = existing?.appSecretKeyVersion ?? null;
  if (input.clientSecret?.trim()) {
    const encrypted = encryptSecret(input.clientSecret.trim());
    cipher = Uint8Array.from(encrypted.ciphertext);
    iv = Uint8Array.from(encrypted.iv);
    authTag = Uint8Array.from(encrypted.authTag);
    keyVersion = encrypted.keyVersion;
  }
  if (!cipher || !iv || !authTag) {
    throw new Error("Enter the Intuit Client Secret.");
  }
  return prisma.quickBooksSettings.upsert({
    where: { companyId },
    create: {
      companyId,
      appClientId: clientId,
      appSecretCipher: cipher,
      appSecretIv: iv,
      appSecretAuthTag: authTag,
      appSecretKeyVersion: keyVersion ?? 1,
      appEnvironment: input.environment,
    },
    update: {
      appClientId: clientId,
      appSecretCipher: cipher,
      appSecretIv: iv,
      appSecretAuthTag: authTag,
      appSecretKeyVersion: keyVersion ?? 1,
      appEnvironment: input.environment,
    },
  });
}

export async function clearCompanyQuickBooksApp(prisma: PrismaClient, companyId: string) {
  await prisma.quickBooksSettings.upsert({
    where: { companyId },
    create: { companyId },
    update: {
      appClientId: null,
      appSecretCipher: null,
      appSecretIv: null,
      appSecretAuthTag: null,
      appSecretKeyVersion: null,
      appEnvironment: null,
    },
  });
}
