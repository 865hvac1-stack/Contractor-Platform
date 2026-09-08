import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildWritingMessages,
  parseWritingStyle,
  sanitizeWriterNotes,
  writeProfessionalCopy,
} from "@/lib/intelligence/writing";

describe("AI invoice writer", () => {
  it("does not generate from empty notes", async () => {
    const result = await writeProfessionalCopy({
      companyId: "co_1",
      userId: "user_1",
      purpose: "invoice_description",
      notes: "   ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Add what you did first/);
  });

  it("keeps the writing prompt from inventing work", () => {
    const messages = buildWritingMessages({
      purpose: "invoice_description",
      notes: "replaced contactor",
      style: "professional",
    });
    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toMatch(/Do not invent diagnostics/);
    expect(prompt).toMatch(/Do not add pricing/);
    expect(prompt).toMatch(/replaced contactor/);
    expect(prompt).toContain("<untrusted_business_data");
    expect(prompt).not.toMatch(/amperage|refrigerant/i);
  });

  it("preserves supplied facts for mixed field notes", () => {
    const messages = buildWritingMessages({
      purpose: "invoice_description",
      notes: "changed capacitor washed coil checked pressures",
      style: "concise",
      job: {
        serviceType: "No Cooling",
        jobType: "Service",
        status: "COMPLETED",
        workNotes: ["Found contactor failed"],
        parts: ["2-pole 40A contactor"],
      },
    });
    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("changed capacitor washed coil checked pressures");
    expect(prompt).toContain("Found contactor failed");
    expect(prompt).toContain("2-pole 40A contactor");
    expect(prompt).not.toMatch(/555-|@|password|secret/i);
  });

  it("defaults style to professional and trims notes", () => {
    expect(parseWritingStyle("detailed")).toBe("detailed");
    expect(parseWritingStyle("nope")).toBe("professional");
    expect(sanitizeWriterNotes("  replaced thermostat  ")).toBe("replaced thermostat");
  });

  it("shows an unavailable state when the provider is not configured", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await writeProfessionalCopy({
      companyId: "co_1",
      userId: "user_1",
      purpose: "invoice_description",
      notes: "replaced contactor",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unavailable).toBe(true);
      expect(result.error).toMatch(/unavailable/);
    }
    if (prev) process.env.OPENAI_API_KEY = prev;
  });

  it("wires the New Invoice screen without changing line-item math", () => {
    const page = readFileSync(resolve("src/app/(app)/invoices/new/page.tsx"), "utf8");
    const picker = readFileSync(resolve("src/components/service-type-picker.tsx"), "utf8");
    const writer = readFileSync(resolve("src/components/intelligence/professional-writer.tsx"), "utf8");
    const billing = readFileSync(resolve("src/server/actions/billing.ts"), "utf8");
    expect(page).toContain("writingAssist");
    expect(picker).toContain("ProfessionalWriter");
    expect(writer).toContain("Use this description");
    expect(writer).toContain("Try again");
    expect(writer).toContain("Keep mine");
    expect(writer).toContain("Add work notes first");
    expect(writer).toContain('type="button"');
    expect(writer).not.toContain("<form");
    expect(billing).toContain("createInvoiceAction");
    expect(writer).not.toContain("unitPriceCents");
    expect(page).not.toContain("unitPriceCents");
    const jobNew = readFileSync(resolve("src/app/(app)/jobs/new/page.tsx"), "utf8");
    expect(jobNew).not.toContain("writingAssist");
  });
});
