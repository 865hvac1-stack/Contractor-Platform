import { describe, expect, it } from "vitest";
import {
  deterministicInterpretation,
  INDUSTRY_STARTER_PACKS,
  minimumActions,
  REGINA_NEVER,
} from "@/lib/conversations/custom-automations";

describe("custom Regina automation interpretation", () => {
  it("turns a plain-English six-month maintenance request into safe structured configuration", () => {
    const result = deterministicInterpretation(
      "When we finish an AC repair, wait six months and have Regina contact the customer about maintenance and try to book them.",
      "865 HVAC"
    );
    expect(result.trigger).toBe("JOB_COMPLETED");
    expect(result.goal).toBe("BOOK_MAINTENANCE");
    expect(result.delayMinutes).toBe(259_200);
    expect(result.allowedActions).toContain("CHECK_AVAILABILITY");
    expect(result.allowedActions).toContain("BOOK_APPOINTMENT");
    expect(result.allowedActions).not.toContain("CANCEL_APPOINTMENT");
    expect(result.stopConditions).toContain("CUSTOMER_OPTED_OUT");
  });

  it("uses least privilege for estimate follow-up", () => {
    const actions = minimumActions("FOLLOW_UP_ESTIMATE");
    expect(actions).toEqual(["READ_ESTIMATE", "SEND_ESTIMATE_LINK", "CREATE_FOLLOW_UP", "REQUEST_HUMAN_HANDOFF"]);
    expect(actions).not.toContain("BOOK_APPOINTMENT");
    expect(actions).not.toContain("SEND_PAYMENT_LINK");
  });

  it("keeps system boundaries explicit", () => {
    expect(REGINA_NEVER).toContain("Change pricing or totals");
    expect(REGINA_NEVER).toContain("Issue refunds");
    expect(REGINA_NEVER).toContain("Promise unavailable appointment times");
  });

  it("provides industry-neutral starter pack recommendations as draft templates", () => {
    expect(INDUSTRY_STARTER_PACKS.HVAC).toContain("MAINTENANCE_DUE");
    expect(INDUSTRY_STARTER_PACKS.ROOFING).toContain("UNSOLD_ESTIMATE_FOLLOW_UP");
    expect(INDUSTRY_STARTER_PACKS.POOL_SERVICE).toContain("PAST_CUSTOMER_REACTIVATION");
  });
});
