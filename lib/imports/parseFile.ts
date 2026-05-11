import Papa from "papaparse";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single parsed row: column name → raw value (string, number, null, etc.) */
export type ParsedRow = Record<string, unknown>;

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Parse a CSV or XLSX file buffer into an array of row objects.
 *
 * - .csv  → parsed with papaparse (header row required)
 * - .xlsx / .xls → first sheet parsed with SheetJS
 *
 * Returns an empty array if the file has no data rows.
 *
 * TODO: When TrackMan export structure is confirmed, add a
 *       normalizeTrackManRow() function here that maps known column
 *       names onto our DemoClubTest / ClubTestMetrics fields.
 */
export function parseFileBuffer(buffer: Buffer, fileName: string): ParsedRow[] {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "csv") {
    return parseCsv(buffer);
  }

  if (ext === "xlsx" || ext === "xls") {
    return parseXlsx(buffer);
  }

  throw new Error(
    `Unsupported file type ".${ext}". Only .csv and .xlsx are accepted.`,
  );
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function parseCsv(buffer: Buffer): ParsedRow[] {
  const text = buffer.toString("utf-8");

  const result = Papa.parse<ParsedRow>(text, {
    header: true,          // use first row as column names
    skipEmptyLines: true,  // drop blank rows
    dynamicTyping: false,  // keep everything as strings — preserve leading zeros
  });

  if (result.errors.length > 0) {
    const firstFatal = result.errors.find((e) => e.type === "Delimiter");
    if (firstFatal) {
      throw new Error(`CSV parse error: ${firstFatal.message}`);
    }
    // Non-fatal errors (e.g. extra fields on a row) — log and continue
    console.warn("[parseFile] CSV non-fatal parse warnings:", result.errors);
  }

  return result.data;
}

// ── XLSX ──────────────────────────────────────────────────────────────────────

function parseXlsx(buffer: Buffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("XLSX file contains no sheets.");
  }

  const sheet = workbook.Sheets[sheetName];

  // defval: null → empty cells become null rather than undefined
  const rows = XLSX.utils.sheet_to_json<ParsedRow>(sheet, {
    defval: null,
    raw: false, // format dates and numbers as strings for consistent rawData
  });

  return rows;
}
