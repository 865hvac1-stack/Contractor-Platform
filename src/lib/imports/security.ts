const FORMULA_PREFIX = /^[=+\-@|\t\r]/;

export function neutralizeCell(value: string): string {
  const trimmed = value.replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (FORMULA_PREFIX.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

export function csvEscape(value: string): string {
  const safe = neutralizeCell(value);
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 200).toString("utf8").toLowerCase();
  return head.includes("<html") || head.includes("<!doctype html") || head.includes("<script");
}

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function isOleBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

export function allowedImportMime(mime: string | null | undefined): boolean {
  if (!mime) return true;
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  return [
    "text/csv",
    "text/plain",
    "application/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ].includes(normalized);
}
