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
}): Promise<T> {
  const url = new URL(`${HIGHLEVEL_API_BASE}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Version: HIGHLEVEL_API_VERSION,
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

export async function searchHighLevelConversations(input: {
  accessToken: string;
  locationId: string;
  limit?: number;
}) {
  return highlevelRequest<{ conversations?: Array<{ id: string; contactId?: string; lastMessageBody?: string; lastMessageDate?: string; unreadCount?: number }> }>({
    accessToken: input.accessToken,
    path: "/conversations/search",
    query: {
      locationId: input.locationId,
      limit: String(input.limit ?? 20),
    },
  });
}
