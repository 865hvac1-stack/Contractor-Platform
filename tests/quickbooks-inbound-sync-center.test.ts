import { describe, expect, it } from "vitest";
import { buildInboundCustomerIndex, classifyAccountType, classifyInboundCustomer, classifyPricebookItem } from "@/lib/quickbooks/inbound-match";
import { readOnlyQuickBooksTransport } from "@/lib/quickbooks/read-only";
import { isQuickBooksWriteMethod, QUICKBOOKS_WRITEBACK_ENABLED } from "@/lib/quickbooks/writeback";
import { assertImportConfirmation } from "@/lib/quickbooks/inbound-import";
import { IMPORT_CONFIRMATION } from "@/lib/quickbooks/inbound-types";
import type { QboTransport } from "@/lib/quickbooks/client";

function customers() {
  return [
    {
      id: "c1",
      firstName: "Ada",
      lastName: "West",
      businessName: null,
      email: "ada@example.com",
      phone: "(865) 555-0100",
      properties: [{ address: "100 Main St", city: "Knoxville", zip: "37902" }],
    },
    {
      id: "c2",
      firstName: "Ben",
      lastName: "West",
      businessName: null,
      email: "ben@example.com",
      phone: "8655550199",
    },
  ];
}

describe("QuickBooks inbound matching", () => {
  const index = buildInboundCustomerIndex(customers(), [{ quickbooksId: "QB-1", customerId: "c1" }]);

  it("exact-matches an existing QuickBooks external id", () => {
    const match = classifyInboundCustomer(index, {
      quickbooksId: "QB-1",
      displayName: "Ada West",
      email: "other@example.com",
    });
    expect(match.confidence).toBe("EXACT");
    expect(match.customerId).toBe("c1");
    expect(match.proposedAction).toBe("LINK");
  });

  it("high-confidence matches unique email without silently merging possibles", () => {
    const email = classifyInboundCustomer(index, {
      quickbooksId: "QB-new",
      displayName: "Ada W",
      email: "ADA@example.com",
    });
    expect(email.confidence).toBe("HIGH");
    expect(email.proposedAction).toBe("LINK");

    const possible = classifyInboundCustomer(index, {
      quickbooksId: "QB-phone",
      displayName: "Someone Else",
      phone: "865-555-0100",
    });
    expect(possible.confidence).toBe("POSSIBLE");
    expect(possible.proposedAction).toBe("REVIEW");
  });

  it("does not treat a new customer as a duplicate", () => {
    const match = classifyInboundCustomer(index, {
      quickbooksId: "QB-9",
      displayName: "New HVAC Co",
      email: "new@hvac.test",
      phone: "8655550000",
    });
    expect(match.confidence).toBe("NONE");
    expect(match.proposedAction).toBe("CREATE");
  });

  it("requires review for name-only pricebook matches", () => {
    const match = classifyPricebookItem({
      quickbooksId: "I1",
      name: "Service Call",
      mappedItemId: null,
      nameMatches: [{ id: "p1", name: "Service Call" }],
      skuMatches: [],
    });
    expect(match.confidence).toBe("POSSIBLE");
    expect(match.proposedAction).toBe("REVIEW");
  });
});

describe("QuickBooks inbound safety", () => {
  it("keeps write-back disabled for this phase", () => {
    expect(QUICKBOOKS_WRITEBACK_ENABLED).toBe(false);
    expect(isQuickBooksWriteMethod("POST")).toBe(true);
    expect(isQuickBooksWriteMethod("GET")).toBe(false);
  });

  it("blocks POST on the read-only analysis transport", async () => {
    const calls: string[] = [];
    const transport: QboTransport = async (input) => {
      calls.push(input.method);
      return { ok: true, status: 200, json: {} };
    };
    const readOnly = readOnlyQuickBooksTransport(transport);
    await expect(readOnly({ method: "POST", path: "/customer" })).rejects.toThrow(/write-back is not enabled/i);
    expect(calls).toEqual([]);
    await readOnly({ method: "GET", path: "/query", query: "select count(*) from Customer" });
    expect(calls).toEqual(["GET"]);
  });

  it("refuses import without the confirmation phrase", () => {
    expect(assertImportConfirmation("import everything")).toBe(false);
    expect(assertImportConfirmation(IMPORT_CONFIRMATION)).toBe(true);
  });

  it("classifies QuickBooks accounts without guessing profit", () => {
    expect(classifyAccountType("Income")).toBe("INCOME");
    expect(classifyAccountType("Cost of Goods Sold")).toBe("COGS");
    expect(classifyAccountType("Expense")).toBe("OPERATING_EXPENSE");
    expect(classifyAccountType("Bank")).toBe("ASSET");
  });
});

describe("idempotent inbound identity", () => {
  it("keeps the same QuickBooks id on one tenant record", () => {
    const index = buildInboundCustomerIndex(
      [{ id: "local", firstName: "Ada", lastName: "West", email: "ada@example.com", phone: null, externalId: "99", sourceSystem: "quickbooks_online" }],
      [{ quickbooksId: "99", customerId: "local" }]
    );
    const first = classifyInboundCustomer(index, { quickbooksId: "99", displayName: "Ada West" });
    const second = classifyInboundCustomer(index, { quickbooksId: "99", displayName: "Ada West" });
    expect(first.customerId).toBe("local");
    expect(second.customerId).toBe(first.customerId);
    expect(first.confidence).toBe("EXACT");
  });
});
