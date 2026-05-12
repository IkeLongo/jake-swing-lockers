"use client";

import { useRef, useState } from "react";
import type { DebugParserResult } from "@/app/api/staff/imports/debug-parser/route";

const FIELDS_OF_INTEREST = [
  "Club.Type",
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
  "Measurement.SpinRate",
  "MaxHeight.Height",
  "Measurement.Carry",
  "Measurement.Total",
] as const;

export function ParserDebugForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebugParserResult | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please select a file.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    try {
      const res = await fetch("/api/staff/imports/debug-parser", {
        method: "POST",
        body: formData,
      });
      const json = (await res.json()) as DebugParserResult & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `Server error (${res.status})`);
      } else {
        setResult(json);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Upload form ──────────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs"
      >
        <h2 className="mb-4 text-base font-bold text-slate-800 font-heading">
          Upload file for inspection
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="debug-file"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 font-body"
            >
              CSV, XLSX, or XLS
            </label>
            <input
              ref={fileInputRef}
              id="debug-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100 font-body"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors font-body"
          >
            {loading ? "Parsing…" : "Parse file"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 font-body">
            {error}
          </p>
        )}
      </form>

      {result && (
        <>
          {/* ── Warnings ─────────────────────────────────────────────────── */}
          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-5 py-4">
              <p className="mb-2 text-sm font-semibold text-yellow-800 font-subheading">
                Warnings
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-yellow-700 font-body">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Summary cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="File" value={result.fileName} mono />
            <SummaryCard
              label="Sheet used"
              value={result.selectedSheetName}
              mono
            />
            <SummaryCard
              label="All sheets"
              value={result.sheetNames.join(", ")}
              mono
            />
            <SummaryCard
              label="Total rows"
              value={result.rowCount.toString()}
            />
            <SummaryCard
              label="Parser mode"
              value={result.parserMode ?? "unknown"}
              accent={result.parserMode === "trackman-result-imperial" ? "emerald" : "slate"}
            />
            <SummaryCard
              label="Header row"
              value={
                result.detectedHeaderRowNumber !== null
                  ? `Row ${result.detectedHeaderRowNumber}`
                  : "Not detected"
              }
              accent={result.detectedHeaderRowNumber !== null ? "blue" : "red"}
            />
            <SummaryCard
              label="Units row"
              value={
                result.detectedUnitRowNumber !== null
                  ? `Row ${result.detectedUnitRowNumber}`
                  : "Not detected"
              }
              accent={result.detectedUnitRowNumber !== null ? "yellow" : "slate"}
            />
            <SummaryCard
              label="Data starts"
              value={
                result.detectedDataStartRowNumber !== null
                  ? `Row ${result.detectedDataStartRowNumber}`
                  : "Not detected"
              }
              accent={
                result.detectedDataStartRowNumber !== null ? "emerald" : "red"
              }
            />
            <SummaryCard
              label="First parsed row"
              value={
                result.firstParsedRowSpreadsheetNumber !== null
                  ? `Row ${result.firstParsedRowSpreadsheetNumber}`
                  : "None"
              }
              accent={
                result.firstParsedRowSpreadsheetNumber === 8
                  ? "emerald"
                  : result.firstParsedRowSpreadsheetNumber !== null
                    ? "red"
                    : "slate"
              }
            />
            <SummaryCard
              label="Unit mode"
              value={result.unitMode ?? "generic"}
              accent={result.unitMode === "imperial" ? "emerald" : "slate"}
            />
            {result.ignoredMetricUnitRowNumber !== null && (
              <SummaryCard
                label="Metric row (ignored)"
                value={`Row ${result.ignoredMetricUnitRowNumber}`}
                accent="slate"
              />
            )}
          </div>

          {/* ── Field column indexes ──────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-800 font-heading">
                Fields of interest — column positions
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm font-body">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Field</th>
                    <th className="px-4 py-2.5 text-left">Column index</th>
                    <th className="px-4 py-2.5 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {FIELDS_OF_INTEREST.map((field) => {
                    const idx = result.fieldColumnIndexes[field];
                    return (
                      <tr key={field}>
                        <td className="px-4 py-2 font-mono text-slate-700 text-xs">
                          {field}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-slate-600">
                          {idx !== null ? idx : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {idx !== null ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Found
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                              Missing
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Detected headers ─────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-800 font-heading">
                Detected headers ({result.detectedHeaders.length})
              </h2>
            </div>
            <div className="flex flex-wrap gap-1.5 px-5 py-4">
              {result.detectedHeaders.map((h, i) =>
                h ? (
                  <span
                    key={i}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700"
                  >
                    [{i}] {h}
                  </span>
                ) : null,
              )}
            </div>
          </section>

          {/* ── First 25 raw rows ─────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-800 font-heading">
                First 25 raw rows
              </h2>
              <p className="mt-0.5 text-xs text-slate-400 font-body">
                <span className="inline-block rounded-sm bg-blue-100 px-1 text-blue-700">
                  blue
                </span>{" "}
                = header row&nbsp;&nbsp;
                <span className="inline-block rounded-sm bg-yellow-100 px-1 text-yellow-700">
                  yellow
                </span>{" "}
                = imperial units row (skipped)&nbsp;&nbsp;
                <span className="inline-block rounded-sm bg-orange-100 px-1 text-orange-700">
                  orange
                </span>{" "}
                = metric units row (ignored)&nbsp;&nbsp;
                <span className="inline-block rounded-sm bg-emerald-100 px-1 text-emerald-700">
                  green
                </span>{" "}
                = first data row
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs font-mono">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left">
                      Row #
                    </th>
                    <th className="px-3 py-2 text-left">Cell values (first 20 columns)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.rawRows.map(({ rowNumber, cells }) => {
                    const rowIndex = rowNumber - 1;
                    const isHeader =
                      rowIndex === result.detectedHeaderRowIndex;
                    const isUnit =
                      rowIndex === result.detectedUnitRowIndex;
                    const isMetricUnit =
                      result.ignoredMetricUnitRowNumber !== null &&
                      rowIndex === result.ignoredMetricUnitRowNumber - 1;
                    const isDataStart =
                      rowIndex === result.detectedDataStartRowIndex;

                    const rowClass = isHeader
                      ? "bg-blue-50"
                      : isUnit
                        ? "bg-yellow-50"
                        : isMetricUnit
                          ? "bg-orange-50"
                          : isDataStart
                            ? "bg-emerald-50"
                            : "";

                    const labelClass = isHeader
                      ? "bg-blue-100 text-blue-700"
                      : isUnit
                        ? "bg-yellow-100 text-yellow-700"
                        : isMetricUnit
                          ? "bg-orange-100 text-orange-700"
                          : isDataStart
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500";

                    return (
                      <tr key={rowNumber} className={rowClass}>
                        <td
                          className={`sticky left-0 px-3 py-1.5 font-semibold ${labelClass}`}
                        >
                          {rowNumber}
                          {isHeader && " (hdr)"}
                          {isUnit && " (units/imp)"}
                          {isMetricUnit && " (units/met)"}
                          {isDataStart && " (data)"}
                        </td>
                        <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                          {cells
                            .slice(0, 20)
                            .map((v, i) => (
                              <span
                                key={i}
                                className="mr-2 inline-block max-w-[120px] truncate align-middle text-xs"
                                title={v ?? "null"}
                              >
                                {v ?? <span className="text-slate-300">∅</span>}
                              </span>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Shot row previews ─────────────────────────────────────────── */}
          {result.shotRowPreviews.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-bold text-slate-800 font-heading">
                  Parsed shot row previews (first {result.shotRowPreviews.length})
                </h2>
                <p className="mt-0.5 text-xs text-slate-400 font-body">
                  Only fields of interest shown.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs font-body">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      {FIELDS_OF_INTEREST.map((f) => (
                        <th key={f} className="px-3 py-2 text-left font-mono">
                          {f}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.shotRowPreviews.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-400 tabular-nums">
                          {i + 1}
                        </td>
                        {FIELDS_OF_INTEREST.map((f) => (
                          <td
                            key={f}
                            className={`px-3 py-1.5 tabular-nums ${
                              row[f] ? "text-slate-700" : "text-slate-300"
                            }`}
                          >
                            {row[f] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {result.shotRowPreviews.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-10 text-center">
              <p className="text-sm font-semibold text-slate-500 font-subheading">
                No shot row previews
              </p>
              <p className="mt-1 text-xs text-slate-400 font-body">
                Check the warnings above — data start row may not have been detected.
              </p>
            </div>
          )}

          {/* ── First parsed row detail ───────────────────────────────── */}
          {result.firstParsedRowRawData && (
            <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-bold text-slate-800 font-heading">
                  First parsed row{" "}
                  {result.firstParsedRowSpreadsheetNumber !== null && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        result.firstParsedRowSpreadsheetNumber === 8
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-600"
                      }`}
                    >
                      spreadsheet row {result.firstParsedRowSpreadsheetNumber}
                      {result.firstParsedRowSpreadsheetNumber !== 8 && " ⚠ expected row 8"}
                    </span>
                  )}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400 font-body">
                  All columns of interest shown. Values should be numeric for a
                  real shot row, not unit labels like mph or rpm.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs font-body">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Field</th>
                      <th className="px-3 py-2 text-left">Value</th>
                      <th className="px-3 py-2 text-left">Looks like</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {FIELDS_OF_INTEREST.map((f) => {
                      const val = result.firstParsedRowRawData?.[f] ?? null;
                      const isNumeric =
                        val !== null && !isNaN(parseFloat(val));
                      const isUnitLabel =
                        val !== null &&
                        /^(mph|rpm|yrd|yd|ft|m|deg|[°%])$/i.test(val);
                      return (
                        <tr key={f}>
                          <td className="px-3 py-1.5 font-mono text-slate-600">
                            {f}
                          </td>
                          <td
                            className={`px-3 py-1.5 tabular-nums font-mono ${
                              val ? "text-slate-800" : "text-slate-300"
                            }`}
                          >
                            {val ?? "—"}
                          </td>
                          <td className="px-3 py-1.5">
                            {isUnitLabel ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                                Unit label ⚠
                              </span>
                            ) : isNumeric ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                Numeric ✓
                              </span>
                            ) : val === null ? (
                              <span className="text-slate-300 text-xs">null</span>
                            ) : (
                              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                                Text
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Raw JSON dump ─────────────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-800 font-heading">
                Full JSON response
              </h2>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs text-slate-600 leading-relaxed">
              {JSON.stringify(result, null, 2)}
            </pre>
          </section>
        </>
      )}
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  mono = false,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: "blue" | "yellow" | "emerald" | "red" | "slate";
}) {
  const bg =
    accent === "blue"
      ? "bg-blue-50 border-blue-200"
      : accent === "yellow"
        ? "bg-yellow-50 border-yellow-200"
        : accent === "emerald"
          ? "bg-emerald-50 border-emerald-200"
          : accent === "red"
            ? "bg-red-50 border-red-200"
            : "bg-white border-slate-200";

  return (
    <div className={`rounded-xl border px-4 py-3 shadow-xs ${bg}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 font-body">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate text-sm font-bold text-slate-800 ${mono ? "font-mono" : "font-heading"}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
