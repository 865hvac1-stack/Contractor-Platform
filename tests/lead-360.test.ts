import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { leadNeedsFollowUp } from "@/lib/leads/follow-up";
import { buildLeadInsights, buildVerifiedLeadNotes, summarizeLeadFacts } from "@/lib/leads/insights";
import { leadListWhere, leadSearchWhere } from "@/lib/leads/search";
import { can } from "@/lib/permissions";

describe("Lead 360 wiring", () => {
  it("makes the leads table a detail-and-action surface", () => {
    const list = readFileSync(resolve("src/app/(app)/marketing/leads/page.tsx"), "utf8");
    const row = readFileSync(resolve("src/components/leads/clickable-row.tsx"), "utf8");
    const search = readFileSync(resolve("src/lib/leads/search.ts"), "utf8");
    expect(list).toContain("ClickableLeadRow");
    expect(list).toContain("/marketing/leads/${lead.id}");
    expect(list).toContain("/customers/${lead.customer.id}");
    expect(list).toContain("/estimates/${lead.estimate.id}");
    expect(list).toContain("tel:");
    expect(list).toContain("compose=1");
    expect(list).toContain("Needs follow-up");
    expect(list).toContain("md:hidden");
    expect(list).toContain("sticky top-0");
    expect(row).toContain("cursor-pointer");
    expect(row).toContain("Enter");
    expect(row).toContain("role=\"link\"");
    expect(search).toContain("LEAD_PAGE_SIZE = 25");
    expect(search).toContain("companyId");
    expect(search).toContain("businessName");
  });

  it("builds Lead 360 on existing routes and systems", () => {
    const page = readFileSync(resolve("src/app/(app)/marketing/leads/[id]/page.tsx"), "utf8");
    const ai = readFileSync(resolve("src/components/leads/lead-ai-panel.tsx"), "utf8");
    const actions = readFileSync(resolve("src/server/actions/leads.ts"), "utf8");
    const estimate = readFileSync(resolve("src/app/(app)/estimates/new/page.tsx"), "utf8");
    const job = readFileSync(resolve("src/app/(app)/jobs/new/page.tsx"), "utf8");
    expect(page).toContain("NO CONTACT ATTEMPT");
    expect(ai).toContain("ContractorYou Intelligence");
    expect(page).toContain("Open conversation");
    expect(page).toContain("/jobs/new?leadId=");
    expect(page).toContain("/estimates/new?leadId=");
    expect(page).toContain("ConvertCustomerPanel");
    expect(page).toContain("Mark won");
    expect(page).toContain("Mark lost");
    expect(actions).toContain("Link them instead of creating a duplicate");
    expect(actions).toContain("confirmCreate");
    expect(actions).toContain("linkLeadToCustomerAction");
    expect(actions).toContain("setLeadNextActionAction");
    expect(estimate).toContain("leadId");
    expect(job).toContain("leadId");
  });

  it("keeps convert from silently merging customers", () => {
    const actions = readFileSync(resolve("src/server/actions/leads.ts"), "utf8");
    const convert = readFileSync(resolve("src/components/leads/convert-customer-panel.tsx"), "utf8");
    expect(actions).toContain("Link them instead of creating a duplicate");
    expect(actions).not.toMatch(/if \(match\) \{\s*customerId = match.customer.id/);
    expect(convert).toContain("not silently merge records");
    expect(convert).toContain("Link existing customer");
    expect(convert).toContain("/api/customers/search");
  });

  it("reuses inbox, estimates, schedule, and Action Center", () => {
    const page = readFileSync(resolve("src/app/(app)/marketing/leads/[id]/page.tsx"), "utf8");
    const attention = readFileSync(resolve("src/lib/attention.ts"), "utf8");
    const actions = readFileSync(resolve("src/lib/attention-actions.ts"), "utf8");
    const hub = readFileSync(resolve("src/lib/office/intelligence.ts"), "utf8");
    expect(page).toContain("/marketing/communications");
    expect(page).not.toContain("new Inbox");
    expect(attention).toContain("href: `/marketing/leads/${lead.id}`");
    expect(attention).toContain("lead-next-");
    expect(actions).toContain("/marketing/leads/${entityId}");
    expect(hub).toContain("/marketing/leads?needsResponse=1");
  });

  it("does not invent AI facts and stays usable without a provider", () => {
    const writing = readFileSync(resolve("src/lib/intelligence/writing.ts"), "utf8");
    const assistant = readFileSync(resolve("src/server/actions/intelligence.ts"), "utf8");
    const notes = buildVerifiedLeadNotes({
      id: "lead_1",
      firstName: "Gloria",
      lastName: "McClure",
      status: "NEW",
      source: "GOOGLE_ADS",
      receivedAt: new Date("2026-09-01T13:04:00Z"),
      assignedName: "Megan Brooks",
      opportunityCents: 73000,
    });
    const summary = summarizeLeadFacts(
      {
        id: "lead_1",
        firstName: "Gloria",
        lastName: "McClure",
        status: "NEW",
        source: "GOOGLE_ADS",
        receivedAt: new Date("2026-09-01T13:04:00Z"),
        assignedName: "Megan Brooks",
        opportunityCents: 73000,
      },
      new Date("2026-09-08T13:04:00Z")
    );
    expect(notes).toContain("Gloria McClure");
    expect(notes).toContain("unknown");
    expect(notes).not.toMatch(/close probability|80% chance|replacement furnace/i);
    expect(summary).toContain("Google Ads");
    expect(summary).toContain("No contact attempt is recorded");
    expect(summary).toContain("Megan Brooks");
    expect(summary).toContain("$730.00");
    expect(summary).not.toMatch(/likely to close|wants a replacement/i);
    expect(writing).toContain("Do not invent");
    expect(assistant).toContain("Lead 360 is still usable");
    expect(assistant).toContain("customer_followup");
  });

  it("keeps technicians off the marketing lead list unless authorized", () => {
    expect(can("TECHNICIAN", "leads:view")).toBe(false);
    expect(can("TECHNICIAN", "leads:manage")).toBe(false);
    expect(can("SALES", "leads:view")).toBe(true);
    expect(can("OFFICE", "leads:manage")).toBe(true);
  });
});

describe("lead follow-up rules", () => {
  it("uses only recorded timestamps and statuses", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    expect(
      leadNeedsFollowUp(
        {
          status: "NEW",
          receivedAt: new Date("2026-09-01T12:00:00Z"),
          firstRespondedAt: null,
          lastContactAt: null,
        },
        now
      )
    ).toBe("no_contact");
    expect(
      leadNeedsFollowUp(
        {
          status: "ESTIMATE_SENT",
          receivedAt: new Date("2026-09-01T12:00:00Z"),
          firstRespondedAt: new Date("2026-09-01T13:00:00Z"),
          lastContactAt: new Date("2026-09-01T13:00:00Z"),
          estimateStatus: "SENT",
          estimateUpdatedAt: new Date("2026-09-04T12:00:00Z"),
        },
        now
      )
    ).toBe("estimate_no_followup");
    expect(
      leadNeedsFollowUp(
        {
          status: "CONTACTED",
          receivedAt: new Date("2026-09-07T12:00:00Z"),
          firstRespondedAt: new Date("2026-09-07T13:00:00Z"),
          lastContactAt: new Date("2026-09-07T13:00:00Z"),
          nextActionAt: new Date("2026-09-07T18:00:00Z"),
        },
        now
      )
    ).toBe("next_action_overdue");
    expect(
      leadNeedsFollowUp(
        {
          status: "WON",
          receivedAt: new Date("2026-09-01T12:00:00Z"),
          firstRespondedAt: null,
          lastContactAt: null,
          nextActionAt: new Date("2026-09-01T12:00:00Z"),
        },
        now
      )
    ).toBeNull();
  });

  it("builds insights from verified facts only", () => {
    const insights = buildLeadInsights({
      id: "lead_1",
      firstName: "Gloria",
      lastName: "McClure",
      status: "NEW",
      source: "GOOGLE_LSA",
      receivedAt: new Date("2026-09-01T12:00:00Z"),
    });
    expect(insights.some((item) => item.text.includes("No contact attempt"))).toBe(true);
    expect(insights.some((item) => item.text.includes("Google Local Services Ads"))).toBe(true);
    expect(insights.every((item) => !/hot lead|80%|replacement/i.test(item.text))).toBe(true);
  });

  it("scopes list search to the company", () => {
    const where = leadSearchWhere("co_1", "Gloria McClure");
    expect(where.companyId).toBe("co_1");
    expect(JSON.stringify(where)).toContain("Gloria");
    const filtered = leadListWhere("co_1", { needsResponse: "1", q: "Gloria" });
    expect(filtered.companyId).toBe("co_1");
    expect(filtered.firstRespondedAt).toBeNull();
  });
});
