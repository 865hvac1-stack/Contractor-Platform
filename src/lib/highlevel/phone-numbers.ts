import type { PrismaClient } from "@prisma/client";
import { HL_DEFAULT_CHANNEL, HIGHLEVEL_PROVIDER_KEY, SMS_DEFAULT_CHANNEL } from "@/lib/highlevel/config";
import {
  listHighLevelActiveNumbers,
  listHighLevelAvailableNumbers,
  type HighLevelAvailableNumber,
  type HighLevelPhoneNumber,
} from "@/lib/highlevel/client";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { assertHighLevelLocationToken } from "@/lib/highlevel/location-token";
import { normalizePhoneDigits } from "@/lib/highlevel/identity";

export type ParsedHighLevelNumber = {
  phoneNumber: string;
  digits: string;
  friendlyName: string | null;
  countryCode: string | null;
  isDefaultNumber: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function parseHighLevelActiveNumbers(payload: unknown): ParsedHighLevelNumber[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const raw = Array.isArray(data.numbers)
    ? data.numbers
    : Array.isArray(root.numbers)
      ? root.numbers
      : Array.isArray(root.data)
        ? root.data
        : [];
  const out: ParsedHighLevelNumber[] = [];
  for (const item of raw) {
    const row = asRecord(item) as HighLevelPhoneNumber & Record<string, unknown>;
    const phoneNumber = text(row.phoneNumber) || text(row.phone);
    const digits = normalizePhoneDigits(phoneNumber);
    if (!phoneNumber || !digits) continue;
    out.push({
      phoneNumber,
      digits,
      friendlyName: text(row.friendlyName) || null,
      countryCode: text(row.countryCode) || null,
      isDefaultNumber: row.isDefaultNumber === true,
    });
  }
  return out;
}

export function parseHighLevelAvailableNumbers(payload: unknown): {
  fingerprintId: string | null;
  numbers: Array<{ phoneNumber: string; friendlyName: string | null }>;
} {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const raw = (Array.isArray(data.numbers) ? data.numbers : Array.isArray(root.numbers) ? root.numbers : []) as HighLevelAvailableNumber[];
  return {
    fingerprintId: text(data.fingerprintId) || text(root.fingerprintId) || null,
    numbers: raw
      .map((row) => ({
        phoneNumber: text(row.phoneNumber),
        friendlyName: text(row.friendlyName) || null,
      }))
      .filter((row) => row.phoneNumber),
  };
}

export async function findTrackingNumberByPhone(
  prisma: PrismaClient,
  companyId: string,
  phone?: string | null
) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const numbers = await prisma.trackingNumber.findMany({
    where: { companyId, status: "ACTIVE" },
  });
  return (
    numbers.find((row) => {
      const rowDigits = normalizePhoneDigits(row.phoneNumber);
      return rowDigits && (rowDigits === digits || rowDigits.endsWith(digits.slice(-10)) || digits.endsWith(rowDigits.slice(-10)));
    }) ?? null
  );
}

export async function resolveApprovedSenderNumber(prisma: PrismaClient, companyId: string) {
  const numbers = await prisma.trackingNumber.findMany({
    where: { companyId, provider: HIGHLEVEL_PROVIDER_KEY, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
  });
  const approved = numbers.find((row) => row.channel === SMS_DEFAULT_CHANNEL);
  if (approved) return { phoneNumber: approved.phoneNumber, reason: "company_default" as const };
  const providerDefault = numbers.find((row) => row.channel === HL_DEFAULT_CHANNEL);
  if (providerDefault) return { phoneNumber: providerDefault.phoneNumber, reason: "highlevel_default" as const };
  return null;
}

export async function syncHighLevelActiveNumbers(prisma: PrismaClient, companyId: string) {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) {
    return { ok: false as const, error: "HighLevel is not connected for this company.", synced: 0 };
  }
  assertHighLevelLocationToken(access);
  const payload = await listHighLevelActiveNumbers({
    accessToken: access.accessToken,
    locationId: access.locationId,
  });
  const numbers = parseHighLevelActiveNumbers(payload);
  let synced = 0;
  for (const number of numbers) {
    const existing = await findTrackingNumberByPhone(prisma, companyId, number.phoneNumber);
    if (existing) {
      await prisma.trackingNumber.update({
        where: { id: existing.id },
        data: {
          phoneNumber: number.phoneNumber,
          provider: HIGHLEVEL_PROVIDER_KEY,
          status: "ACTIVE",
          channel:
            existing.channel === SMS_DEFAULT_CHANNEL
              ? SMS_DEFAULT_CHANNEL
              : number.isDefaultNumber
                ? HL_DEFAULT_CHANNEL
                : existing.channel,
        },
      });
    } else {
      await prisma.trackingNumber.create({
        data: {
          companyId,
          phoneNumber: number.phoneNumber,
          source: "HIGHLEVEL",
          campaign: number.friendlyName,
          channel: number.isDefaultNumber ? HL_DEFAULT_CHANNEL : null,
          provider: HIGHLEVEL_PROVIDER_KEY,
          status: "ACTIVE",
        },
      });
    }
    synced += 1;
  }
  return { ok: true as const, synced, locationId: access.locationId, numbers };
}

export async function searchHighLevelInventory(
  prisma: PrismaClient,
  companyId: string,
  input: { countryCode?: string; areaCode?: string }
) {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) {
    return { ok: false as const, error: "HighLevel is not connected for this company.", numbers: [] as Array<{ phoneNumber: string; friendlyName: string | null }> };
  }
  assertHighLevelLocationToken(access);
  const payload = await listHighLevelAvailableNumbers({
    accessToken: access.accessToken,
    locationId: access.locationId,
    countryCode: input.countryCode || "US",
    firstPart: input.areaCode,
    anywhere: input.areaCode,
    lastPart: input.areaCode ? "" : undefined,
    numberTypes: "local",
    smsEnabled: true,
    voiceEnabled: true,
  });
  const parsed = parseHighLevelAvailableNumbers(payload);
  return { ok: true as const, ...parsed };
}

export async function assertHighLevelLocationAvailable(
  prisma: PrismaClient,
  locationId: string,
  companyId: string
) {
  const taken = await prisma.integrationConnection.findFirst({
    where: {
      providerKey: HIGHLEVEL_PROVIDER_KEY,
      externalAccountId: locationId,
      companyId: { not: companyId },
    },
    select: { companyId: true },
  });
  if (taken) {
    return { ok: false as const, error: "That HighLevel location is already linked to another ContractorYou company." };
  }
  return { ok: true as const };
}
