import Papa from "papaparse";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single parsed row: column name → raw value (string, number, null, etc.) */
export type ParsedRow = Record<string, unknown>;

/** Parser mode stored on ImportBatch to drive downstream UI decisions. */
export type ParserMode = "trackman-result" | "generic";

/** Result returned by parseFileBuffer. */
export interface ParseResult {
  rows: ParsedRow[];
  parserMode: ParserMode;
}

// ── TrackMan constants ────────────────────────────────────────────────────────

/**
 * Confirmed TrackMan "Result" sheet layout (spreadsheet rows are 1-based;
 * SheetJS array indexes are 0-based):
 *
 *   Spreadsheet row 1  (index 0) — Group row                     IGNORED
 *   Spreadsheet row 2  (index 1) — Section labels row            IGNORED
 *   Spreadsheet row 3  (index 2) — real column headers            HEADERS
 *   Spreadsheet row 4  (index 3) — Visible flags row             IGNORED
 *   Spreadsheet row 5  (index 4) — SiUnit row                    IGNORED
 *   Spreadsheet row 6  (index 5) — Factor row (2.23694 etc.)     IGNORED
 *   Spreadsheet row 7  (index 6) — Imperial display units row    IGNORED
 *   Spreadsheet row 8+ (index 7+) — actual shot data              PARSED
 *
 * We hardcode these positions rather than auto-detecting to avoid confusion
 * caused by TrackMan having multiple unit/metadata rows.
 *
 * TODO: Club-level aggregation of these shot rows will be added after
 *       this parser is verified against real TrackMan exports.
 */
const TRACKMAN_SHEET_NAME = "Result";
const TRACKMAN_HEADER_ROW_INDEX = 2;        // spreadsheet row 3 — real machine-readable column headers
const TRACKMAN_IMPERIAL_UNIT_ROW_INDEX = 6; // spreadsheet row 7 — skip
const TRACKMAN_DATA_START_INDEX = 7;        // spreadsheet row 8 — first real shot

/** Subset of known TrackMan column names used to confirm the sheet layout. */
const TRACKMAN_SIGNATURE_COLS = [
  "Club.Type",
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
];

/**
 * The only fields we store in rawData for a TrackMan shot row.
 * All other columns are dropped to keep the payload lean.
 */
const TRACKMAN_FIELDS_OF_INTEREST = new Set([
  "Club.Type",
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
  "Measurement.SpinRate",
  "MaxHeight.Height",
  "Measurement.Carry",
  "Measurement.Total",
]);

// Strings that indicate a row is a unit/conversion row, not a shot row.
// Used only for dev-mode assertion.
const UNIT_VALUE_PATTERN = /^(mph|rpm|yrd|yd|ft|m|deg|[°%])$/i;
const CONVERSION_FACTORS = new Set([
  "2.23694",
  "3.28084",
  "1.09361",
  "0.621371",
  "1.60934",
]);

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Parse a CSV or XLSX file buffer into an array of row objects.
 *
 * - .csv        → parsed with papaparse (header row required)
 * - .xlsx / .xls
 *     → if the workbook contains a sheet named "Result" whose row 2 carries
 *       TrackMan-style column headers, parsed with TrackMan-specific logic
 *       (headers from row 2, data from row 8 onward — rows 1–7 are skipped).
 *     → otherwise, the first sheet is parsed generically.
 *
 * Returns a ParseResult containing the rows and the detected parserMode.
 */
export function parseFileBuffer(buffer: Buffer, fileName: string): ParseResult {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "csv") {
    return { rows: parseCsv(buffer), parserMode: "generic" };
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

function parseXlsx(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  // Prefer TrackMan-specific parsing when the workbook layout matches.
  if (workbook.SheetNames.includes(TRACKMAN_SHEET_NAME)) {
    const sheet = workbook.Sheets[TRACKMAN_SHEET_NAME];

    // Read as array-of-arrays with raw: false (all values as strings) and
    // defval: null (empty cells become null rather than undefined/empty string).
    const raw = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
    });

    // Confirm row 2 (index 1) carries the expected TrackMan headers.
    const headerRow = raw[TRACKMAN_HEADER_ROW_INDEX] ?? [];
    const headerStrings = headerRow.map((h) => (h !== null ? String(h).trim() : ""));
    const isTrackMan = TRACKMAN_SIGNATURE_COLS.every((col) =>
      headerStrings.includes(col),
    );

    if (isTrackMan) {
      console.log(
        `[parseFile] TrackMan export detected — ` +
          `headers=row ${TRACKMAN_HEADER_ROW_INDEX + 1}, ` +
          `imperial units=row ${TRACKMAN_IMPERIAL_UNIT_ROW_INDEX + 1} (skipped), ` +
          `data starts row ${TRACKMAN_DATA_START_INDEX + 1}`,
      );
      return { rows: parseTrackManSheet(raw, headerStrings), parserMode: "trackman-result" };
    }

    console.warn(
      `[parseFile] Sheet "${TRACKMAN_SHEET_NAME}" found but TrackMan signature columns not detected in row ${TRACKMAN_HEADER_ROW_INDEX + 1}. Falling back to generic XLSX parsing.`,
    );
  }

  // ── Generic XLSX fallback ─────────────────────────────────────────────────
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("XLSX file contains no sheets.");
  }

  const sheet = workbook.Sheets[sheetName];

  // defval: null → empty cells become null rather than undefined
  const rows = XLSX.utils.sheet_to_json<ParsedRow>(sheet, {
    defval: null,
    raw: false, // format all values as strings for consistent rawData
  });

  return { rows, parserMode: "generic" };
}

// ── TrackMan sheet parser ─────────────────────────────────────────────────────

/**
 * Parse the "Result" sheet from a TrackMan XLSX export.
 *
 * Uses ONLY rows from TRACKMAN_DATA_START_INDEX (index 7, spreadsheet row 8)
 * onward.  Rows 0–6 (spreadsheet rows 1–7) — including the header row,
 * metric unit row, imperial unit row, and all metadata rows — are NEVER
 * processed as shot data.
 *
 * Each returned object maps header string → cell value (string | null).
 * Only fields listed in TRACKMAN_FIELDS_OF_INTEREST are stored; all other
 * columns (units, group labels, metadata, etc.) are dropped.
 * Columns with a blank header are omitted.
 * Completely empty rows are omitted.
 */
function parseTrackManSheet(
  raw: (string | null)[][],
  headers: string[],
): ParsedRow[] {
  // Explicitly slice from DATA_START_INDEX.
  // This is the authoritative guarantee that rows 0–6 are never processed.
  const dataRows = raw.slice(TRACKMAN_DATA_START_INDEX);

  const results: ParsedRow[] = [];

  for (const rowArr of dataRows) {
    const rowObj: ParsedRow = {};
    let hasValue = false;

    for (let col = 0; col < headers.length; col++) {
      const header = headers[col];
      // Skip blank headers and columns not in the fields-of-interest list.
      if (!header || !TRACKMAN_FIELDS_OF_INTEREST.has(header)) continue;

      const cellVal = rowArr[col] ?? null;
      const strVal =
        cellVal !== null ? String(cellVal).trim() : null;

      rowObj[header] = strVal === "" ? null : strVal;
      if (strVal && strVal !== "") hasValue = true;
    }

    // Skip rows that are entirely empty.
    if (!hasValue) continue;

    results.push(rowObj);
  }

  // ── Dev-mode assertions ───────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production" && results.length > 0) {
    const firstRow = results[0];
    const firstValues = Object.values(firstRow).filter(
      (v): v is string => typeof v === "string",
    );
    const hasUnitLabel = firstValues.some((v) => UNIT_VALUE_PATTERN.test(v));
    const hasConversionFactor = firstValues.some((v) =>
      CONVERSION_FACTORS.has(v),
    );

    // Assert: data must start from spreadsheet row 8.
    if (TRACKMAN_DATA_START_INDEX + 1 !== 8) {
      console.error(
        `[parseTrackManSheet] ASSERTION FAILED: firstParsedRowSpreadsheetRow should be 8, ` +
          `got ${TRACKMAN_DATA_START_INDEX + 1}. Check TRACKMAN_DATA_START_INDEX.`,
      );
    }

    // Assert: Measurement.ClubSpeed must not be a factor row or unit row value.
    const clubSpeed = firstRow["Measurement.ClubSpeed"];
    if (clubSpeed === "2.23694") {
      console.error(
        "[parseTrackManSheet] ASSERTION FAILED: Measurement.ClubSpeed === '2.23694' — " +
          "factor row is being parsed as shot data.",
        { firstRow },
      );
    }
    if (typeof clubSpeed === "string" && clubSpeed.includes("[mph]")) {
      console.error(
        "[parseTrackManSheet] ASSERTION FAILED: Measurement.ClubSpeed === '[mph]' — " +
          "imperial unit row is being parsed as shot data.",
        { firstRow },
      );
    }

    if (hasUnitLabel || hasConversionFactor) {
      console.warn(
        "[parseTrackManSheet] WARNING: First parsed row looks like a unit/conversion row!" +
          " Expected spreadsheet row " +
          (TRACKMAN_DATA_START_INDEX + 1) +
          ". Check TRACKMAN_DATA_START_INDEX.",
        { firstRow },
      );
    } else {
      console.log(
        `[parseTrackManSheet] First parsed row is from spreadsheet row ${TRACKMAN_DATA_START_INDEX + 1} — looks like shot data.`,
        { firstRow },
      );
    }
  }

  return results;
}

