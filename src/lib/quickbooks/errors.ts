export function humanQuickBooksError(input: {
  code?: string | null;
  message?: string | null;
  missing?: "customer" | "item" | "account" | "auth" | "date";
}) {
  if (input.missing === "customer") return "Customer needs to be linked before invoice can sync.";
  if (input.missing === "item") return "QuickBooks Product/Service mapping is missing.";
  if (input.missing === "account") return "QuickBooks expense account mapping is missing.";
  if (input.missing === "auth") return "QuickBooks authorization needs to be renewed.";
  if (input.missing === "date") return "This record is before the company sync start date.";
  const raw = (input.message || "").toLowerCase();
  if (raw.includes("reauth") || raw.includes("authorization") || raw.includes("401")) {
    return "QuickBooks authorization needs to be renewed.";
  }
  if (raw.includes("historical")) return "Imported history stays in ContractorYou until you sync that record on purpose.";
  if (raw.includes("rate") || raw.includes("429")) return "QuickBooks asked us to wait. Try again in a minute.";
  return input.message || "We could not finish that QuickBooks sync.";
}

export function maskRealmId(realmId?: string | null) {
  const value = (realmId || "").trim();
  if (!value) return "—";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}
