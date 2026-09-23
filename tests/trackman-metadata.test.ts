import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  getTrackManImportBatchMetadata,
  parseFileBuffer,
  parseTrackManDate,
} from "@/lib/imports/parseFile";

// ── Test fixture helper ────────────────────────────────────────────────────────
// Builds a workbook shaped exactly like a real TrackMan "Result" sheet export:
// rows 0-6 are group/section/header/flags/units/factor/imperial-units rows,
// row 7+ is shot data. Mirrors TRACKMAN_HEADER_ROW_INDEX / TRACKMAN_DATA_START_INDEX.

const HEADERS = [
  "SessionId",
  "MeasurementId",
  "Date",
  "ShotNo",
  "Player.Id",
  "Player.Name",
  "Player.Email",
  "Club.Type",
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
  "Measurement.SpinRate",
  "MaxHeight.Height",
  "Measurement.Carry",
  "Measurement.Total",
  "Tags",
];

interface ShotRowInput {
  sessionId?: string;
  date?: string;
  shotNo?: string;
  playerId?: string;
  playerName?: string;
  playerEmail?: string;
  clubType?: string;
  clubSpeed?: string;
}

function buildShotRow(input: ShotRowInput): (string | null)[] {
  return [
    input.sessionId ?? "SESSION-1",
    "M-1",
    input.date ?? "9/20/2026",
    input.shotNo ?? "1",
    input.playerId ?? "P-100",
    input.playerName ?? "John Doe",
    input.playerEmail ?? "john@example.com",
    input.clubType ?? "Driver",
    input.clubSpeed ?? "100.0",
    "150.0",
    "2500",
    "30.0",
    "220.0",
    "230.0",
    "",
  ];
}

function buildTrackManBuffer(shotRows: ShotRowInput[]): Buffer {
  const aoa: (string | null)[][] = [
    new Array(HEADERS.length).fill(""), // group row
    new Array(HEADERS.length).fill(""), // section labels
    HEADERS, // real headers
    new Array(HEADERS.length).fill("TRUE"), // visible flags
    new Array(HEADERS.length).fill(""), // SiUnit row
    new Array(HEADERS.length).fill("2.23694"), // factor row
    new Array(HEADERS.length).fill("[mph]"), // imperial units row
    ...shotRows.map(buildShotRow),
  ];

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Result");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── 1. Metadata extraction ──────────────────────────────────────────────────

test("extracts session metadata alongside shot rows", () => {
  const buffer = buildTrackManBuffer([
    { clubType: "Driver" },
    { clubType: "7 Iron" },
  ]);

  const result = parseFileBuffer(buffer, "session.xlsx");

  assert.equal(result.parserMode, "trackman-result");
  assert.equal(result.rows.length, 2);
  assert.equal(result.metadataError, undefined);
  assert.ok(result.metadata);
  assert.equal(result.metadata.sessionId, "SESSION-1");
});

// ── 2. Name/email extraction ────────────────────────────────────────────────

test("preserves player name/email verbatim, trimmed", () => {
  const buffer = buildTrackManBuffer([
    { playerName: "  Jane Smith  ", playerEmail: "  jane.smith@example.com  " },
  ]);

  const { metadata } = parseFileBuffer(buffer, "session.xlsx");

  assert.ok(metadata);
  assert.equal(metadata.playerName, "Jane Smith");
  assert.equal(metadata.playerEmail, "jane.smith@example.com");
});

// ── 3. Deterministic session date parsing ───────────────────────────────────

test("parseTrackManDate parses M/D/YYYY without locale ambiguity", () => {
  const parsed = parseTrackManDate("1/31/2026");
  assert.ok(parsed);
  assert.equal(parsed.toISOString(), "2026-01-31T00:00:00.000Z");
});

test("parseTrackManDate parses M/D/YYYY H:mm:ss", () => {
  const parsed = parseTrackManDate("9/20/2026 14:05:30");
  assert.ok(parsed);
  assert.equal(parsed.toISOString(), "2026-09-20T14:05:30.000Z");
});

test("parseTrackManDate returns null for unrecognized formats", () => {
  assert.equal(parseTrackManDate("not a date"), null);
});

test("session metadata resolves sessionDate deterministically from Date column", () => {
  const buffer = buildTrackManBuffer([
    { date: "9/20/2026 09:00:00" },
    { date: "9/20/2026 09:00:05" },
  ]);

  const { metadata } = parseFileBuffer(buffer, "session.xlsx");

  assert.ok(metadata);
  assert.ok(metadata.sessionDate);
  assert.equal(metadata.sessionDate.toISOString(), "2026-09-20T09:00:00.000Z");
});

// ── 4. Session ID extraction ─────────────────────────────────────────────────

test("extracts a consistent SessionId across shot rows", () => {
  const buffer = buildTrackManBuffer([
    { sessionId: "ABC-123" },
    { sessionId: "ABC-123" },
    { sessionId: "ABC-123" },
  ]);

  const { metadata } = parseFileBuffer(buffer, "session.xlsx");

  assert.ok(metadata);
  assert.equal(metadata.sessionId, "ABC-123");
});

// ── 5. Player ID extraction ──────────────────────────────────────────────────

test("extracts a consistent Player.Id across shot rows", () => {
  const buffer = buildTrackManBuffer([
    { playerId: "PLAYER-42" },
    { playerId: "PLAYER-42" },
  ]);

  const { metadata } = parseFileBuffer(buffer, "session.xlsx");

  assert.ok(metadata);
  assert.equal(metadata.playerId, "PLAYER-42");
});

// ── 6. Inconsistent SessionId ────────────────────────────────────────────────

test("returns a metadata error (not a thrown exception) for inconsistent SessionId, without affecting shot rows", () => {
  const buffer = buildTrackManBuffer([
    { sessionId: "SESSION-A" },
    { sessionId: "SESSION-B" },
  ]);

  const result = parseFileBuffer(buffer, "session.xlsx");

  assert.equal(result.metadata, null);
  assert.match(result.metadataError ?? "", /inconsistent SessionId/);
  // Existing shot-row import behavior must be unaffected by the metadata conflict.
  assert.equal(result.rows.length, 2);
  assert.equal(result.parserMode, "trackman-result");
});

// ── 7. Missing optional player metadata ──────────────────────────────────────

test("tolerates missing player name/email without an error", () => {
  const buffer = buildTrackManBuffer([
    { playerName: "", playerEmail: "" },
    { playerName: "", playerEmail: "" },
  ]);

  const result = parseFileBuffer(buffer, "session.xlsx");

  assert.equal(result.metadataError, undefined);
  assert.ok(result.metadata);
  assert.equal(result.metadata.playerName, null);
  assert.equal(result.metadata.playerEmail, null);
  // SessionId/player ID are still present and consistent.
  assert.equal(result.metadata.sessionId, "SESSION-1");
  assert.equal(result.metadata.playerId, "P-100");
});

// ── 8. ImportBatch persistence mapping ─────────────────────────────────────

test("maps TrackMan metadata to nullable ImportBatch fields", () => {
  const result = parseFileBuffer(
    buildTrackManBuffer([
      {
        sessionId: "SESSION-42",
        playerId: "PLAYER-42",
        playerName: "Max Tucker",
        playerEmail: "max@example.com",
        date: "5/20/2026",
      },
    ]),
    "max-tucker.xlsx",
  );

  assert.deepEqual(getTrackManImportBatchMetadata(result), {
    trackmanSessionId: "SESSION-42",
    trackmanPlayerId: "PLAYER-42",
    trackmanPlayerName: "Max Tucker",
    trackmanPlayerEmail: "max@example.com",
    trackmanSessionDate: new Date("2026-05-20T00:00:00.000Z"),
    trackmanMetadataError: null,
  });
});

test("maps missing TrackMan metadata fields to null", () => {
  const result = parseFileBuffer(
    buildTrackManBuffer([
      {
        sessionId: "",
        playerId: "",
        playerName: "",
        playerEmail: "",
        date: "",
      },
    ]),
    "unknown-player.xlsx",
  );

  assert.deepEqual(getTrackManImportBatchMetadata(result), {
    trackmanSessionId: null,
    trackmanPlayerId: null,
    trackmanPlayerName: null,
    trackmanPlayerEmail: null,
    trackmanSessionDate: null,
    trackmanMetadataError: null,
  });
});

test("maps a TrackMan metadata inconsistency to ImportBatch error fields", () => {
  const result = parseFileBuffer(
    buildTrackManBuffer([{ sessionId: "SESSION-A" }, { sessionId: "SESSION-B" }]),
    "conflict.xlsx",
  );
  const metadata = getTrackManImportBatchMetadata(result);

  assert.equal(metadata?.trackmanSessionId, null);
  assert.match(metadata?.trackmanMetadataError ?? "", /inconsistent SessionId/);
});

test("does not attach TrackMan metadata to generic imports", () => {
  const result = parseFileBuffer(Buffer.from("name,email\nMax,max@example.com\n"), "clients.csv");

  assert.equal(getTrackManImportBatchMetadata(result), undefined);
});
