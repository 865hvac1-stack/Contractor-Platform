import {
  HIGHLEVEL_API_BASE,
  HIGHLEVEL_API_VERSION,
  HIGHLEVEL_CONVERSATIONS_API_VERSION,
  HIGHLEVEL_LOCATION_API_VERSION,
  HIGHLEVEL_PHONE_API_VERSION,
} from "@/lib/highlevel/config";

export type HighLevelContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  locationId?: string;
  dateAdded?: string;
  tags?: string[];
};

export type HighLevelLocation = {
  id: string;
  name?: string;
  companyId?: string;
};

export class HighLevelApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function highlevelRequest<T>(input: {
  accessToken: string;
  path: string;
  method?: string;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  version?: string;
}): Promise<T> {
  const url = new URL(`${HIGHLEVEL_API_BASE}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Version: input.version ?? HIGHLEVEL_API_VERSION,
      Accept: "application/json",
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new HighLevelApiError(
      typeof data.message === "string" ? data.message : `HighLevel request failed (${response.status}).`,
      response.status
    );
  }
  return data;
}

function jsonObjectKeys(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.keys(data).slice(0, 24);
}

export type HighLevelInspectedResponse<T> = {
  status: number;
  ok: boolean;
  keys: string[];
  data: T;
  errorMessage: string | null;
};

async function inspectHighLevelRequest<T>(input: {
  accessToken: string;
  path: string;
  query?: Record<string, string | undefined>;
  version?: string;
}): Promise<HighLevelInspectedResponse<T>> {
  const url = new URL(`${HIGHLEVEL_API_BASE}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Version: input.version ?? HIGHLEVEL_API_VERSION,
      Accept: "application/json",
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  return {
    status: response.status,
    ok: response.ok,
    keys: jsonObjectKeys(data),
    data,
    errorMessage: response.ok
      ? null
      : typeof data.message === "string"
        ? data.message
        : `HighLevel request failed (${response.status}).`,
  };
}

export function locationFromHighLevelPayload(data: { location?: HighLevelLocation } | HighLevelLocation | null | undefined) {
  if (!data || typeof data !== "object") return null;
  if ("location" in data && data.location && typeof data.location === "object") return data.location;
  const row = data as HighLevelLocation;
  return row.id ? row : null;
}

export async function fetchHighLevelLocation(accessToken: string, locationId: string) {
  const inspected = await inspectHighLevelLocation(accessToken, locationId);
  if (!inspected.ok || !inspected.location) {
    throw new HighLevelApiError(inspected.errorMessage || "HighLevel location probe failed.", inspected.status);
  }
  return inspected.location;
}

export async function inspectHighLevelLocation(accessToken: string, locationId: string) {
  const inspected = await inspectHighLevelRequest<{ location?: HighLevelLocation } | HighLevelLocation>({
    accessToken,
    path: `/locations/${locationId}`,
    version: HIGHLEVEL_LOCATION_API_VERSION,
  });
  return {
    ...inspected,
    location: inspected.ok ? locationFromHighLevelPayload(inspected.data) : null,
  };
}

export async function inspectHighLevelContactsReachability(accessToken: string, locationId: string) {
  return inspectHighLevelRequest<{ contacts?: HighLevelContact[] }>({
    accessToken,
    path: "/contacts/",
    query: { locationId, limit: "1" },
  });
}

export async function inspectHighLevelInstalledLocations(accessToken: string) {
  return inspectHighLevelRequest<{ locations?: Array<{ _id?: string; id?: string }> }>({
    accessToken,
    path: "/oauth/installedLocations",
  });
}

export async function searchHighLevelContacts(input: {
  accessToken: string;
  locationId: string;
  query?: string;
  startAfterId?: string;
  limit?: number;
}) {
  return highlevelRequest<{ contacts?: HighLevelContact[]; meta?: { nextPageUrl?: string; startAfterId?: string } }>({
    accessToken: input.accessToken,
    path: "/contacts/",
    query: {
      locationId: input.locationId,
      query: input.query,
      startAfterId: input.startAfterId,
      limit: String(input.limit ?? 100),
    },
  });
}

export async function upsertHighLevelContact(input: {
  accessToken: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}) {
  return highlevelRequest<{ contact?: HighLevelContact }>({
    accessToken: input.accessToken,
    path: "/contacts/upsert",
    method: "POST",
    body: {
      locationId: input.locationId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
    },
  });
}

export async function sendHighLevelSms(input: {
  accessToken: string;
  contactId: string;
  body: string;
  fromNumber: string;
  toNumber?: string;
}) {
  return highlevelRequest<{ conversationId?: string; messageId?: string; id?: string }>({
    accessToken: input.accessToken,
    path: "/conversations/messages",
    method: "POST",
    version: HIGHLEVEL_CONVERSATIONS_API_VERSION,
    body: {
      type: "SMS",
      contactId: input.contactId,
      message: input.body,
      fromNumber: input.fromNumber,
      ...(input.toNumber ? { toNumber: input.toNumber } : {}),
    },
  });
}

export type HighLevelPhoneNumber = {
  phoneNumber?: string;
  friendlyName?: string;
  countryCode?: string;
  isDefaultNumber?: boolean;
  sid?: string;
};

export type HighLevelAvailableNumber = {
  phoneNumber?: string;
  friendlyName?: string;
  isoCountry?: string;
  fingerprintId?: string;
};

export async function listHighLevelActiveNumbers(input: {
  accessToken: string;
  locationId: string;
  page?: number;
  pageSize?: number;
}) {
  return highlevelRequest<{
    status?: string;
    data?: { numbers?: HighLevelPhoneNumber[]; total?: number; page?: number; pageSize?: number; isUnderLc?: boolean };
    numbers?: HighLevelPhoneNumber[];
    message?: string;
  }>({
    accessToken: input.accessToken,
    path: `/phone-system/numbers/location/${input.locationId}`,
    version: HIGHLEVEL_PHONE_API_VERSION,
    query: {
      page: input.page != null ? String(input.page) : "0",
      pageSize: String(input.pageSize ?? 100),
    },
  });
}

export async function listHighLevelAvailableNumbers(input: {
  accessToken: string;
  locationId: string;
  countryCode: string;
  numberTypes?: string;
  firstPart?: string;
  lastPart?: string;
  anywhere?: string;
  smsEnabled?: boolean;
  voiceEnabled?: boolean;
}) {
  return highlevelRequest<{
    status?: string;
    data?: { numbers?: HighLevelAvailableNumber[]; fingerprintId?: string };
    numbers?: HighLevelAvailableNumber[];
    fingerprintId?: string;
    message?: string;
  }>({
    accessToken: input.accessToken,
    path: `/phone-system/numbers/location/${input.locationId}/available`,
    version: HIGHLEVEL_PHONE_API_VERSION,
    query: {
      countryCode: input.countryCode,
      numberTypes: input.numberTypes ?? "local",
      firstPart: input.firstPart,
      lastPart: input.lastPart,
      anywhere: input.anywhere,
      smsEnabled: input.smsEnabled === false ? "false" : "true",
      mmsEnabled: "false",
      voiceEnabled: input.voiceEnabled === false ? "false" : "true",
    },
  });
}

export async function listHighLevelNumberPools(input: { accessToken: string; locationId: string }) {
  return highlevelRequest<{ status?: string; data?: unknown; message?: string }>({
    accessToken: input.accessToken,
    path: "/phone-system/number-pools",
    version: HIGHLEVEL_PHONE_API_VERSION,
    query: { locationId: input.locationId },
  });
}

export async function purchaseHighLevelNumber(input: {
  accessToken: string;
  locationId: string;
  phoneNumber: string;
}) {
  return highlevelRequest<{
    status?: string;
    data?: { number?: string; phoneNumber?: string; locationId?: string; id?: string };
    message?: string;
  }>({
    accessToken: input.accessToken,
    path: `/phone-system/numbers/location/${input.locationId}/purchase`,
    method: "POST",
    version: HIGHLEVEL_PHONE_API_VERSION,
    body: { phoneNumber: input.phoneNumber },
  });
}

export async function createHighLevelLocation(input: {
  accessToken: string;
  name: string;
  phone?: string;
  companyName?: string;
}) {
  return highlevelRequest<{ location?: HighLevelLocation; id?: string; message?: string }>({
    accessToken: input.accessToken,
    path: "/locations/",
    method: "POST",
    body: {
      name: input.name,
      phone: input.phone,
      companyName: input.companyName ?? input.name,
    },
  });
}

export type HighLevelConversation = {
  id?: string;
  conversationId?: string;
  contactId?: string;
  locationId?: string;
  fullName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  lastMessageBody?: string;
  lastMessageDate?: string | number;
  lastMessageType?: string;
  unreadCount?: number;
  inbox?: boolean;
  deleted?: boolean;
};

export function highLevelConversationId(conversation: { id?: string | null; conversationId?: string | null } | null | undefined) {
  const raw = conversation?.id || conversation?.conversationId;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.includes("@") || id === "undefined" || id === "null") return null;
  return id;
}

export function extractHighLevelConversations(payload: {
  conversations?: HighLevelConversation[] | { conversations?: HighLevelConversation[]; total?: number };
  total?: number;
}) {
  const block = payload.conversations;
  const rows = Array.isArray(block) ? block : Array.isArray(block?.conversations) ? block.conversations : [];
  const total = typeof payload.total === "number" ? payload.total : typeof block === "object" && block && "total" in block && typeof block.total === "number" ? block.total : rows.length;
  return { rows, total };
}

export function extractHighLevelMessages(payload: {
  messages?:
    | HighLevelConversationMessage[]
    | {
        messages?: HighLevelConversationMessage[];
        nextPage?: boolean;
        lastMessageId?: string;
      };
}) {
  const block = payload.messages;
  if (Array.isArray(block)) return { rows: block, nextPage: false, lastMessageId: undefined as string | undefined };
  return {
    rows: block?.messages ?? [],
    nextPage: Boolean(block?.nextPage),
    lastMessageId: block?.lastMessageId,
  };
}

export function parseHighLevelDate(raw: unknown): Date | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof raw === "string" && raw.trim()) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && raw.trim() !== "") {
      const numeric = new Date(asNumber);
      if (!Number.isNaN(numeric.getTime()) && (asNumber > 1_000_000_000_000 || raw.length >= 12)) return numeric;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

export type HighLevelConversationMessage = {
  id?: string;
  messageId?: string;
  conversationId?: string;
  contactId?: string;
  body?: string;
  message?: string;
  direction?: string;
  type?: string;
  messageType?: string;
  status?: string;
  dateAdded?: string | number;
  dateUpdated?: string | number;
  attachments?: Array<{ url?: string; type?: string } | string>;
  meta?: { recordingUrl?: string; callDuration?: number; callStatus?: string };
};

export async function searchHighLevelConversations(input: {
  accessToken: string;
  locationId: string;
  limit?: number;
  startAfterDate?: string;
}) {
  return highlevelRequest<{
    conversations?: HighLevelConversation[] | { conversations?: HighLevelConversation[]; total?: number };
    total?: number;
  }>({
    accessToken: input.accessToken,
    path: "/conversations/search",
    version: HIGHLEVEL_CONVERSATIONS_API_VERSION,
    query: {
      locationId: input.locationId,
      limit: String(input.limit ?? 20),
      sort: "desc",
      startAfterDate: input.startAfterDate,
    },
  });
}

export async function getHighLevelConversation(input: { accessToken: string; conversationId: string }) {
  const data = await highlevelRequest<{ conversation?: HighLevelConversation } | HighLevelConversation>({
    accessToken: input.accessToken,
    path: `/conversations/${input.conversationId}`,
    version: HIGHLEVEL_CONVERSATIONS_API_VERSION,
  });
  if (data && typeof data === "object" && "conversation" in data && data.conversation) return data.conversation;
  return data as HighLevelConversation;
}

export async function getHighLevelConversationMessages(input: {
  accessToken: string;
  conversationId: string;
  lastMessageId?: string;
  limit?: number;
}) {
  return highlevelRequest<{
    messages?:
      | HighLevelConversationMessage[]
      | {
          messages?: HighLevelConversationMessage[];
          nextPage?: boolean;
          lastMessageId?: string;
        };
  }>({
    accessToken: input.accessToken,
    path: `/conversations/${input.conversationId}/messages`,
    version: HIGHLEVEL_CONVERSATIONS_API_VERSION,
    query: {
      lastMessageId: input.lastMessageId,
      limit: String(input.limit ?? 20),
    },
  });
}

export async function getHighLevelContact(input: { accessToken: string; contactId: string }) {
  const data = await highlevelRequest<{ contact?: HighLevelContact } | HighLevelContact>({
    accessToken: input.accessToken,
    path: `/contacts/${input.contactId}`,
  });
  if (data && typeof data === "object" && "contact" in data && data.contact) return data.contact;
  return data as HighLevelContact;
}

export type HighLevelSocialAccount = {
  id: string;
  name?: string;
  platform?: string;
  profileId?: string;
};

export async function listHighLevelSocialAccounts(input: { accessToken: string; locationId: string }) {
  return highlevelRequest<{
    results?: { accounts?: HighLevelSocialAccount[] };
    accounts?: HighLevelSocialAccount[];
    message?: string;
  }>({
    accessToken: input.accessToken,
    path: `/social-media-posting/${input.locationId}/accounts`,
    version: "v3",
  });
}

export async function createHighLevelSocialPost(input: {
  accessToken: string;
  locationId: string;
  accountIds: string[];
  summary: string;
  status: "draft" | "scheduled" | "published";
  scheduleDate?: string;
  mediaUrl?: string | null;
}) {
  return highlevelRequest<{
    results?: { id?: string; status?: string };
    id?: string;
    post?: { id?: string; status?: string };
    message?: string;
  }>({
    accessToken: input.accessToken,
    path: `/social-media-posting/${input.locationId}/posts`,
    method: "POST",
    version: "v3",
    body: {
      accountIds: input.accountIds,
      summary: input.summary,
      status: input.status,
      scheduleDate: input.scheduleDate,
      media: input.mediaUrl ? [{ url: input.mediaUrl }] : undefined,
    },
  });
}

export async function listHighLevelSocialPosts(input: { accessToken: string; locationId: string }) {
  return highlevelRequest<{ results?: { posts?: Array<{ id?: string; status?: string; summary?: string; accountIds?: string[] }> }; posts?: Array<{ id?: string; status?: string }> }>({
    accessToken: input.accessToken,
    path: `/social-media-posting/${input.locationId}/posts/list`,
    method: "POST",
    version: "v3",
    body: {},
  });
}
