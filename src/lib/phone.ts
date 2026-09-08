/**
 * One canonical phone helper for ContractorYou.
 * US numbers become E.164 (+1 + 10 digits). Display stays friendly.
 * Do not invent a country code when the number is not a clear US 10-digit value.
 */

export function digitsOnlyPhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function canonicalizeUsPhone(value: unknown): string | null {
  const digits = digitsOnlyPhone(value);
  if (!digits) return null;
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  if (national[0] === "0" || national[0] === "1") return null;
  return `+1${national}`;
}

export function formatUsPhoneDisplay(value: unknown): string | null {
  const canonical = canonicalizeUsPhone(value);
  if (!canonical) return null;
  const national = canonical.slice(2);
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

export function phonesMatch(left: unknown, right: unknown): boolean {
  const a = canonicalizeUsPhone(left);
  const b = canonicalizeUsPhone(right);
  return Boolean(a && b && a === b);
}
