import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { LastResultSet, RecordKind } from "@/lib/actions/types";

export function parseLastResultSet(value: unknown): LastResultSet | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<LastResultSet>;
  if (!row.kind || !Array.isArray(row.ids)) return null;
  const ids = row.ids.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 50);
  return {
    kind: row.kind,
    ids,
    actionRequestId: row.actionRequestId ?? null,
    criteria: row.criteria,
    updatedAt: row.updatedAt || new Date().toISOString(),
  };
}

export async function loadLastResultSet(companyId: string, conversationId?: string | null) {
  if (!conversationId) return null;
  const conversation = await prisma.aIConversation.findFirst({
    where: { id: conversationId, companyId },
    select: { lastResultSet: true },
  });
  return parseLastResultSet(conversation?.lastResultSet);
}

export async function saveLastResultSet(
  companyId: string,
  conversationId: string | null | undefined,
  set: Omit<LastResultSet, "updatedAt">
) {
  if (!conversationId) return;
  await prisma.aIConversation.updateMany({
    where: { id: conversationId, companyId },
    data: {
      lastResultSet: {
        ...set,
        updatedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
}

export function resolveRequestedIds(input: {
  requestedIds?: string[] | null;
  lastResult?: LastResultSet | null;
  expectedKind?: RecordKind;
  source: "planner" | "model" | "ui" | "attention";
}) {
  const requested = (input.requestedIds ?? []).filter(Boolean);
  const last = input.lastResult;
  if (input.source === "model") {
    if (requested.length && last?.ids.length) {
      if (input.expectedKind && last.kind !== input.expectedKind) {
        return { ok: false as const, error: "Those records do not match the last verified result set.", ids: [] };
      }
      const allowed = new Set(last.ids);
      const ids = requested.filter((id) => allowed.has(id));
      if (ids.length === 0) {
        return { ok: false as const, error: "The model supplied record IDs that were not in the verified result set.", ids: [] };
      }
      return { ok: true as const, ids };
    }
    if (!requested.length && last?.ids.length) {
      if (input.expectedKind && last.kind !== input.expectedKind) {
        return { ok: false as const, error: "Ask me to look those records up again.", ids: [] };
      }
      return { ok: true as const, ids: last.ids };
    }
  }
  if (requested.length) return { ok: true as const, ids: requested };
  if (last?.ids.length && (!input.expectedKind || last.kind === input.expectedKind)) {
    return { ok: true as const, ids: last.ids };
  }
  return { ok: true as const, ids: [] as string[] };
}
