import { createHash } from "crypto";
import {
  MAX_COLUMNS,
  MAX_FILE_BYTES,
  MAX_IMPORT_ROWS,
  type FileAnalysis,
} from "@/lib/imports/types";
import {
  allowedImportMime,
  isOleBuffer,
  isZipBuffer,
  looksLikeHtml,
} from "@/lib/imports/security";
import { normalizeText, rawCell } from "@/lib/imports/normalize";

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, string>[];
  encoding: string;
  fileKind: "csv" | "xlsx" | "xls";
  fileHash: string;
};

export function hashFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function detectFileKind(
  fileName: string,
  mime: string | null | undefined,
  buffer: Buffer
): "csv" | "xlsx" | "xls" {
  if (!allowedImportMime(mime)) {
    throw new Error("That file type is not allowed. Upload a CSV or Excel file.");
  }
  if (looksLikeHtml(buffer)) {
    throw new Error("That file looks like a web page, not a customer list.");
  }
  if (isZipBuffer(buffer)) return "xlsx";
  if (isOleBuffer(buffer)) return "xls";
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "csv" || ext === "txt" || ext === "tsv") return "csv";
  const sample = buffer.subarray(0, 400).toString("utf8");
  if (sample.includes(",") || sample.includes("\t") || sample.includes(";")) return "csv";
  throw new Error("Upload a CSV, XLSX, or XLS file.");
}

export function decodeText(buffer: Buffer): { text: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  }
  return { text: buffer.toString("utf8"), encoding: "utf-8" };
}

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === "," || char === "\t" || char === ";") {
      current.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      current.push(field);
      if (current.some((cell) => cell.trim())) rows.push(current);
      current = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field || current.length) {
    current.push(field);
    if (current.some((cell) => cell.trim())) rows.push(current);
  }
  return rows;
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header, index) => {
    const base = normalizeText(header) || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function rowsFromGrid(grid: string[][]): { headers: string[]; rows: Record<string, string>[] } {
  if (grid.length === 0) throw new Error("That file is empty.");
  const headers = uniqueHeaders(grid[0]!).slice(0, MAX_COLUMNS);
  const rows: Record<string, string>[] = [];
  for (const line of grid.slice(1)) {
    if (line.every((cell) => !normalizeText(cell))) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = normalizeText(line[index] ?? "");
    });
    rows.push(record);
    if (rows.length >= MAX_IMPORT_ROWS) break;
  }
  if (rows.length === 0) throw new Error("We found column names but no customer rows.");
  return { headers, rows };
}

async function parseSpreadsheet(buffer: Buffer, _kind: "xlsx" | "xls"): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: false,
    cellDates: true,
    cellFormula: false,
    sheetStubs: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("That spreadsheet has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("That spreadsheet has no readable sheet.");
  const grid = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return grid.map((row) => (Array.isArray(row) ? row.map((cell) => rawCell(cell)) : []));
}

export async function parseImportFile(input: {
  fileName: string;
  mimeType?: string | null;
  buffer: Buffer;
}): Promise<ParsedSheet> {
  if (input.buffer.length === 0) throw new Error("That file is empty.");
  if (input.buffer.length > MAX_FILE_BYTES) {
    throw new Error("That file is larger than 8 MB. Split it into a smaller export and try again.");
  }
  const fileKind = detectFileKind(input.fileName, input.mimeType, input.buffer);
  const fileHash = hashFile(input.buffer);
  if (fileKind === "csv") {
    const decoded = decodeText(input.buffer);
    return { ...rowsFromGrid(parseCsvText(decoded.text)), encoding: decoded.encoding, fileKind, fileHash };
  }
  const grid = await parseSpreadsheet(input.buffer, fileKind);
  return { ...rowsFromGrid(grid), encoding: "binary", fileKind, fileHash };
}

export function analysisFromParsed(
  parsed: ParsedSheet,
  extras: Pick<FileAnalysis, "detectedSource" | "detectedSourceLabel" | "detectedSourceConfidence" | "presetName" | "message" | "columns">
): FileAnalysis {
  const counts = new Map<string, number>();
  parsed.headers.forEach((header) => counts.set(header, (counts.get(header) ?? 0) + 1));
  return {
    headers: parsed.headers,
    duplicateHeaders: parsed.headers.filter((header, index) => parsed.headers.indexOf(header) !== index),
    blankHeaders: parsed.headers.filter((header) => !header.trim() || header.startsWith("Column ")),
    rowCount: parsed.rows.length,
    encoding: parsed.encoding,
    fileKind: parsed.fileKind,
    ...extras,
  };
}
