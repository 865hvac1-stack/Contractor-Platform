import { describe, expect, it } from "vitest";
import { canonicalizeUsPhone, formatUsPhoneDisplay, phonesMatch } from "@/lib/phone";
import { customerSearchWhere } from "@/lib/customers/search";
import { customerSchema } from "@/lib/validators";
import { customerSearchWhere as customerListSearchWhere } from "@/lib/customers/list";

describe("canonical US phone normalization", () => {
  it("accepts common US entry formats as +1 E.164", () => {
    const expected = "+18658514300";
    expect(canonicalizeUsPhone("8658514300")).toBe(expected);
    expect(canonicalizeUsPhone("(865) 851-4300")).toBe(expected);
    expect(canonicalizeUsPhone("865-851-4300")).toBe(expected);
    expect(canonicalizeUsPhone("1-865-851-4300")).toBe(expected);
    expect(canonicalizeUsPhone("+18658514300")).toBe(expected);
    expect(phonesMatch("8658514300", "+1 865 851 4300")).toBe(true);
    expect(formatUsPhoneDisplay("8658514300")).toBe("(865) 851-4300");
  });

  it("does not invent a country code for ambiguous numbers", () => {
    expect(canonicalizeUsPhone("8514300")).toBeNull();
    expect(canonicalizeUsPhone("0118658514300")).toBeNull();
    expect(canonicalizeUsPhone("")).toBeNull();
  });

  it("lets customer search find a canonical phone from local digits", () => {
    const where = customerSearchWhere("company_1", "8658514300");
    expect(JSON.stringify(where)).toContain("+18658514300");
    expect(JSON.stringify(where)).toContain("8658514300");
    const listWhere = customerListSearchWhere("company_1", "(865) 851-4300", "all");
    expect(JSON.stringify(listWhere)).toContain("+18658514300");
  });

  it("accepts raw US phone entry on customer create and edit schemas", () => {
    const parsed = customerSchema.parse({
      firstName: "Casey",
      lastName: "Rivera",
      phone: "8658514300",
      secondaryPhone: "1-865-851-4300",
    });
    expect(canonicalizeUsPhone(parsed.phone)).toBe("+18658514300");
    expect(canonicalizeUsPhone(parsed.secondaryPhone)).toBe("+18658514300");
  });
});
