export function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function scoreNameMatch(query: string, name: string | null | undefined) {
  const q = normalizeSearchText(query);
  const n = normalizeSearchText(name ?? "");
  if (!q || !n) return 0;
  if (n === q) return 100;
  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length >= 2 && tokens.every((token) => n.includes(token))) return 92;
  if (n.startsWith(q)) return 84;
  if (n.includes(q)) return 70;
  if (tokens.some((token) => token.length >= 2 && n.startsWith(token))) return 56;
  if (tokens.some((token) => token.length >= 2 && n.includes(token))) return 40;
  return 0;
}

export function scoreCodeMatch(query: string, code: string | null | undefined) {
  const q = normalizeSearchText(query).replace(/^#/, "");
  const c = normalizeSearchText(code ?? "").replace(/^#/, "");
  if (!q || !c) return 0;
  if (c === q) return 100;
  if (c.endsWith(q) || c.includes(q)) return q.length >= 4 ? 88 : 55;
  return 0;
}

export function scorePhoneMatch(query: string, phone: string | null | undefined) {
  const q = digitsOnly(query);
  const p = digitsOnly(phone ?? "");
  if (q.length < 3 || p.length < 3) return 0;
  if (p === q) return 100;
  if (p.endsWith(q) || q.endsWith(p.slice(-10))) return 94;
  if (p.includes(q) || q.includes(p.slice(-10))) return 72;
  return 0;
}

export function scoreAddressMatch(query: string, address: string | null | undefined) {
  const q = normalizeSearchText(query);
  const a = normalizeSearchText(address ?? "");
  if (!q || !a) return 0;
  if (a === q) return 96;
  if (a.includes(q)) return 78;
  const tokens = q.split(" ").filter((token) => token.length >= 3);
  if (tokens.length && tokens.every((token) => a.includes(token))) return 74;
  return 0;
}
