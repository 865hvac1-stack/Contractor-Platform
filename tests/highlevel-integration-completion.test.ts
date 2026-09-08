import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { can } from "@/lib/permissions";

describe("HighLevel production integration completion", () => {
  it("keeps one canonical connection resolver and communication service", () => {
    const connection = readFileSync(resolve("src/lib/highlevel/connection.ts"), "utf8");
    const comms = readFileSync(resolve("src/lib/comms/provider.ts"), "utf8");
    const outbound = readFileSync(resolve("src/lib/comms/outbound.ts"), "utf8");
    const inbox = readFileSync(resolve("src/server/actions/highlevel.ts"), "utf8");
    const waiting = readFileSync(resolve("src/lib/waiting/messages.ts"), "utf8");
    expect(connection).toContain("export async function resolveHighLevelConnection");
    expect(connection).toContain("export async function loadHighLevelAccess");
    expect(comms).toContain("sendViaHighLevel");
    expect(comms).toContain("sendCustomerMessage");
    expect(comms).toContain("demoOutboundBlock");
    expect(outbound).toContain("upsertConversationMessage");
    expect(inbox).toContain("sendCompanyCommunication");
    expect(waiting).toContain("sendCompanyCommunication");
    expect(waiting).not.toContain("recordWaitingOutboundSms");
  });

  it("wires Inbox, Lead 360, Customer 360, and Hub to existing records", () => {
    const lead360 = readFileSync(resolve("src/app/(app)/marketing/leads/[id]/page.tsx"), "utf8");
    const customer = readFileSync(resolve("src/components/customers/customer-360-view.tsx"), "utf8");
    const inboxPage = readFileSync(resolve("src/app/(app)/marketing/communications/page.tsx"), "utf8");
    const hub = readFileSync(resolve("src/lib/office/hub.ts"), "utf8");
    expect(lead360).toContain("compose=1");
    expect(lead360).toContain("/marketing/communications");
    expect(lead360).toContain("NO CONTACT ATTEMPT");
    expect(customer).toContain("compose=1");
    expect(customer).toContain("/marketing/communications/${thread.id}");
    expect(customer).toContain("CompanySmsForm");
    expect(inboxPage).toContain("CompanySmsForm");
    expect(hub).toContain("isHighLevelConnected");
  });

  it("does not invent HighLevel email, click-to-call, or appointment writes", () => {
    const client = readFileSync(resolve("src/lib/highlevel/client.ts"), "utf8");
    const lead360 = readFileSync(resolve("src/app/(app)/marketing/leads/[id]/page.tsx"), "utf8");
    expect(client).not.toMatch(/sendHighLevelEmail/);
    expect(client).not.toMatch(/calendars\/events/);
    expect(lead360).toContain("mailto:");
    expect(lead360).toContain("tel:");
    expect(readFileSync(resolve("src/lib/highlevel/config.ts"), "utf8")).toContain("calendars.readonly");
    expect(readFileSync(resolve("src/lib/highlevel/config.ts"), "utf8")).not.toContain("opportunities.write");
  });

  it("skips unnecessary leads for known customers and keeps opportunity ingest", () => {
    const leads = readFileSync(resolve("src/lib/highlevel/leads.ts"), "utf8");
    const webhooks = readFileSync(resolve("src/lib/highlevel/webhooks.ts"), "utf8");
    expect(leads).toContain('role ?? "contact"');
    expect(leads).toContain("skippedLead");
    expect(leads).toContain("name_only_ignored");
    expect(webhooks).toContain('role: "opportunity"');
  });

  it("keeps technicians off HighLevel settings and marketing manage", () => {
    expect(can("TECHNICIAN", "marketing:manage")).toBe(false);
    expect(can("OFFICE", "marketing:manage")).toBe(true);
  });
});
