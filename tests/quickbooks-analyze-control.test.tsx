// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
let resolveAction: ((value: unknown) => void) | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/server/actions/quickbooks-sync-center", () => ({
  analyzeQuickBooksImportAction: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveAction = resolve;
      })
  ),
}));

import { AnalyzeImportControl } from "@/components/quickbooks/analyze-import-control";

describe("AnalyzeImportControl", () => {
  afterEach(() => {
    cleanup();
    resolveAction = null;
    refresh.mockClear();
  });

  it("shows immediate loading feedback and disables repeat clicks", async () => {
    render(<AnalyzeImportControl />);
    const button = screen.getByRole("button", { name: "Analyze Import" });

    fireEvent.click(button);

    expect((await screen.findByRole("button", { name: "Analyzing QuickBooks…" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Starting read-only analysis…");

    await act(async () => {
      resolveAction?.({
        ok: false,
        error: "Import analysis failed. No records were changed.",
      });
    });

    expect(screen.getByRole("alert").textContent).toContain("Import analysis failed. No records were changed.");
  });

  it("shows category progress and refreshes after completion", async () => {
    render(<AnalyzeImportControl />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze Import" }));

    await act(async () => {
      resolveAction?.({
        ok: true,
        runId: "run-1",
        paused: false,
        autoContinue: false,
        message: "Import analysis finished. Nothing was written to QuickBooks or created as live ContractorYou work.",
        progress: {
          category: "COMPLETE",
          categoryLabel: "Complete",
          recordsExamined: 31_315,
          totalAvailable: 31_315,
          percent: 100,
        },
      });
    });

    expect(screen.getByRole("status").textContent).toContain("31,315 of approximately 31,315 records examined");
    expect(refresh).toHaveBeenCalled();
  });
});
