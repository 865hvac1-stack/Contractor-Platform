import { describe, expect, it } from "vitest";
import { RECOMMENDED_AUTOMATIONS } from "@/lib/conversations/templates";
import { promotionIsActive, renderFirstMessage } from "@/lib/conversations/personalization";
import { isQuietHour, promotionAudienceEligible } from "@/lib/conversations/event-engine";
import {
  isSmsOptOut,
  looksLikePreArrivalRequest,
  needsHumanEscalation,
} from "@/lib/conversations/inbound-control";

describe("Regina conversation templates", () => {
  it("ships every recommended first-class automation with a business goal", () => {
    expect(RECOMMENDED_AUTOMATIONS).toHaveLength(13);
    expect(new Set(RECOMMENDED_AUTOMATIONS.map((item) => item.key)).size).toBe(13);
    expect(RECOMMENDED_AUTOMATIONS.every((item) => item.goal && item.firstMessage)).toBe(true);
  });

  it("personalizes from verified context without leaving merge fields", () => {
    const text = renderFirstMessage(
      "Hey {{customer.firstName}}, {{technician.firstName}} from {{company.name}} is headed to {{property.address}}{{job.etaClause}}.",
      {
        customerFirstName: "Sarah",
        technicianFirstName: "JR",
        companyName: "865 HVAC",
        assistantName: "Regina",
        propertyAddress: "123 Main Street",
        eta: "1:25 PM",
      }
    );
    expect(text).toBe("Hey Sarah, JR from 865 HVAC is headed to 123 Main Street with an ETA around 1:25 PM.");
    expect(text).not.toContain("{{");
  });

  it("never renders an expired promotion", () => {
    const now = new Date("2026-11-01T12:00:00.000Z");
    const promotion = {
      id: "promo",
      headline: "Fall Tune-Up",
      offer: "$79 heating tune-up",
      startsAt: new Date("2026-09-15T00:00:00.000Z"),
      endsAt: new Date("2026-10-31T23:59:59.000Z"),
      status: "ACTIVE",
    };
    expect(promotionIsActive(promotion, now)).toBe(false);
    expect(
      renderFirstMessage("Maintenance is due{{promotion.offerClause}}.", {
        companyName: "865 HVAC",
        assistantName: "Regina",
        promotion,
      }, now)
    ).toBe("Maintenance is due.");
  });
});

describe("conversation safety controls", () => {
  it.each(["STOP", "unsubscribe", "Cancel!", "END", "quit."])("recognizes exact SMS opt-out keyword %s", (body) => {
    expect(isSmsOptOut(body)).toBe(true);
  });

  it("does not confuse normal words with an opt-out", () => {
    expect(isSmsOptOut("Please stop by Thursday")).toBe(false);
  });

  it("detects human escalation and pre-arrival requests", () => {
    expect(needsHumanEscalation("That price is ridiculous. I want a manager.")).toBe(true);
    expect(looksLikePreArrivalRequest("Can he check the upstairs unit too?")).toBe(true);
  });

  it("enforces promotion audiences without sensitive targeting", () => {
    expect(promotionAudienceEligible("RESIDENTIAL", { eventType: "PROMOTION_AUDIENCE_READY", propertyType: "RESIDENTIAL" })).toBe(true);
    expect(promotionAudienceEligible("COMMERCIAL", { eventType: "PROMOTION_AUDIENCE_READY", propertyType: "RESIDENTIAL" })).toBe(false);
    expect(promotionAudienceEligible("MAINTENANCE_DUE", { eventType: "MAINTENANCE_DUE" })).toBe(true);
  });

  it("recognizes overnight quiet hours in the tenant timezone", () => {
    const late = new Date("2026-09-15T03:00:00.000Z"); // 11 PM previous day in New York
    expect(isQuietHour("America/New_York", 20, 8, late)).toBe(true);
  });
});
