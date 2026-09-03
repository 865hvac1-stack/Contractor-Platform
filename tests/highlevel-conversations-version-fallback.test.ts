import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HighLevelApiError,
  isHighLevelLocationNotActiveError,
  searchHighLevelConversations,
} from "@/lib/highlevel/client";
import {
  HIGHLEVEL_API_VERSION,
  HIGHLEVEL_CONVERSATIONS_API_VERSION,
  HIGHLEVEL_CONVERSATIONS_API_VERSION_FALLBACK,
} from "@/lib/highlevel/config";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("HighLevel conversations version fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recognizes HighLevel location-not-active wording, including the actived typo", () => {
    expect(isHighLevelLocationNotActiveError("Location is not active")).toBe(true);
    expect(isHighLevelLocationNotActiveError("Location is not actived")).toBe(true);
    expect(isHighLevelLocationNotActiveError("rate limited")).toBe(false);
  });

  it("retries conversations search with 2021-04-15 after v3 returns Location is not active", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { message: "Location is not active", statusCode: 400 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          conversations: [{ id: "conv_1", locationId: "qPjPtcAUzdkBtYTJUUWB", lastMessageType: "TYPE_SMS" }],
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchHighLevelConversations({
      accessToken: "access-must-not-be-logged",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
    });

    expect(result.conversations).toEqual([
      { id: "conv_1", locationId: "qPjPtcAUzdkBtYTJUUWB", lastMessageType: "TYPE_SMS" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Version).toBe(HIGHLEVEL_CONVERSATIONS_API_VERSION);
    expect(fetchMock.mock.calls[1][1].headers.Version).toBe(HIGHLEVEL_CONVERSATIONS_API_VERSION_FALLBACK);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/conversations/search");
  });

  it("retries when HighLevel uses the Location is not actived typo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { message: "Location is not actived" }))
      .mockResolvedValueOnce(jsonResponse(200, { conversations: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchHighLevelConversations({
      accessToken: "access-must-not-be-logged",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
    });
    expect(fetchMock.mock.calls[1][1].headers.Version).toBe(HIGHLEVEL_CONVERSATIONS_API_VERSION_FALLBACK);
  });

  it("retries conversations search a third time with 2021-07-28", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { message: "Location is not active" }))
      .mockResolvedValueOnce(jsonResponse(400, { message: "Location is not actived" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          conversations: [{ id: "conv_2", locationId: "qPjPtcAUzdkBtYTJUUWB", lastMessageType: "TYPE_CALL" }],
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchHighLevelConversations({
      accessToken: "access-must-not-be-logged",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
    });
    expect(result.conversations).toEqual([
      { id: "conv_2", locationId: "qPjPtcAUzdkBtYTJUUWB", lastMessageType: "TYPE_CALL" },
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1].headers.Version)).toEqual([
      HIGHLEVEL_CONVERSATIONS_API_VERSION,
      HIGHLEVEL_CONVERSATIONS_API_VERSION_FALLBACK,
      HIGHLEVEL_API_VERSION,
    ]);
  });

  it("does not retry unrelated 400s", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { message: "Invalid locationId" })));
    await expect(
      searchHighLevelConversations({
        accessToken: "access-must-not-be-logged",
        locationId: "qPjPtcAUzdkBtYTJUUWB",
      })
    ).rejects.toBeInstanceOf(HighLevelApiError);
  });
});
