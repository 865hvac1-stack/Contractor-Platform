import { createHmac, timingSafeEqual } from "crypto";

export type SlotTokenPayload = {
  companyId: string;
  date: string;
  windowId: string;
  serviceTypeId: string | null;
  exp: number;
};

function signingSecret() {
  const secret =
    process.env.AGENT_TOOL_SLOT_SECRET ||
    process.env.INTEGRATION_SECRET ||
    process.env.SESSION_SECRET ||
    "";
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET, INTEGRATION_SECRET, or AGENT_TOOL_SLOT_SECRET (32+ characters) is required to sign slot tokens.");
  }
  return secret;
}

function encode(value: object) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SlotTokenPayload;
}

export function signSlotToken(input: Omit<SlotTokenPayload, "exp">, ttlSeconds = 2 * 60 * 60) {
  const payload: SlotTokenPayload = { ...input, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = encode(payload);
  const signature = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySlotToken(token: string, companyId: string): SlotTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = decode(body);
    if (payload.companyId !== companyId) return null;
    if (!payload.date || !payload.windowId) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
