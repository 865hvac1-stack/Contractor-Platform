// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const resolveAction = vi.fn(async (_previous: unknown, formData: FormData) => ({
  ok: true,
  message: `Saved ${formData.get("resolution")}`,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/server/actions/quickbooks-sync-center", () => ({
  resolveQuickBooksExceptionAction: (...args: [unknown, FormData]) => resolveAction(...args),
  skipQuickBooksExceptionAction: vi.fn(async () => ({ ok: true, message: "Skipped" })),
  undoLastQuickBooksExceptionAction: vi.fn(async () => ({ ok: true, message: "Undone" })),
  flagQuickBooksMergeReviewAction: vi.fn(async () => ({ ok: true, message: "Flagged" })),
}));

import { ExceptionReviewer } from "@/components/quickbooks/exception-reviewer";

const current = {
  id: "review-1",
  quickbooksId: "QB-1",
  displayName: "TJ Hurst",
  confidence: "POSSIBLE",
  confidenceScore: 80,
  blocker: "POSSIBLE_DUPLICATE",
  blockerLabel: "Possible duplicate requires judgment",
  reason: "Email and address match, but phone differs.",
  skipped: false,
  qbo: {
    name: "TJ Hurst",
    company: "865 HVAC",
    phone: "865-555-1111",
    email: "tj@example.com",
    billingAddress: "123 Main Street, Knoxville, TN 37901",
    serviceAddress: null,
  },
  candidates: [{
    id: "customer-1",
    name: "TJ Hurst",
    firstName: "TJ",
    lastName: "Hurst",
    company: "865 HVAC",
    phone: "865-555-2222",
    email: "tj@example.com",
    confidence: 75,
    matchedFields: ["Name", "Email", "Address"],
    differentFields: ["Phone"],
    properties: [{
      id: "property-1",
      address: "123 Main St",
      city: "Knoxville",
      state: "TN",
      zip: "37901",
      isPrimary: true,
      matching: true,
    }],
    comparisons: [{
      field: "Phone",
      quickBooks: "865-555-1111",
      contractorYou: "865-555-2222",
      status: "DIFFERENT" as const,
    }],
  }],
  searchedCandidates: [],
};

describe("QuickBooks exception reviewer", () => {
  afterEach(() => {
    cleanup();
    refresh.mockClear();
    resolveAction.mockClear();
  });

  it("shows the blocker, all properties, and side-by-side differences", () => {
    render(<ExceptionReviewer current={current} canManage canUndo={false} />);
    expect(screen.getByText("Possible duplicate requires judgment")).toBeTruthy();
    expect(screen.getByText(/123 Main St, Knoxville/)).toBeTruthy();
    expect(screen.getByText("MATCHING PROPERTY")).toBeTruthy();
    expect(screen.getByText("DIFFERENT")).toBeTruthy();
    expect(screen.getByText("QuickBooks:").parentElement?.textContent).toContain("865-555-1111");
  });

  it("uses safe visible shortcuts and auto-advances by refreshing after save", async () => {
    render(<ExceptionReviewer current={current} canManage canUndo={false} />);
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(resolveAction).toHaveBeenCalledTimes(1));
    const formData = resolveAction.mock.calls[0]![1];
    expect(formData.get("resolution")).toBe("LINK");
    expect(formData.get("targetCustomerId")).toBe("customer-1");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-review-shortcut="merge"]')).toBeNull();
  });
});
