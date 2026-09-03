import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diagnoseHighLevelConversationsApi,
  formatConversationsDiagnostic,
  sanitizeHighLevelPublicError,
  type HighLevelConversationsDiagnostic,
} from "@/lib/highlevel/conversations-diagnostic";
import * as client from "@/lib/highlevel/client";
import * as connection from "@/lib/highlevel/connection";

describe("HighLevel conversations API diagnostic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts tokens, emails, and phone-like values from HighLevel errors", () => {
    expect(
      sanitizeHighLevelPublicError("Bearer abc.secret.token failed for +18655550199 and casey@865hvac.test")
    ).toBe("[redacted] failed for [redacted] and [redacted]");
    expect(sanitizeHighLevelPublicError("Location is not active")).toBe("Location is not active");
    expect(sanitizeHighLevelPublicError("Location is not actived")).toBe("Location is not actived");
  });

  it("formats probe rows without customer PII", () => {
    const result: HighLevelConversationsDiagnostic = {
      locationId: "qPjPtcAUzdkBtYTJUUWB",
      authMode: "oauth",
      mappedContactTested: true,
      probes: [
        {
          endpoint: "GET /conversations/search",
          version: "2021-04-15",
          httpStatus: 400,
          errorCode: "400",
          errorMessage: "Location is not active",
          conversationsReturned: false,
          contactObjectReturned: false,
          topLevelKeys: ["statusCode", "message"],
        },
      ],
    };
    const text = formatConversationsDiagnostic(result);
    expect(text).toContain("Version=2021-04-15");
    expect(text).toContain("HTTP 400");
    expect(text).toContain("Location is not active");
    expect(text).toContain("conversationsArray=no");
    expect(text).not.toContain("@");
    expect(text).not.toContain("Bearer");
  });

  it("calls each Version header once with no fallback retry", async () => {
    const search = vi.spyOn(client, "inspectHighLevelConversationsSearch").mockResolvedValue({
      status: 400,
      ok: false,
      keys: ["statusCode", "message"],
      data: { statusCode: 400, message: "Location is not active" },
      errorMessage: "Location is not active",
    });
    vi.spyOn(connection, "loadHighLevelAccess").mockResolvedValue({
      connection: { id: "conn_1", scopes: ["conversations.readonly"] } as never,
      accessToken: "access-must-not-be-logged",
      locationId: "qPjPtcAUzdkBtYTJUUWB",
      authMode: "oauth",
    });
    const prisma = {
      providerIdentityMap: { findFirst: async () => null },
    };
    const result = await diagnoseHighLevelConversationsApi(prisma as never, "company_1");
    expect(search).toHaveBeenCalledTimes(3);
    expect(search.mock.calls.map((call) => call[0].version)).toEqual(["2021-04-15", "2021-07-28", "v3"]);
    expect(result.probes.every((row) => row.errorMessage === "Location is not active")).toBe(true);
    expect(result.authMode).toBe("oauth");
  });
});
