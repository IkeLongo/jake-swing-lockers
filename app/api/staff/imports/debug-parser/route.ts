import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const PREFERRED_SHEET = "Result";

const TRACKMAN_SIGNATURE_COLS = [
  "Club.Type",
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
];

const TRACKMAN_FIELDS_OF_INTEREST = [
  "Club.Type",
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
  "Measurement.SpinRate",
  "MaxHeight.Height",
  "Measurement.Carry",
  "Measurement.Total",
] as const;

// Confirmed TrackMan "Result" sheet layout (1-based row numbers → 0-based indexes)
//   Row 1 (index 0) — Group row                              IGNORED
//   Row 2 (index 1) — Section labels row                     IGNORED
//   Row 3 (index 2) — column headers                         HEADERS
//   Row 4 (index 3) — Visible flags row                      IGNORED
//   Row 5 (index 4) — SiUnit row                             IGNORED
//   Row 6 (index 5) — Factor row (2.23694 etc.)              IGNORED
//   Row 7 (index 6) — Imperial display units row ([mph] etc.) IGNORED
//   Row 8 (index 7) — first shot data row                    PARSED
const TM_HEADER_ROW_INDEX = 2;
const TM_METRIC_UNIT_ROW_INDEX = 4;   // row 5 — SiUnit row, we note but do not use
const TM_IMPERIAL_UNIT_ROW_INDEX = 6; // row 7 — the unit row we skip
const TM_DATA_START_INDEX = 7;        // row 8+

// Units-row detection (used only for non-TrackMan generic XLSX)
// A row is classified as a unit row if any cell matches one of these strings.
const UNIT_HINTS = ["mph", "rpm", "yd", "ft", "m", "deg", "%", "°"];

// ── Response type ─────────────────────────────────────────────────────────────

export interface DebugParserResult {
  fileName: string;
  sheetNames: string[];
  selectedSheetName: string;
  rowCount: number;
  /** First 25 rows as arrays, each entry includes a 1-based rowNumber */
  rawRows: Array<{ rowNumber: number; cells: (string | null)[] }>;
  detectedHeaderRowIndex: number | null;
  detectedHeaderRowNumber: number | null;
  detectedHeaders: string[];
  detectedUnitRowIndex: number | null;
  detectedUnitRowNumber: number | null;
  detectedUnitValues: (string | null)[];
  detectedDataStartRowIndex: number | null;
  detectedDataStartRowNumber: number | null;
  /** "imperial" when TrackMan Result sheet is detected, null otherwise */
  unitMode: "imperial" | null;
  /** Row number of the metric unit row in TrackMan files (row 5), null for non-TrackMan */
  ignoredMetricUnitRowNumber: number | null;
  fieldColumnIndexes: Record<string, number | null>;
  shotRowPreviews: Record<string, string | null>[];
  /** Which parser path was taken */
  parserMode: "trackman-result-imperial" | "generic" | "csv" | null;
  /** 1-based spreadsheet row number of the first parsed shot row */
  firstParsedRowSpreadsheetNumber: number | null;
  /** Raw cell array for the first parsed shot row (from the array-of-arrays) */
  firstParsedRowRawArray: (string | null)[] | null;
  /** Mapped key→value object for the first parsed shot row */
  firstParsedRowRawData: Record<string, string | null> | null;
  warnings: string[];
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data upload." },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse form data." }, { status: 400 });
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (fileEntry.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).` },
      { status: 413 },
    );
  }

  const fileName = fileEntry.name ?? "unknown";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (!["xlsx", "xls", "csv"].includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type ".${ext}". Upload .xlsx, .xls, or .csv.` },
      { status: 400 },
    );
  }

  const arrayBuffer = await fileEntry.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const result =
      ext === "csv"
        ? debugCsv(buffer, fileName)
        : debugXlsx(buffer, fileName);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse error.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

// ── CSV debug ─────────────────────────────────────────────────────────────────

function debugCsv(buffer: Buffer, fileName: string): DebugParserResult {
  // Re-use SheetJS to parse CSV so we get a consistent array-of-arrays format
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0] ?? "Sheet1";
  const sheet = workbook.Sheets[sheetName];
  const raw = (XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  }) as (string | null)[][]);

  const rowCount = raw.length;
  const rawRows = raw.slice(0, 25).map((cells, i) => ({
    rowNumber: i + 1,
    cells: cells.map((c) => (c !== null && c !== undefined ? String(c) : null)),
  }));

  // For CSV the first row is the header
  const headers = raw[0]?.map((h) => (h !== null && h !== undefined ? String(h).trim() : "")) ?? [];

  return {
    fileName,
    sheetNames: [sheetName],
    selectedSheetName: sheetName,
    rowCount,
    rawRows,
    detectedHeaderRowIndex: 0,
    detectedHeaderRowNumber: 1,
    detectedHeaders: headers,
    detectedUnitRowIndex: null,
    detectedUnitRowNumber: null,
    detectedUnitValues: [],
    detectedDataStartRowIndex: 1,
    detectedDataStartRowNumber: 2,
    fieldColumnIndexes: buildFieldColumnIndexes(headers),
    shotRowPreviews: buildShotPreviews(raw, headers, 1, null, 10),
    unitMode: null,
    ignoredMetricUnitRowNumber: null,
    parserMode: "csv",
    firstParsedRowSpreadsheetNumber: raw.length > 1 ? 2 : null,
    firstParsedRowRawArray: raw[1] ?? null,
    firstParsedRowRawData: raw[1]
      ? buildRowObject(raw[1], headers)
      : null,
    warnings: [],
  };
}

// ── XLSX debug ────────────────────────────────────────────────────────────────

function debugXlsx(buffer: Buffer, fileName: string): DebugParserResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const warnings: string[] = [];

  // Select sheet
  const selectedSheetName = workbook.SheetNames.includes(PREFERRED_SHEET)
    ? PREFERRED_SHEET
    : (workbook.SheetNames[0] ?? "");

  if (!workbook.SheetNames.includes(PREFERRED_SHEET)) {
    warnings.push(
      `Sheet "${PREFERRED_SHEET}" not found. Using first sheet: "${selectedSheetName}".`,
    );
  }

  if (!selectedSheetName) {
    throw new Error("Workbook contains no sheets.");
  }

  const sheet = workbook.Sheets[selectedSheetName];
  const raw = (XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
  }) as (string | null)[][]);

  const rowCount = raw.length;

  // Build raw row preview (first 25 rows, 1-based row numbers)
  const rawRows = raw.slice(0, 25).map((cells, i) => ({
    rowNumber: i + 1,
    cells: cells.map((c) => (c !== null && c !== undefined ? String(c) : null)),
  }));

  // ── Check whether this is a TrackMan "Result" sheet ──────────────────────
  // If the sheet name is "Result" AND row 2 contains our signature columns,
  // use hardcoded layout rather than auto-detection.  This avoids the false
  // positive caused by TrackMan having TWO unit rows (metric row 5, imperial row 7).
  const isTrackManResult =
    selectedSheetName === PREFERRED_SHEET &&
    (() => {
      const cells = raw[TM_HEADER_ROW_INDEX] ?? [];
      const strs = cells.map((c) =>
        c !== null && c !== undefined ? String(c).trim() : "",
      );
      return TRACKMAN_SIGNATURE_COLS.every((col) => strs.includes(col));
    })();

  let detectedHeaderRowIndex: number;
  let detectedHeaders: string[];
  let detectedUnitRowIndex: number | null;
  let detectedUnitValues: (string | null)[];
  let detectedDataStartRowIndex: number | null;
  let unitMode: "imperial" | null;
  let ignoredMetricUnitRowNumber: number | null;

  if (isTrackManResult) {
    // ── TrackMan hardcoded layout ────────────────────────────────────────────
    detectedHeaderRowIndex = TM_HEADER_ROW_INDEX;
    detectedHeaders = (raw[TM_HEADER_ROW_INDEX] ?? []).map((c) =>
      c !== null && c !== undefined ? String(c).trim() : "",
    );
    detectedUnitRowIndex = TM_IMPERIAL_UNIT_ROW_INDEX;
    detectedUnitValues = (raw[TM_IMPERIAL_UNIT_ROW_INDEX] ?? []).map((c) =>
      c !== null && c !== undefined ? String(c) : null,
    );
    detectedDataStartRowIndex = TM_DATA_START_INDEX;
    unitMode = "imperial";
    ignoredMetricUnitRowNumber = TM_METRIC_UNIT_ROW_INDEX + 1; // row 5

    warnings.push(
      `TrackMan Result sheet detected — using hardcoded layout: ` +
        `headers=row ${TM_HEADER_ROW_INDEX + 1}, ` +
        `metric units=row ${TM_METRIC_UNIT_ROW_INDEX + 1} (ignored), ` +
        `imperial units=row ${TM_IMPERIAL_UNIT_ROW_INDEX + 1} (skipped), ` +
        `data starts row ${TM_DATA_START_INDEX + 1}.`,
    );
  } else {
    // ── Generic auto-detection ───────────────────────────────────────────────
    unitMode = null;
    ignoredMetricUnitRowNumber = null;

    // Header: scan first 30 rows for all three signature columns.
    let foundHeaderIndex: number | null = null;
    let foundHeaders: string[] = [];
    const SCAN_LIMIT = Math.min(raw.length, 30);
    for (let i = 0; i < SCAN_LIMIT; i++) {
      const cells = raw[i] ?? [];
      const cellStrings = cells.map((c) =>
        c !== null && c !== undefined ? String(c).trim() : "",
      );
      if (TRACKMAN_SIGNATURE_COLS.every((col) => cellStrings.includes(col))) {
        foundHeaderIndex = i;
        foundHeaders = cellStrings;
        break;
      }
    }
    if (foundHeaderIndex === null) {
      warnings.push(
        `Could not detect a TrackMan-style header row in the first ${SCAN_LIMIT} rows. ` +
          `Falling back to row 1 as headers.`,
      );
      foundHeaderIndex = 0;
      foundHeaders = (raw[0] ?? []).map((c) =>
        c !== null && c !== undefined ? String(c).trim() : "",
      );
    }
    detectedHeaderRowIndex = foundHeaderIndex;
    detectedHeaders = foundHeaders;

    // Unit row: first row after header whose cells contain unit hint strings.
    let foundUnitIndex: number | null = null;
    let foundUnitValues: (string | null)[] = [];
    const unitScanEnd = Math.min(raw.length, detectedHeaderRowIndex + 10);
    for (let i = detectedHeaderRowIndex + 1; i < unitScanEnd; i++) {
      const cells = raw[i] ?? [];
      const lower = cells.map((c) =>
        c !== null && c !== undefined ? String(c).trim().toLowerCase() : "",
      );
      if (UNIT_HINTS.some((hint) => lower.some((v) => v === hint || v.includes(hint)))) {
        foundUnitIndex = i;
        foundUnitValues = (raw[i] ?? []).map((c) =>
          c !== null && c !== undefined ? String(c) : null,
        );
        break;
      }
    }
    if (foundUnitIndex === null) {
      warnings.push(`No units row detected in the rows after the header.`);
    }
    detectedUnitRowIndex = foundUnitIndex;
    detectedUnitValues = foundUnitValues;

    // Data start: first row after the unit row (or header+1) with a numeric value.
    const candidateStart =
      detectedUnitRowIndex !== null
        ? detectedUnitRowIndex + 1
        : detectedHeaderRowIndex + 1;
    const tmpFieldIndexes = buildFieldColumnIndexes(detectedHeaders);
    const numericCols = TRACKMAN_FIELDS_OF_INTEREST.slice(1)
      .map((f) => tmpFieldIndexes[f])
      .filter((idx): idx is number => idx !== null);
    let foundDataStart: number | null = null;
    for (let i = candidateStart; i < raw.length; i++) {
      const cells = raw[i] ?? [];
      if (
        numericCols.some((colIdx) => {
          const val = cells[colIdx];
          return val !== null && val !== undefined && !isNaN(parseFloat(String(val)));
        })
      ) {
        foundDataStart = i;
        break;
      }
    }
    if (foundDataStart === null) {
      warnings.push(`Could not detect a data start row with numeric measurement values.`);
    }
    detectedDataStartRowIndex = foundDataStart;
  }

  // ── Field indexes, shot previews, and first-row diagnostics ─────────────
  const fieldIndexes = buildFieldColumnIndexes(detectedHeaders);

  const shotRowPreviews =
    detectedDataStartRowIndex !== null
      ? buildShotPreviews(
          raw,
          detectedHeaders,
          detectedDataStartRowIndex,
          detectedUnitRowIndex,
          10,
        )
      : [];

  // First parsed row metadata — helps verify the correct row is being used.
  const firstParsedRowIndex = detectedDataStartRowIndex;
  const firstParsedRowRawArray =
    firstParsedRowIndex !== null ? (raw[firstParsedRowIndex] ?? null) : null;
  const firstParsedRowRawData =
    firstParsedRowRawArray !== null
      ? buildRowObject(firstParsedRowRawArray, detectedHeaders)
      : null;

  // Dev-only: warn if first parsed row looks like a unit or conversion row.
  if (process.env.NODE_ENV !== "production" && firstParsedRowRawData !== null) {
    const UNIT_PATTERN = /^(mph|rpm|yrd|yd|ft|m|deg|[°%])$/i;
    const CONVERSION_FACTORS = new Set(["2.23694", "3.28084", "1.09361", "0.621371"]);
    const vals = Object.values(firstParsedRowRawData).filter(
      (v): v is string => typeof v === "string",
    );
    if (
      vals.some((v) => UNIT_PATTERN.test(v)) ||
      vals.some((v) => CONVERSION_FACTORS.has(v))
    ) {
      warnings.push(
        `DEV WARNING: First parsed row (index ${firstParsedRowIndex}, spreadsheet row ${(firstParsedRowIndex ?? 0) + 1}) looks like a unit/conversion row. ` +
          `Check TRACKMAN_DATA_START_INDEX or the file structure.`,
      );
    }

    if (isTrackManResult) {
      // Assert: data must start from spreadsheet row 8.
      if (firstParsedRowIndex !== null && firstParsedRowIndex + 1 !== 8) {
        warnings.push(
          `DEV ASSERTION FAILED: firstParsedRowSpreadsheetRow should be 8, got ${firstParsedRowIndex + 1}. ` +
            `Check TM_DATA_START_INDEX.`,
        );
      }
      // Assert: Measurement.ClubSpeed must not be a factor or unit row value.
      const clubSpeed = firstParsedRowRawData["Measurement.ClubSpeed"];
      if (clubSpeed === "2.23694") {
        warnings.push(
          `DEV ASSERTION FAILED: Measurement.ClubSpeed === "2.23694" — factor row is being included as shot data.`,
        );
      }
      if (typeof clubSpeed === "string" && clubSpeed.includes("[mph]")) {
        warnings.push(
          `DEV ASSERTION FAILED: Measurement.ClubSpeed === "[mph]" — imperial unit row is being included as shot data.`,
        );
      }
    }
  }

  return {
    fileName,
    sheetNames: workbook.SheetNames,
    selectedSheetName,
    rowCount,
    rawRows,
    detectedHeaderRowIndex,
    detectedHeaderRowNumber: detectedHeaderRowIndex + 1,
    detectedHeaders,
    detectedUnitRowIndex,
    detectedUnitRowNumber:
      detectedUnitRowIndex !== null ? detectedUnitRowIndex + 1 : null,
    detectedUnitValues,
    detectedDataStartRowIndex,
    detectedDataStartRowNumber:
      detectedDataStartRowIndex !== null ? detectedDataStartRowIndex + 1 : null,
    unitMode,
    ignoredMetricUnitRowNumber,
    fieldColumnIndexes: fieldIndexes,
    shotRowPreviews,
    parserMode: isTrackManResult ? "trackman-result-imperial" : "generic",
    firstParsedRowSpreadsheetNumber:
      firstParsedRowIndex !== null ? firstParsedRowIndex + 1 : null,
    firstParsedRowRawArray,
    firstParsedRowRawData,
    warnings,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFieldColumnIndexes(
  headers: string[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const field of TRACKMAN_FIELDS_OF_INTEREST) {
    const idx = headers.indexOf(field);
    result[field] = idx >= 0 ? idx : null;
  }
  return result;
}

/** Map a raw cell array onto a header→value object (fields-of-interest only when narrow=true). */
function buildRowObject(
  cells: (string | null)[],
  headers: string[],
): Record<string, string | null> {
  const row: Record<string, string | null> = {};
  for (let col = 0; col < headers.length; col++) {
    const header = headers[col];
    if (!header) continue;
    const val = cells[col];
    const strVal = val !== null && val !== undefined ? String(val).trim() : null;
    row[header] = strVal === "" ? null : strVal;
  }
  return row;
}

function buildShotPreviews(
  raw: (string | null)[][],
  headers: string[],
  dataStartIndex: number,
  unitRowIndex: number | null,
  limit: number,
): Record<string, string | null>[] {
  const results: Record<string, string | null>[] = [];

  for (let i = dataStartIndex; i < raw.length && results.length < limit; i++) {
    if (i === unitRowIndex) continue;

    const cells = raw[i] ?? [];
    let hasValue = false;
    const row: Record<string, string | null> = {};

    for (let col = 0; col < headers.length; col++) {
      const header = headers[col];
      if (!header) continue;
      const val = cells[col];
      const strVal =
        val !== null && val !== undefined ? String(val).trim() : null;
      row[header] = strVal === "" ? null : strVal;
      if (strVal) hasValue = true;
    }

    if (!hasValue) continue;
    results.push(row);
  }

  return results;
}
