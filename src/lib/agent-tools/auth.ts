import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

const KEY_PREFIX = "cyat_";

export type AgentToolAuth =
  | {
      ok: true;
      companyId: string;
      credentialId: string;
    }
  | { ok: false; status: 401; code: "UNAUTHORIZED"; message: string };

export function hashAgentToolKey(plaintext: string) {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateAgentToolKey() {
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `${KEY_PREFIX}${secret}`;
  return {
    plaintext,
    keyPrefix: plaintext.slice(0, 16),
    keyHash: hashAgentToolKey(plaintext),
    lastFour: plaintext.slice(-4),
  };
}

export function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function hashesMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authenticateAgentToolRequest(
  request: Request,
  db: PrismaClient | typeof prisma = prisma
): Promise<AgentToolAuth> {
  const token = readBearerToken(request);
  if (!token || !token.startsWith(KEY_PREFIX)) {
    return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Missing or invalid Agent Tool bearer key." };
  }
  const keyPrefix = token.slice(0, 16);
  const candidates = await db.agentToolCredential.findMany({
    where: { keyPrefix, revokedAt: null },
    select: { id: true, companyId: true, keyHash: true },
    take: 20,
  });
  const presented = hashAgentToolKey(token);
  const match = candidates.find((row) => hashesMatch(row.keyHash, presented));
  if (!match) {
    return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Missing or invalid Agent Tool bearer key." };
  }
  await db.agentToolCredential.update({
    where: { id: match.id },
    data: { lastUsedAt: new Date() },
  });
  return { ok: true, companyId: match.companyId, credentialId: match.id };
}
