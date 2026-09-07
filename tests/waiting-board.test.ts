import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { CADENCE_LABELS, DEFAULT_CADENCE, DEFAULT_COLUMNS } from "@/lib/waiting/defaults";
import {
  cadenceDays,
  nextCustomerUpdateAt,
  snapToBusinessHour,
  waitingIdempotencyKey,
  zonedParts,
} from "@/lib/waiting/schedule";
import { waitingSendBlockReason, nextJobStatusForWaiting, shouldStopWaitingAutomation } from "@/lib/waiting/safety";
import { buildWaitingTemplateVars, renderWaitingTemplate } from "@/lib/waiting/templates";
import { itemNameFromMetadata, parseWaitingMetadata } from "@/lib/waiting/types";
import { toolsForQuestion } from "@/lib/intelligence/intent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("waiting board defaults", () => {
  it("ships the six operational columns and does not default to daily texts", () => {
    expect(DEFAULT_COLUMNS.map((column) => column.key)).toEqual([
      "WAITING_ON_PART",
      "WAITING_ON_WARRANTY",
      "WAITING_ON_CUSTOMER",
      "WAITING_ON_APPROVAL",
      "WAITING_ON_THIRD_PARTY",
      "READY_TO_SCHEDULE",
    ]);
    expect(DEFAULT_CADENCE).toBe("EVERY_3_DAYS");
    expect(cadenceDays("EVERY_3_DAYS", null)).toBe(3);
    expect(cadenceDays("MANUAL", null)).toBeNull();
    expect(CADENCE_LABELS.DAILY).toBe("Daily");
  });
});

describe("waiting schedule", () => {
  it("snaps the next update to company business hours in the company timezone", () => {
    const from = new Date("2026-09-07T23:15:00.000Z");
    const next = nextCustomerUpdateAt({
      from,
      cadence: "EVERY_3_DAYS",
      timezone: "America/New_York",
      businessHourStart: 10,
    });
    expect(next).toBeTruthy();
    const parts = zonedParts(next!, "America/New_York");
    expect(parts.hour).toBe(10);
    const snapped = snapToBusinessHour(new Date("2026-09-10T19:00:00.000Z"), "America/Chicago", 10);
    expect(zonedParts(snapped, "America/Chicago").hour).toBe(10);
  });

  it("builds idempotency keys from record, kind, and scheduled slot", () => {
    const slot = new Date("2026-09-10T14:00:00.000Z");
    expect(waitingIdempotencyKey("rec_1", "RECURRING", slot)).toBe("rec_1:RECURRING:2026-09-10T14:00:00.000Z");
    expect(waitingIdempotencyKey("rec_1", "RECURRING", slot)).toBe(waitingIdempotencyKey("rec_1", "RECURRING", slot.toISOString()));
  });
});

describe("waiting templates", () => {
  it("never invents an arrival date and only includes a verified one", () => {
    const withoutDate = buildWaitingTemplateVars({
      firstName: "Sarah",
      companyName: "865 HVAC",
      jobNumber: "JOB-1048",
      waitingReason: "Waiting on Part",
      metadata: { part: { name: "Blower Motor" } },
      expectedResolutionAt: null,
    });
    expect(withoutDate.expectedDate).toBe("");
    expect(withoutDate.expectedDateSentence).toBe("");
    const body = renderWaitingTemplate(
      "Hi {{firstName}}, we ordered the {{itemName}}.{{expectedDateSentence}}",
      withoutDate
    );
    expect(body).toBe("Hi Sarah, we ordered the Blower Motor.");
    expect(body).not.toMatch(/Sep|arrival is/i);

    const withDate = buildWaitingTemplateVars({
      firstName: "Sarah",
      companyName: "865 HVAC",
      jobNumber: "JOB-1048",
      waitingReason: "Waiting on Part",
      metadata: { part: { name: "Blower Motor" } },
      expectedResolutionAt: new Date("2026-09-10T14:00:00.000Z"),
      timezone: "America/New_York",
    });
    expect(withDate.expectedDateSentence).toContain("Sep");
    expect(withDate.itemName).toBe("Blower Motor");
  });
});

describe("waiting safety", () => {
  const customer = { phone: "8655550100", tags: [] as string[] };

  it("blocks completed jobs, resolved records, opt-outs, and disabled automation", () => {
    expect(
      waitingSendBlockReason({
        jobStatus: "COMPLETED",
        recordState: "ACTIVE",
        communicationEnabled: true,
        automationEnabled: true,
        companyAutomaticUpdatesEnabled: true,
        customer,
        kind: "RECURRING",
      })
    ).toMatch(/completed or canceled/i);

    expect(
      waitingSendBlockReason({
        jobStatus: "ON_HOLD",
        recordState: "RESOLVED",
        communicationEnabled: true,
        automationEnabled: true,
        companyAutomaticUpdatesEnabled: true,
        customer,
        kind: "RECURRING",
      })
    ).toMatch(/resolved/i);

    expect(
      waitingSendBlockReason({
        jobStatus: "ON_HOLD",
        recordState: "ACTIVE",
        communicationEnabled: true,
        automationEnabled: true,
        companyAutomaticUpdatesEnabled: true,
        customer: { ...customer, tags: ["opt-out"] },
        kind: "RECURRING",
      })
    ).toMatch(/opted out/i);

    expect(
      waitingSendBlockReason({
        jobStatus: "ON_HOLD",
        recordState: "ACTIVE",
        communicationEnabled: false,
        automationEnabled: true,
        companyAutomaticUpdatesEnabled: true,
        customer,
        kind: "RECURRING",
      })
    ).toMatch(/turned off/i);

    expect(
      waitingSendBlockReason({
        jobStatus: "ON_HOLD",
        recordState: "ACTIVE",
        communicationEnabled: true,
        automationEnabled: false,
        companyAutomaticUpdatesEnabled: true,
        customer,
        kind: "RECURRING",
      })
    ).toMatch(/automation/i);

    expect(
      waitingSendBlockReason({
        jobStatus: "ON_HOLD",
        recordState: "ACTIVE",
        communicationEnabled: true,
        automationEnabled: false,
        companyAutomaticUpdatesEnabled: true,
        customer,
        kind: "MANUAL",
        manual: true,
      })
    ).toBeNull();
  });

  it("stops automation when the job ends or the record is ready / resolved", () => {
    expect(shouldStopWaitingAutomation({ jobStatus: "CANCELED", recordState: "ACTIVE" })).toBe(true);
    expect(shouldStopWaitingAutomation({ jobStatus: "ON_HOLD", recordState: "RESOLVED" })).toBe(true);
    expect(
      shouldStopWaitingAutomation({
        jobStatus: "UNSCHEDULED",
        recordState: "ACTIVE",
        columnKind: "READY",
        columnKey: "READY_TO_SCHEDULE",
      })
    ).toBe(true);
    expect(shouldStopWaitingAutomation({ jobStatus: "ON_HOLD", recordState: "ACTIVE", columnKind: "WAITING" })).toBe(
      false
    );
  });

  it("holds open jobs and unschedules ready work without touching completed jobs", () => {
    expect(nextJobStatusForWaiting({ current: "IN_PROGRESS", ready: false })).toBe("ON_HOLD");
    expect(nextJobStatusForWaiting({ current: "ON_HOLD", ready: true })).toBe("UNSCHEDULED");
    expect(nextJobStatusForWaiting({ current: "COMPLETED", ready: true })).toBeNull();
  });
});

describe("waiting permissions", () => {
  it("gives office roles waiting mutations and keeps technicians off company settings", () => {
    expect(can("COMPANY_OWNER", "jobs:manage")).toBe(true);
    expect(can("ADMIN", "jobs:manage")).toBe(true);
    expect(can("DISPATCHER", "jobs:manage") || can("DISPATCHER", "jobs:field_status")).toBe(true);
    expect(can("TECHNICIAN", "jobs:field_status")).toBe(true);
    expect(can("TECHNICIAN", "company:settings")).toBe(false);
    expect(can("TECHNICIAN", "jobs:assigned_only")).toBe(true);
  });
});

describe("waiting metadata", () => {
  it("reads part and vendor fields without inventing them", () => {
    expect(parseWaitingMetadata(null)).toEqual({});
    expect(itemNameFromMetadata({ part: { name: "Control board" } })).toBe("Control board");
    expect(itemNameFromMetadata({})).toBe("part");
  });
});

describe("waiting intelligence and action center", () => {
  it("routes waiting questions to the read-only waiting tool", () => {
    expect(toolsForQuestion("Who has been waiting the longest?")).toContain("getWaitingBoard");
    expect(toolsForQuestion("Which customers need updates today?")).toContain("getWaitingBoard");
    expect(toolsForQuestion("How many jobs are waiting on parts?")).toContain("getWaitingBoard");
    expect(toolsForQuestion("What parts are overdue?")).toContain("getWaitingBoard");
    expect(toolsForQuestion("How much revenue is tied up in waiting jobs?")).toContain("getWaitingBoard");
    expect(toolsForQuestion("Who is ready to schedule?")).toContain("getWaitingBoard");
  });

  it("registers waiting Action Center types", () => {
    const priority = readFileSync(resolve("src/lib/attention-priority.ts"), "utf8");
    expect(priority).toContain("waiting_expected_date_passed");
    expect(priority).toContain("waiting_ready_to_schedule");
    expect(priority).toContain("waiting_update_failed");
    const attention = readFileSync(resolve("src/lib/attention.ts"), "utf8");
    expect(attention).toContain("detectWaitingAttention");
  });
});

describe("waiting production wiring", () => {
  it("does not add a second SMS stack", () => {
    const messages = readFileSync(resolve("src/lib/waiting/messages.ts"), "utf8");
    expect(messages).toContain("sendCompanyCommunication");
    expect(messages).not.toMatch(/twilio\.com\/2010/);
  });

  it("keeps the processor server-side and idempotent", () => {
    const processor = readFileSync(resolve("src/lib/waiting/processor.ts"), "utf8");
    expect(processor).toContain("nextCustomerUpdateAt");
    expect(processor).toContain("sendWaitingCommunication");
    expect(processor).toContain("shouldStopWaitingAutomation");
    const cron = readFileSync(resolve("src/app/api/cron/waiting/route.ts"), "utf8");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toContain("processDueWaitingUpdates");
  });

  it("exposes Operations → Waiting Board and settings", () => {
    const nav = readFileSync(resolve("src/lib/nav.ts"), "utf8");
    expect(nav).toContain("/operations/waiting");
    expect(nav).toContain("Waiting Board");
    const settings = readFileSync(resolve("src/app/(app)/settings/page.tsx"), "utf8");
    expect(settings).toContain("/settings/waiting");
  });
});

describe("waiting board UI hierarchy", () => {
  it("keeps the board as the hero and opens Put in Waiting from a drawer", () => {
    const page = readFileSync(resolve("src/app/(app)/operations/waiting/page.tsx"), "utf8");
    const board = readFileSync(resolve("src/components/waiting/waiting-board.tsx"), "utf8");
    const drawer = readFileSync(resolve("src/components/waiting/add-waiting-drawer.tsx"), "utf8");
    const form = readFileSync(resolve("src/components/waiting/put-in-waiting-form.tsx"), "utf8");
    expect(page).not.toContain("<PutInWaitingForm");
    expect(board).toContain("+ Add Waiting Job");
    expect(board).toContain("AddWaitingJobDrawer");
    expect(board).toContain("min-w-[280px]");
    expect(board).toContain("READY_TO_SCHEDULE");
    expect(board).toContain("All");
    expect(drawer).toContain("Put Job in Waiting");
    expect(drawer).toContain("PutInWaitingForm");
    expect(form).toContain("putJobInWaitingAction");
    expect(form).toContain("Put in Waiting");
  });

  it("keeps drag-and-drop as a real transition and Ready to Schedule as a first-class action", () => {
    const board = readFileSync(resolve("src/components/waiting/waiting-board.tsx"), "utf8");
    const card = readFileSync(resolve("src/components/waiting/waiting-card.tsx"), "utf8");
    expect(board).toContain("text/waiting-record");
    expect(board).toContain("WaitingTransitionDialog");
    expect(card).toContain("Part Arrived");
    expect(card).toContain("/jobs/");
    expect(card).toContain("#schedule");
    expect(card).toContain("markPartArrivedAction");
  });
});
