import { describe, expect, it } from "vitest";
import { interpretSchedulingIntent, mergeSchedulingIntent } from "@/lib/scheduling/intent";
import { classifyMaintenanceVisit } from "@/lib/scheduling/maintenance";
import { confirmationMessage, noAvailabilityMessage, noPlanMessage } from "@/lib/scheduling/templates";
import { DEFAULT_POLICY } from "@/lib/scheduling/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const now = new Date("2026-09-08T16:00:00.000Z");
const windows = [
  { id: "w1", startMinutes: 9 * 60, endMinutes: 11 * 60, active: true },
  { id: "w2", startMinutes: 13 * 60, endMinutes: 15 * 60, active: true },
];

describe("conversation scheduling intent", () => {
  it("understands tomorrow morning", () => {
    const intent = interpretSchedulingIntent({
      text: "Can someone come tomorrow morning?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(intent.requestedDate).toBe("2026-09-09");
    expect(intent.requestedDaypart).toBe("MORNING");
    expect(intent.missingField).toBeNull();
  });

  it("maps an exact window", () => {
    const intent = interpretSchedulingIntent({
      text: "Can you come between 1 and 3?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(intent.requestedStartMinutes).toBe(13 * 60);
    expect(intent.requestedWindowId).toBe("w2");
  });

  it("understands Friday afternoon", () => {
    const intent = interpretSchedulingIntent({
      text: "Friday afternoon?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(intent.requestedDate).toBe("2026-09-11");
    expect(intent.requestedDaypart).toBe("AFTERNOON");
  });

  it("asks one question when the week is too broad, then merges morning", () => {
    const first = interpretSchedulingIntent({
      text: "Sometime next week.",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(first.missingField).toBe("daypart");
    const merged = mergeSchedulingIntent(first, interpretSchedulingIntent({
      text: "Morning.",
      timeZone: "America/New_York",
      now,
      windows,
    }));
    expect(merged.requestedDaypart).toBe("MORNING");
    expect(merged.requestedDate).toBe(first.requestedDate);
    expect(merged.missingField).toBeNull();
  });

  it("does not guess an ambiguous request", () => {
    const intent = interpretSchedulingIntent({
      text: "Can someone come out?",
      timeZone: "America/New_York",
      now,
      windows,
    });
    expect(intent.missingField).toBe("date");
  });

  it("recognizes office takeover", () => {
    const intent = interpretSchedulingIntent({
      text: "Can I talk to a person?",
      timeZone: "America/New_York",
      now,
    });
    expect(intent.humanRequested).toBe(true);
  });
});

describe("maintenance due engine", () => {
  it("classifies unscheduled, scheduled, overdue, and completed visits", () => {
    expect(
      classifyMaintenanceVisit({
        today: "2026-09-08",
        dueStart: "2026-09-01",
        dueEnd: "2026-10-31",
        dueSoonDays: 45,
      })
    ).toBe("UNSCHEDULED");
    expect(
      classifyMaintenanceVisit({
        today: "2026-09-08",
        dueStart: "2026-09-01",
        dueEnd: "2026-10-31",
        dueSoonDays: 45,
        jobId: "j1",
        jobStatus: "SCHEDULED",
      })
    ).toBe("SCHEDULED");
    expect(
      classifyMaintenanceVisit({
        today: "2026-11-02",
        dueStart: "2026-09-01",
        dueEnd: "2026-10-31",
        dueSoonDays: 45,
      })
    ).toBe("OVERDUE");
    expect(
      classifyMaintenanceVisit({
        today: "2026-09-08",
        dueStart: "2026-09-01",
        dueEnd: "2026-10-31",
        dueSoonDays: 45,
        completedAt: "2026-09-02",
      })
    ).toBe("COMPLETED");
  });
});

describe("confirmation templates", () => {
  it("does not expose staffing logic by default", () => {
    const text = confirmationMessage({
      policy: DEFAULT_POLICY,
      dateKey: "2026-09-09",
      startMinutes: 9 * 60,
      endMinutes: 11 * 60,
      technicianName: "JR",
      timeZone: "America/New_York",
    });
    expect(text).toMatch(/9:00 AM/);
    expect(text).not.toMatch(/JR/);
  });

  it("offers only supplied real alternatives", () => {
    const text = noAvailabilityMessage({
      policy: DEFAULT_POLICY,
      requestedLabel: "tomorrow morning",
      alternatives: [
        { dateKey: "2026-09-09", startMinutes: 13 * 60, endMinutes: 15 * 60, timeZone: "America/New_York" },
      ],
    });
    expect(text).toMatch(/1:00 PM/);
    expect(noPlanMessage({ policy: DEFAULT_POLICY })).toMatch(/maintenance plan/);
  });
});

describe("scheduling architecture reuse", () => {
  it("books through the same engine and HighLevel confirmation path", () => {
    const booking = readFileSync(resolve("src/lib/scheduling/booking.ts"), "utf8");
    const conversation = readFileSync(resolve("src/lib/scheduling/conversation.ts"), "utf8");
    const webhook = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(booking).toMatch(/pg_advisory_xact_lock/);
    expect(booking).toMatch(/sendCompanyCommunication/);
    expect(booking).toMatch(/confirmationFailed/);
    expect(booking).toMatch(/idempotencyKey/);
    expect(conversation).toMatch(/processInboundScheduling/);
    expect(conversation).toMatch(/lastInboundMessageId/);
    expect(webhook).toMatch(/processInboundScheduling/);
    expect(webhook).not.toMatch(/highlevel.*calendar|gohighlevel.*appoint/i);
  });
});
