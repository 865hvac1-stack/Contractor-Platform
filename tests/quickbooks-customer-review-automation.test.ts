import { describe, expect, it } from "vitest";
import {
  buildAutoApprovalUniverse,
  evaluateCustomerAutoApproval,
  normalizeReviewAddress,
} from "@/lib/quickbooks/customer-review-automation";
import type { InboundCustomerMatch, InboundCustomerProbe } from "@/lib/quickbooks/inbound-match";

const customer = {
  id: "c1",
  firstName: "John",
  lastName: "Smith",
  businessName: "Smith Heating",
  email: "john@example.com",
  phone: "(865) 555-1212",
  properties: [
    { address: "7108 Regal Lane", city: "Knoxville", zip: "37918" },
    { address: "8720 Hill Road", city: "Knoxville", zip: "37920" },
  ],
};

function exactMatch(confidence: "EXACT" | "HIGH" = "EXACT"): InboundCustomerMatch {
  return {
    confidence,
    customerId: "c1",
    reason: "deterministic",
    proposedAction: "LINK",
    signals: [],
  };
}

function evaluate(probe: InboundCustomerProbe, match = exactMatch()) {
  return evaluateCustomerAutoApproval({
    probe,
    match,
    universe: buildAutoApprovalUniverse([customer]),
    fingerprintFresh: true,
    candidateUnchanged: true,
  });
}

describe("QuickBooks customer review automation tiers", () => {
  it("qualifies unique email plus unique phone as Tier A", () => {
    expect(
      evaluate({
        quickbooksId: "QB-1",
        givenName: "John",
        familyName: "Smith",
        email: "JOHN@example.com",
        phone: "8655551212",
      })
    ).toMatchObject({ eligible: true, tier: "TIER_A" });
  });

  it("requires unique phone plus two supporting signals for Tier B", () => {
    const result = evaluate(
      {
        quickbooksId: "QB-2",
        givenName: "John",
        familyName: "Smith",
        companyName: "Smith Heating",
        phone: "8655551212",
      },
      exactMatch("HIGH")
    );
    expect(result).toMatchObject({ eligible: true, tier: "TIER_B" });
  });

  it("requires unique email plus two supporting signals for Tier C", () => {
    const result = evaluate(
      {
        quickbooksId: "QB-3",
        givenName: "John",
        familyName: "Smith",
        email: "john@example.com",
        shipAddr: {
          Line1: "7108 Regal Ln.",
          City: "Knoxville",
          PostalCode: "37918-1234",
        },
      },
      exactMatch("HIGH")
    );
    expect(result).toMatchObject({ eligible: true, tier: "TIER_C" });
  });

  it("checks every property and ignores unrelated additional properties", () => {
    const result = evaluate(
      {
        quickbooksId: "QB-4",
        givenName: "John",
        familyName: "Smith",
        phone: "8655551212",
        shipAddr: {
          Line1: "7108 Regal Ln",
          City: "Knoxville",
          PostalCode: "37918",
        },
      },
      exactMatch("HIGH")
    );
    expect(result).toMatchObject({ eligible: true, tier: "TIER_B" });
    expect(
      normalizeReviewAddress({ line1: "7108 Regal Lane.", city: "KNOXVILLE", zip: "37918-1234" })
    ).toBe("7108 regal ln|knoxville|37918");
  });

  it("blocks conflicting strong identifiers even when supporting identity matches", () => {
    const universe = buildAutoApprovalUniverse([
      customer,
      {
        id: "c2",
        firstName: "Jane",
        lastName: "Other",
        email: "jane@example.com",
        phone: "8655559999",
        properties: [],
      },
    ]);
    const result = evaluateCustomerAutoApproval({
      probe: {
        quickbooksId: "QB-conflict",
        givenName: "John",
        familyName: "Smith",
        email: "jane@example.com",
        phone: "8655551212",
      },
      match: exactMatch("HIGH"),
      universe,
      fingerprintFresh: true,
      candidateUnchanged: true,
    });
    expect(result).toMatchObject({
      eligible: false,
      blocker: "PHONE_EMAIL_RESOLVE_DIFFERENT_CUSTOMERS",
    });
  });

  it("blocks possible duplicates from every automatic tier", () => {
    expect(
      evaluate(
        { quickbooksId: "QB-possible", phone: "8655551212" },
        {
          confidence: "POSSIBLE",
          customerId: "c1",
          candidateIds: ["c1"],
          reason: "possible",
          proposedAction: "REVIEW",
          signals: ["phone"],
        }
      )
    ).toMatchObject({ eligible: false, blocker: "POSSIBLE_DUPLICATE" });
  });

  it("only marks a new customer safe when no strong identity candidate exists", () => {
    const safe = evaluateCustomerAutoApproval({
      probe: {
        quickbooksId: "QB-new",
        givenName: "New",
        familyName: "Customer",
        email: "new@example.com",
        phone: "8655557777",
      },
      match: {
        confidence: "NONE",
        customerId: null,
        reason: "new",
        proposedAction: "CREATE",
        signals: [],
      },
      universe: buildAutoApprovalUniverse([customer]),
      fingerprintFresh: true,
      candidateUnchanged: true,
    });
    expect(safe).toMatchObject({ eligible: true, tier: "SAFE_NEW" });

    const duplicate = evaluateCustomerAutoApproval({
      probe: {
        quickbooksId: "QB-new-2",
        givenName: "John",
        familyName: "Smith",
        shipAddr: { Line1: "7108 Regal Ln", City: "Knoxville", PostalCode: "37918" },
      },
      match: {
        confidence: "NONE",
        customerId: null,
        reason: "new",
        proposedAction: "CREATE",
        signals: [],
      },
      universe: buildAutoApprovalUniverse([customer]),
      fingerprintFresh: true,
      candidateUnchanged: true,
    });
    expect(duplicate).toMatchObject({ eligible: false, blocker: "POSSIBLE_DUPLICATE" });
  });
});
