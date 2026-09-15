// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StarRating } from "@/components/technician-intelligence/star-rating";

describe("StarRating", () => {
  afterEach(() => {
    cleanup();
  });

  it("updates the hidden form value without submitting the parent form", () => {
    const onSubmit = () => {
      throw new Error("star click must not submit the evaluation form");
    };
    render(
      <form onSubmit={onSubmit}>
        <StarRating name="rating:no-cooling" defaultValue={3} />
        <button type="submit">Save owner evaluation</button>
      </form>
    );

    fireEvent.click(screen.getByRole("radio", { name: "5 out of 5" }));

    expect((screen.getByDisplayValue("5") as HTMLInputElement).name).toBe("rating:no-cooling");
    expect(screen.getByRole("radio", { name: "5 out of 5" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "3 out of 5" }).getAttribute("aria-checked")).toBe("false");
  });
});
