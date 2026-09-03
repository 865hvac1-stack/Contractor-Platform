import type { PrismaClient } from "@prisma/client";
import {
  highLevelErrorMessage,
  inspectHighLevelContactGet,
  inspectHighLevelConversationsSearch,
} from "@/lib/highlevel/client";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { sanitizeHighLevelErrorMessage } from "@/lib/highlevel/sanitize-error";

export const HIGHLEVEL_CONVERSATIONS_DIAGNOSTIC_VERSIONS = ["2021-04-15", "2021-07-28", "v3"] as const;

export type HighLevelApiProbeRow = {
  endpoint: string;
  version: string;
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
  conversationsReturned: boolean;
  contactObjectReturned: boolean;
  topLevelKeys: string[];
};

export type HighLevelConversationsDiagnostic = {
  locationId: string;
  authMode: "oauth" | "private_token";
  mappedContactTested: boolean;
  probes: HighLevelApiProbeRow[];
};

export function sanitizeHighLevelPublicError(message: string | null) {
  return sanitizeHighLevelErrorMessage(message);
}

function errorCodeFromBody(data: unknown, httpStatus: number) {
  if (!data || typeof data !== "object") return String(httpStatus);
  const row = data as { statusCode?: unknown; error?: unknown; code?: unknown };
  if (typeof row.statusCode === "number") return String(row.statusCode);
  if (typeof row.code === "string" && row.code.trim()) return row.code.trim();
  if (typeof row.error === "string" && /^[A-Za-z0-9_-]+$/.test(row.error)) return row.error;
  return String(httpStatus);
}

function conversationsArrayReturned(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const row = data as { conversations?: unknown };
  if (Array.isArray(row.conversations)) return true;
  if (row.conversations && typeof row.conversations === "object") {
    return Array.isArray((row.conversations as { conversations?: unknown }).conversations);
  }
  return false;
}

function contactObjectReturned(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const row = data as { contact?: { id?: unknown }; id?: unknown };
  if (row.contact && typeof row.contact === "object" && row.contact.id) return true;
  return Boolean(row.id);
}

function topLevelKeys(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.keys(data).slice(0, 24);
}

export function formatConversationsDiagnostic(result: HighLevelConversationsDiagnostic) {
  const lines = [
    `HighLevel API diagnostic · authMode=${result.authMode} · locationId=${result.locationId} · mappedContact=${result.mappedContactTested ? "yes" : "no"}`,
  ];
  for (const probe of result.probes) {
    lines.push(
      [
        probe.endpoint,
        `Version=${probe.version}`,
        `HTTP ${probe.httpStatus}`,
        `code=${probe.errorCode ?? "none"}`,
        probe.errorMessage ? `error=${probe.errorMessage}` : "error=none",
        `conversationsArray=${probe.conversationsReturned ? "yes" : "no"}`,
        `contactObject=${probe.contactObjectReturned ? "yes" : "no"}`,
        `keys=${probe.topLevelKeys.join(",") || "none"}`,
      ].join(" · ")
    );
  }
  return lines.join("\n");
}

export async function diagnoseHighLevelConversationsApi(
  prisma: PrismaClient,
  companyId: string
): Promise<HighLevelConversationsDiagnostic> {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) throw new Error("HighLevel is not connected.");

  const mapped = await prisma.providerIdentityMap.findFirst({
    where: { companyId, provider: HIGHLEVEL_PROVIDER_KEY, entityType: "CONTACT" },
    select: { externalId: true },
    orderBy: { updatedAt: "desc" },
  });

  const probes: HighLevelApiProbeRow[] = [];
  for (const version of HIGHLEVEL_CONVERSATIONS_DIAGNOSTIC_VERSIONS) {
    const inspected = await inspectHighLevelConversationsSearch({
      accessToken: access.accessToken,
      locationId: access.locationId,
      version,
    });
    probes.push({
      endpoint: "GET /conversations/search",
      version,
      httpStatus: inspected.status,
      errorCode: inspected.ok ? null : errorCodeFromBody(inspected.data, inspected.status),
      errorMessage: inspected.ok ? null : sanitizeHighLevelPublicError(highLevelErrorMessage(inspected.data) || inspected.errorMessage),
      conversationsReturned: conversationsArrayReturned(inspected.data),
      contactObjectReturned: false,
      topLevelKeys: topLevelKeys(inspected.data),
    });
  }

  if (mapped?.externalId) {
    for (const version of HIGHLEVEL_CONVERSATIONS_DIAGNOSTIC_VERSIONS) {
      const inspected = await inspectHighLevelContactGet({
        accessToken: access.accessToken,
        contactId: mapped.externalId,
        version,
      });
      probes.push({
        endpoint: "GET /contacts/:id",
        version,
        httpStatus: inspected.status,
        errorCode: inspected.ok ? null : errorCodeFromBody(inspected.data, inspected.status),
        errorMessage: inspected.ok ? null : sanitizeHighLevelPublicError(highLevelErrorMessage(inspected.data) || inspected.errorMessage),
        conversationsReturned: false,
        contactObjectReturned: inspected.ok && contactObjectReturned(inspected.data),
        topLevelKeys: topLevelKeys(inspected.data),
      });
    }
  }

  const result: HighLevelConversationsDiagnostic = {
    locationId: access.locationId,
    authMode: access.authMode,
    mappedContactTested: Boolean(mapped?.externalId),
    probes,
  };

  console.info(
    JSON.stringify({
      event: "highlevel.conversations.diagnostic",
      locationId: result.locationId,
      authMode: result.authMode,
      mappedContactTested: result.mappedContactTested,
      probes: result.probes,
    })
  );

  return result;
}
