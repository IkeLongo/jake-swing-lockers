"use client";

import { useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { FittingVisualizationData } from "@/lib/imports/fittingVisualizationData";
import { ClubFlightVisualization } from "@/app/_components/visualizations/ClubFlightVisualization";
import { DispersionChart } from "@/app/_components/visualizations/DispersionChart";
import { GappingChart } from "./GappingChart";
import { buildGappingRows } from "./reviewFittingGapping";
import { buildDispersionPoints } from "./reviewFittingDispersion";
import type { SerializedClubSummary } from "./clubSummaryTypes";
import {
  buildFittingFlightModel,
  buildFittingClubLegend,
  formatClubResultMetric,
  normalizeClubFilterSelection,
  toggleClubFilterSelection,
  type ClubFilterSelection,
  type ClubResultSummary,
} from "./reviewFittingDashboardState";

type SaleClubSummary = ClubResultSummary & Pick<SerializedClubSummary, "availableForPurchase">;

interface ReviewFittingDashboardProps {
  summaries: readonly SaleClubSummary[];
  colorsBySummaryId: ReadonlyMap<number, string>;
  onOpenSummary: (summaryId: number, trigger: HTMLElement) => void;
  onToggleInclude?: (summaryId: number, currentlyIncluded: boolean) => void;
  onToggleSale?: (summaryId: number, availableForPurchase: boolean) => void;
  toggling?: ReadonlySet<number>;
  visualizationData: FittingVisualizationData | null;
  visualizationLoading: boolean;
  visualizationError: string | null;
  onRetryVisualizationData: () => void;
}

export function ReviewFittingDashboard({
  summaries,
  colorsBySummaryId,
  onOpenSummary,
  onToggleInclude,
  onToggleSale,
  toggling,
  visualizationData,
  visualizationLoading,
  visualizationError,
  onRetryVisualizationData,
}: ReviewFittingDashboardProps) {
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [selectedSummaryIds, setSelectedSummaryIds] =
    useState<ClubFilterSelection>(null);
  const summaryIds = useMemo(
    () => summaries.map((summary) => summary.id),
    [summaries],
  );
  const normalizedSelection = useMemo(
    () => normalizeClubFilterSelection(selectedSummaryIds, summaryIds),
    [selectedSummaryIds, summaryIds],
  );
  const namesBySummaryId = useMemo(
    () => new Map(summaries.map((summary) => [summary.id, clubLabel(summary, summaries)])),
    [summaries],
  );
  const clubOptions = useMemo(
    () => ({ colorsBySummaryId, namesBySummaryId }),
    [colorsBySummaryId, namesBySummaryId],
  );
  const selectedFlightData = useMemo(
    () =>
      buildFittingFlightModel(
        visualizationData?.shots ?? [],
        normalizedSelection,
      ),
    [normalizedSelection, visualizationData],
  );
  const dispersion = useMemo(
    () => buildDispersionPoints(visualizationData?.shots ?? [], normalizedSelection),
    [normalizedSelection, visualizationData],
  );
  const gapping = useMemo(
    () => buildGappingRows(visualizationData?.shots ?? [], normalizedSelection),
    [normalizedSelection, visualizationData],
  );
  const clubLegend = useMemo(() => {
    return buildFittingClubLegend(
      selectedFlightData.flights,
      summaries,
      colorsBySummaryId,
      namesBySummaryId,
    );
  }, [
    colorsBySummaryId,
    selectedFlightData.flights,
    namesBySummaryId,
    summaries,
  ]);
  const handleClubFilterChange = (summaryId: number | null) => {
    setSelectedSummaryIds((current) =>
      toggleClubFilterSelection(current, summaryIds, summaryId),
    );
  };
  const handleShotSelectionChange = (shotId: string | null) => {
    setSelectedShotId(shotId);
  };
  const dataState = visualizationLoading ? (
    <p
      className="flex min-h-64 flex-1 items-center justify-center text-sm text-muted-foreground"
      role="status"
    >
      Loading fitting shots…
    </p>
  ) : visualizationError ? (
    <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground" role="alert">
        {visualizationError}
      </p>
      <button
        type="button"
        onClick={onRetryVisualizationData}
        className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Retry
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      <ClubFilter
        summaries={summaries}
        selectedSummaryIds={normalizedSelection}
        colorsBySummaryId={colorsBySummaryId}
        onSelectionChange={handleClubFilterChange}
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <VisualizationPanel
          title="Dispersion"
          description="Where the shots finished."
          className="min-h-56"
        >
          {dataState ?? (
            <DispersionChart
              points={dispersion.points}
              includedShotCount={dispersion.includedShotCount}
              colorsBySummaryId={colorsBySummaryId}
              namesBySummaryId={namesBySummaryId}
            />
          )}
        </VisualizationPanel>
        <VisualizationPanel
          title="Shot Analyzer"
          description="How the shots flew."
          featured
          className="min-h-[25rem]"
        >
          {dataState ?? (
            <ClubFlightVisualization
              flights={selectedFlightData.flights}
              includedShotCount={selectedFlightData.shots.length}
              selectedShotId={selectedShotId}
              onSelectedShotChange={handleShotSelectionChange}
              embedded
              showSelectedFlightDetail={false}
              clubOptions={clubOptions}
              clubLegend={clubLegend}
            />
          )}
        </VisualizationPanel>
        <VisualizationPanel
          title="Gapping"
          description="Distance separation between clubs."
          className="min-h-52 xl:col-span-2"
        >
          {dataState ?? (
            <GappingChart
              rows={gapping.rows}
              includedShotCount={gapping.includedShotCount}
              colorsBySummaryId={colorsBySummaryId}
              namesBySummaryId={namesBySummaryId}
            />
          )}
        </VisualizationPanel>
      </div>

      <ClubResults
        summaries={summaries}
        selectedSummaryIds={normalizedSelection}
        onOpenSummary={onOpenSummary}
        onToggleInclude={onToggleInclude}
        onToggleSale={onToggleSale}
        toggling={toggling}
      />
    </div>
  );
}

function ClubFilter({
  summaries,
  selectedSummaryIds,
  colorsBySummaryId,
  onSelectionChange,
}: {
  summaries: readonly ClubResultSummary[];
  selectedSummaryIds: ClubFilterSelection;
  colorsBySummaryId: ReadonlyMap<number, string>;
  onSelectionChange: (summaryId: number | null) => void;
}) {
  const clubNameCounts = new Map<string, number>();
  for (const summary of summaries) {
    clubNameCounts.set(
      summary.clubName,
      (clubNameCounts.get(summary.clubName) ?? 0) + 1,
    );
  }

  return (
    <section aria-label="Dashboard club filter" className="min-w-0">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Clubs
      </p>
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          aria-pressed={selectedSummaryIds === null}
          onClick={() => onSelectionChange(null)}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            selectedSummaryIds === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          All Clubs
        </button>
        {summaries.map((summary) => (
          <button
            key={summary.id}
            type="button"
            aria-pressed={selectedSummaryIds?.has(summary.id) ?? false}
            onClick={() => onSelectionChange(summary.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              selectedSummaryIds?.has(summary.id)
                ? "bg-muted text-foreground shadow-sm"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            style={
              selectedSummaryIds?.has(summary.id)
                ? { borderColor: colorsBySummaryId.get(summary.id) }
                : undefined
            }
          >
            <span className="flex max-w-56 items-center gap-1.5 truncate">
              {selectedSummaryIds?.has(summary.id) && (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorsBySummaryId.get(summary.id) }}
                />
              )}
              {clubLabel(summary, summaries, clubNameCounts)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function VisualizationPanel({
  title,
  description,
  detail,
  dataLabel,
  featured = false,
  className,
  children,
}: {
  title: string;
  description: string;
  detail?: string;
  dataLabel?: string;
  featured?: boolean;
  className: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card ${
        featured ? "border-primary/20 shadow-sm" : ""
      } ${className}`}
    >
      <header className="px-4 pb-3 pt-4 sm:px-5">
        <h2
          className={`font-subheading font-semibold text-foreground ${
            featured ? "text-base" : "text-sm"
          }`}
        >
          {title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </header>
      <div
        className={`flex min-h-0 flex-1 border-t border-border/70 ${
          children
            ? "min-w-0 p-3 sm:p-4"
            : "items-center justify-center bg-muted/20 px-4 py-5 text-center"
        } ${
          featured ? "min-h-44" : "min-h-32"
        }`}
        style={children ? undefined : {
            backgroundImage:
              "linear-gradient(to right, color-mix(in srgb, var(--border) 35%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 35%, transparent) 1px, transparent 1px)",
            backgroundSize: "52px 52px",
          }}
      >
        {children ?? (
          <div className="flex flex-col items-center gap-2">
            {dataLabel && (
              <span className="rounded-full border border-border bg-card/90 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {dataLabel}
              </span>
            )}
            {detail && (
              <p
                className={`font-medium ${
                  featured
                    ? "text-sm text-foreground"
                    : "text-xs text-muted-foreground"
                }`}
              >
                {detail}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ClubResults({
  summaries,
  selectedSummaryIds,
  onOpenSummary,
  onToggleInclude,
  onToggleSale,
  toggling,
}: {
  summaries: readonly SaleClubSummary[];
  selectedSummaryIds: ClubFilterSelection;
  onOpenSummary: (summaryId: number, trigger: HTMLElement) => void;
  onToggleInclude?: (summaryId: number, currentlyIncluded: boolean) => void;
  onToggleSale?: (summaryId: number, availableForPurchase: boolean) => void;
  toggling?: ReadonlySet<number>;
}) {
  return (
    <section aria-labelledby="club-results-heading" className="min-w-0">
      <div className="mb-3">
        <h2
          id="club-results-heading"
          className="font-heading text-base font-bold text-foreground"
        >
          Club Results
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Select a club to review its fitting details.
        </p>
      </div>
      <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[42rem] table-fixed border-collapse text-left">
          <caption className="sr-only">
            Club results and average fitting metrics
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th
                scope="col"
                className="w-[30%] px-3 py-3 sm:w-[24%] sm:px-4 xl:w-[20%]"
              >
                Club
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 lg:table-cell xl:w-[14%]"
              >
                Tags
              </th>
              <th
                scope="col"
                className="w-[14%] px-2 py-3 text-right sm:w-[10%] sm:px-3 xl:w-[7%]"
              >
                Shots
              </th>
              <th
                scope="col"
                className="w-[18%] px-2 py-3 text-right sm:w-[14%] sm:px-3 xl:w-[11%]"
              >
                Avg Carry
              </th>
              <th
                scope="col"
                className="w-[18%] px-2 py-3 text-right sm:w-[14%] sm:px-3 xl:w-[11%]"
              >
                Avg Total
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-right md:table-cell xl:w-[11%]"
              >
                Ball Speed
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-right lg:table-cell xl:w-[10%]"
              >
                Avg Height
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-right xl:table-cell xl:w-[10%]"
              >
                Price
              </th>
              <th
                scope="col"
                className="px-3 py-3 text-center xl:w-[8%]"
              >
                Include
              </th>
              <th scope="col" className="px-3 py-3 text-center xl:w-[8%]">
                For Sale
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summaries.map((summary) => {
              const isIncluded = summary.includeInReport !== false;
              const height = summary.avgMaxHeight
                ? (summary.avgMaxHeight * 3.28084).toFixed(1)
                : null;

              return (
                <tr
                  key={summary.id}
                  tabIndex={0}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    onOpenSummary(summary.id, event.currentTarget);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onOpenSummary(summary.id, event.currentTarget);
                  }}
                  className={`cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
                    selectedSummaryIds?.has(summary.id)
                      ? "bg-primary/[0.035]"
                      : ""
                  } ${summary.includeInReport === false ? "opacity-60" : ""}`}
                >
                  <th
                    scope="row"
                    className="px-3 py-3 text-sm font-semibold text-foreground sm:px-4"
                  >
                    <span className="block truncate">{summary.clubName}</span>
                    {summary.tags.length > 0 && (
                      <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground lg:hidden">
                        {summary.tags.join(", ")}
                      </span>
                    )}
                  </th>
                  <td
                    className="hidden truncate px-3 py-3 text-xs text-muted-foreground lg:table-cell"
                    title={summary.tags.join(", ")}
                  >
                    {summary.tags.length > 0 ? summary.tags.join(", ") : "—"}
                  </td>
                  <td className="px-2 py-3 text-right text-sm tabular-nums text-muted-foreground sm:px-3">
                    {summary.shotCount.toLocaleString()}
                  </td>
                  <td className="px-2 py-3 text-right text-sm font-semibold tabular-nums text-foreground sm:px-3">
                    <ResultMetric value={summary.avgCarry} unit="yd" />
                  </td>
                  <td className="px-2 py-3 text-right text-sm font-semibold tabular-nums text-foreground sm:px-3">
                    <ResultMetric value={summary.avgTotal} unit="yd" />
                  </td>
                  <td className="hidden px-3 py-3 text-right text-sm tabular-nums text-foreground md:table-cell">
                    <ResultMetric value={summary.avgBallSpeed} unit="mph" />
                  </td>
                  <td className="hidden px-3 py-3 text-right text-sm tabular-nums text-foreground lg:table-cell">
                    {height ? (
                      <>
                        {height}
                        <span className="ml-1 text-xs text-muted-foreground">ft</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-right text-sm font-mono tabular-nums text-foreground xl:table-cell">
                    {summary.estimatedPrice !== null
                      ? `$${summary.estimatedPrice.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {onToggleInclude && (
                      <button
                        type="button"
                        disabled={toggling?.has(summary.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleInclude(summary.id, isIncluded);
                        }}
                        aria-label={`${isIncluded ? "Exclude" : "Include"} ${summary.clubName}`}
                        role="switch"
                        aria-checked={isIncluded}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/40 ${
                          isIncluded
                            ? "bg-primary-hover"
                            : "bg-muted"
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-150 ease-in-out ${
                            isIncluded ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {onToggleSale && (
                      <input
                        type="checkbox"
                        aria-label={`For sale: ${summary.clubName}`}
                        checked={summary.availableForPurchase}
                        disabled={!isIncluded || toggling?.has(summary.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => onToggleSale(summary.id, event.target.checked)}
                        className="h-4 w-4 accent-primary disabled:opacity-50"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResultMetric({
  value,
  unit,
  decimals = 1,
}: {
  value: number | null;
  unit: string;
  decimals?: number;
}) {
  const formatted = formatClubResultMetric(value, decimals);
  return (
    <>
      {formatted}
      {formatted !== "—" && (
        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
          {unit}
        </span>
      )}
    </>
  );
}

function clubLabel(
  summary: Pick<ClubResultSummary, "clubName" | "tags" | "id">,
  summaries: readonly ClubResultSummary[],
  existingCounts?: ReadonlyMap<string, number>,
): string {
  const name = summary.clubName.trim() || "Unknown Club";
  const duplicateCount =
    existingCounts?.get(summary.clubName) ??
    summaries.filter((candidate) => candidate.clubName === summary.clubName)
      .length;
  return duplicateCount > 1 && summary.tags.length > 0
    ? `${name} · ${summary.tags.join(", ")}`
    : name;
}
