const FORBIDDEN = [
  /\bas an ai\b/i,
  /\bi cannot access\b/i,
  /\bthe system returned\b/i,
  /\bmy scheduling tool\b/i,
  /\bcontractoryou\b/i,
  /\bhighlevel\b/i,
  /\bapi\b/i,
  /\bslot_token\b/i,
  /\bstack trace\b/i,
];

export function sanitizeCustomerSms(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !FORBIDDEN.some((pattern) => pattern.test(line)));
  const cleaned = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "I’ve got this flagged for the office so we can take care of it.";
  return cleaned.slice(0, 480);
}
