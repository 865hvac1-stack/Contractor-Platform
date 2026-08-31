import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function databaseUrlWithPoolLimit(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  if (/[?&]connection_limit=/.test(raw)) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  const limit = process.env.PRISMA_CONNECTION_LIMIT || "5";
  return `${raw}${joiner}connection_limit=${limit}&pool_timeout=20`;
}

const databaseUrl = databaseUrlWithPoolLimit();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
  });

globalForPrisma.prisma = prisma;
