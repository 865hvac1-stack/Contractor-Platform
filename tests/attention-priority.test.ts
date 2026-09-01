import { describe, expect, it } from "vitest";
import type { AttentionItem } from "@/lib/attention";
import {
  HOME_ATTENTION_LIMIT,
  filterAttention,
  homeAttentionItems,
  prioritizeAttention,
  priorityFromScore,
  scoreAttentionItem,
  sortAttention,
} from "@/lib/attention-priority";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function item(partial: Partial<AttentionItem> & Pick<AttentionItem, "id" | "type" | "title">): AttentionItem {
  return {
    description: partial.description ?? "Item",
    severity: partial.severity ?? "warning",
    href: partial.href ?? "/x",
    entityType: partial.entityType ?? "Invoice",
    entityId: partial.entityId ?? partial.id,
    createdAt: partial.createdAt ?? new Date("2026-08-20T12:00:00.000Z"),
    ...partial,
  };
}

describe("attention priority scoring", () => {
  const now = new Date("2026-09-01T16:00:00.000Z");

  it("ranks a large overdue invoice above a receipt review", () => {
    const ranked = prioritizeAttention(
      [
        item({
          id: "receipt",
          type: "receipt_missing_category",
          title: "Receipt needs review",
          severity: "info",
          createdAt: now,
        }),
        item({
          id: "invoice",
          type: "invoice_overdue",
          title: "Overdue invoice",
          amountCents: 1_200_000,
          customerName: "Robert Miller",
          createdAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      ],
      now
    );
    expect(ranked[0]?.id).toBe("invoice");
    expect(ranked[0]?.priority).toBe("CRITICAL");
    expect(ranked[1]?.priority).toBe("LOW");
  });

  it("does not mark a small estimate follow-up as critical", () => {
    const scored = scoreAttentionItem(
      item({
        id: "est",
        type: "estimate_not_followed_up",
        title: "Estimate follow-up",
        amountCents: 40000,
        createdAt: new Date("2026-08-29T12:00:00.000Z"),
      }),
      now
    );
    expect(scored.priority).not.toBe("CRITICAL");
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(scored.priority);
  });

  it("limits the home queue to the top critical and high items first", () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      item({
        id: `inv-${index}`,
        type: index < 3 ? "invoice_overdue" : index < 7 ? "estimate_not_followed_up" : "receipt_missing_category",
        title: `Item ${index}`,
        amountCents: index < 3 ? 900000 : 180000,
        createdAt: new Date(now.getTime() - (index + 2) * 86_400_000),
      })
    );
    const home = homeAttentionItems(prioritizeAttention(items, now));
    expect(home).toHaveLength(HOME_ATTENTION_LIMIT);
    expect(home.filter((row) => row.priority === "CRITICAL" || row.priority === "HIGH").length).toBeGreaterThanOrEqual(3);
    expect(home[0]?.type).toBe("invoice_overdue");
  });

  it("filters and sorts without dropping underlying items", () => {
    const ranked = prioritizeAttention(
      [
        item({ id: "a", type: "invoice_overdue", title: "Overdue", amountCents: 200000, category: "money" }),
        item({ id: "b", type: "lead_unanswered", title: "Lead", amountCents: 0, category: "sales", createdAt: now }),
        item({ id: "c", type: "receipt_missing_category", title: "Receipt", severity: "info" }),
      ],
      now
    );
    expect(filterAttention(ranked, "money").map((row) => row.id)).toEqual(["a"]);
    expect(sortAttention(ranked, "dollars")[0]?.id).toBe("a");
    expect(sortAttention(ranked, "newest")[0]?.id).toBe("b");
    expect(ranked).toHaveLength(3);
  });

  it("maps scores into restrained priority bands", () => {
    expect(priorityFromScore(80)).toBe("CRITICAL");
    expect(priorityFromScore(50)).toBe("HIGH");
    expect(priorityFromScore(30)).toBe("MEDIUM");
    expect(priorityFromScore(12)).toBe("LOW");
  });

  it("does not hard-code demo KPI totals in the Command Center", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/(app)/dashboard/page.tsx"), "utf8");
    expect(page).not.toMatch(/\$36,924|\$66,801|\$17,480/);
    expect(page).toMatch(/getCommandCenterData/);
    expect(page).toMatch(/AttentionSummary|DASHBOARD_ATTENTION_LIMIT/);
  });
});
