import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blockSelfAddressedSms, outboundPhonesAreDistinct } from "@/lib/comms/sender-guard";

describe("canonical company SMS sender", () => {
  it("blocks sender equal to recipient", () => {
    expect(outboundPhonesAreDistinct("+18658138437", "+18658514300")).toBe(true);
    expect(outboundPhonesAreDistinct("+18658514300", "+18658514300")).toBe(false);
    expect(
      blockSelfAddressedSms({
        from: "+18658514300",
        to: "+18658514300",
        customerPhone: "+18658514300",
        approvedSender: "+18658138437",
      }).ok
    ).toBe(false);
    expect(
      blockSelfAddressedSms({
        from: "+18658138437",
        to: "+18658514300",
        customerPhone: "+18658514300",
        approvedSender: "+18658138437",
      }).ok
    ).toBe(true);
  });

  it("blocks using the customer phone as sender when it is not the approved company number", () => {
    expect(
      blockSelfAddressedSms({
        from: "+18658514300",
        to: "+18658138437",
        customerPhone: "+18658514300",
        approvedSender: "+18658138437",
      }).reason
    ).toBe("sender_is_customer_phone");
  });

  it("keeps receptionist, scheduling, waiting, and booking SMS on sendCompanyCommunication", () => {
    const files = [
      "src/lib/agent-tools/send-result.ts",
      "src/lib/agent-tools/scheduling-session.ts",
      "src/lib/agent-tools/check-availability.ts",
      "src/lib/agent-tools/book-appointment.ts",
      "src/lib/intelligence/receptionist/v2/inbound.ts",
      "src/lib/waiting/messages.ts",
      "src/lib/scheduling/conversation.ts",
      "src/lib/scheduling/booking.ts",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toMatch(/sendCompanyCommunication|sendActionResultSms|sendSessionSms/);
      expect(source).not.toMatch(/fromNumber:\s*input\.(from|phone|customerPhone)/);
    }
    expect(readFileSync(resolve("src/lib/comms/provider.ts"), "utf8")).toMatch(/blockSelfAddressedSms/);
    expect(readFileSync(resolve("src/lib/comms/provider.ts"), "utf8")).toMatch(/from: sender.phoneNumber/);
    expect(readFileSync(resolve("src/lib/highlevel/communication-provider.ts"), "utf8")).toMatch(
      /fromNumber: sender.phoneNumber/
    );
    expect(readFileSync(resolve("src/lib/comms/outbound.ts"), "utf8")).toMatch(/fromNumber: input.from/);
  });
});
