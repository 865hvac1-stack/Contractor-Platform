import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("scheduling security and HighLevel safeguards", () => {
  it("keeps scheduling settings and booking behind existing permissions", () => {
    expect(can("COMPANY_OWNER", "company:settings")).toBe(true);
    expect(can("DISPATCHER", "schedule:manage")).toBe(true);
    expect(can("TECHNICIAN", "schedule:manage")).toBe(false);
    expect(can("TECHNICIAN", "schedule:view")).toBe(true);
    expect(can("OFFICE", "jobs:manage")).toBe(true);
    const actions = readFileSync(resolve("src/server/actions/scheduling.ts"), "utf8");
    expect(actions).toMatch(/requirePermission\("company:settings"\)/);
    expect(actions).toMatch(/requirePermission\("schedule:manage"\)/);
    expect(actions).toMatch(/requirePermission\("jobs:manage"\)/);
    expect(actions).toMatch(/companyId: ctx.company.id/);
  });

  it("does not bypass HighLevel identity or approved sender", () => {
    const booking = readFileSync(resolve("src/lib/scheduling/booking.ts"), "utf8");
    const comms = readFileSync(resolve("src/lib/highlevel/communication-provider.ts"), "utf8");
    expect(booking).toMatch(/sendCompanyCommunication/);
    expect(booking).not.toMatch(/sendHighLevelSms\(/);
    expect(comms).toMatch(/linkHighLevelCustomerContact/);
    expect(comms).toMatch(/resolveApprovedSenderNumber/);
    expect(comms).toMatch(/canonicalizeUsPhone/);
  });

  it("keeps tenant isolation on scheduling models", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/model AppointmentWindow/);
    expect(schema).toMatch(/@@unique\(\[companyId, userId, windowId, weekday\]\)/);
    expect(schema).toMatch(/@@unique\(\[companyId, membershipId, cycleKey\]\)/);
    expect(schema).toMatch(/@@unique\(\[companyId, idempotencyKey\]\)/);
    expect(schema).toMatch(/@@unique\(\[companyId, lastInboundMessageId\]\)/);
  });
});
