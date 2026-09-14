// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => "/settings/quickbooks/manage",
  useSearchParams: () => new URLSearchParams("view=review&filter=exact"),
}));
vi.mock("@/server/actions/quickbooks-sync-center", () => ({
  bulkQuickBooksReviewAction: vi.fn(async () => ({ ok: false, error: "Test action" })),
}));

import {
  ReviewCheckbox,
  ReviewSelection,
} from "@/components/quickbooks/review-selection";

function renderSelection(props?: Partial<React.ComponentProps<typeof ReviewSelection>>) {
  return render(
    <ReviewSelection
      pageIds={["r1", "r2"]}
      confidenceFilter="exact"
      safeExact={2_253}
      unsafeExact={41}
      safeNew={0}
      exactTotal={2_294}
      filteredTotal={2_253}
      analysisRunId="analysis-1"
      filterKey="review|exact"
      {...props}
    >
      <ReviewCheckbox id="r1" />
      <ReviewCheckbox id="r2" />
    </ReviewSelection>
  );
}

describe("QuickBooks review selection", () => {
  afterEach(() => {
    cleanup();
    replace.mockClear();
    refresh.mockClear();
  });

  it("selects the visible page and supports deselection", () => {
    renderSelection();
    fireEvent.click(screen.getByRole("button", { name: "Select Page" }));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("selects all filtered records without loading their IDs", () => {
    const { container } = renderSelection();
    fireEvent.click(screen.getByRole("button", { name: "Select All Filtered Results" }));

    expect(screen.getByText("2,253 filtered results selected")).toBeTruthy();
    expect((container.querySelector('input[name="selectionMode"]') as HTMLInputElement).value).toBe("ALL_FILTERED");
    expect((container.querySelector('input[name="selectedIds"]') as HTMLInputElement).value).toBe("");
    expect((container.querySelector('input[name="analysisRunId"]') as HTMLInputElement).value).toBe("analysis-1");
  });

  it("preserves all-filtered mode across pages and clears it when filters change", () => {
    const view = renderSelection({ initialSelectionMode: "ALL_FILTERED" });
    expect(screen.getByText("2,253 filtered results selected")).toBeTruthy();

    view.rerender(
      <ReviewSelection
        pageIds={["r26", "r27"]}
        confidenceFilter="exact"
        safeExact={2_253}
        unsafeExact={41}
        safeNew={0}
        exactTotal={2_294}
        filteredTotal={2_253}
        analysisRunId="analysis-1"
        filterKey="review|exact"
        initialSelectionMode="ALL_FILTERED"
      >
        <ReviewCheckbox id="r26" />
      </ReviewSelection>
    );
    expect(screen.getByText("2,253 filtered results selected")).toBeTruthy();

    view.rerender(
      <ReviewSelection
        pageIds={["high-1"]}
        confidenceFilter="high"
        safeExact={2_253}
        unsafeExact={41}
        safeNew={0}
        exactTotal={2_294}
        filteredTotal={313}
        analysisRunId="analysis-1"
        filterKey="review|high"
        initialSelectionMode="NONE"
      >
        <ReviewCheckbox id="high-1" />
      </ReviewSelection>
    );
    expect(screen.getByText("0 selected")).toBeTruthy();
  });
});
