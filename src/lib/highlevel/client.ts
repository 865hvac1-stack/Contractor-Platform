import { HIGHLEVEL_API_BASE, HIGHLEVEL_API_VERSION } from "@/lib/highlevel/config";

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

export async function fetchHighLevelLocation(accessToken: string, locationId: string) {
  const data = await highlevelRequest<{ location?: HighLevelLocation } | HighLevelLocation>({
    accessToken,
    path: `/locations/${locationId}`,
  });
  if (data && typeof data === "object" && "location" in data && data.location) return data.location;
  return data as HighLevelLocation;
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
}) {
  return highlevelRequest<{ conversationId?: string; messageId?: string; id?: string }>({
    accessToken: input.accessToken,
    path: "/conversations/messages",
    method: "POST",
    body: {
      type: "SMS",
      contactId: input.contactId,
      message: input.body,
    },
  });
}

export type HighLevelConversation = {
  id: string;
  contactId?: string;
  fullName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  lastMessageBody?: string;
  lastMessageDate?: string | number;
  lastMessageType?: string;
  unreadCount?: number;
  inbox?: boolean;
};

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
  dateAdded?: string;
  dateUpdated?: string;
  attachments?: Array<{ url?: string; type?: string }>;
  meta?: { recordingUrl?: string; callDuration?: number; callStatus?: string };
};

export async function searchHighLevelConversations(input: {
  accessToken: string;
  locationId: string;
  limit?: number;
  startAfterDate?: string;
}) {
  return highlevelRequest<{ conversations?: HighLevelConversation[]; total?: number }>({
    accessToken: input.accessToken,
    path: "/conversations/search",
    query: {
      locationId: input.locationId,
      limit: String(input.limit ?? 20),
      sort: "desc",
      startAfterDate: input.startAfterDate,
    },
  });
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
