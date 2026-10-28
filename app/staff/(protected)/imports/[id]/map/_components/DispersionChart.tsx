"use client";

import { useMemo, useState } from "react";
import {
  buildClubDispersionAverages,
  computeDispersionBounds,
  type DispersionPoint,
} from "./reviewFittingDispersion";

interface DispersionChartProps {
  points: readonly DispersionPoint[];
  includedShotCount: number;
  colorsBySummaryId: ReadonlyMap<number, string>;
  namesBySummaryId: ReadonlyMap<number, string>;
}

// TODO: Future dispersion improvements (not implemented yet):
// 1. Replace the rectangular grid with golf-style concentric/range rings, like
//    a top-down range view.
// 2. Drop the positive/negative lateral-axis labels once rings are in place.
// 3. Add a dashed dispersion ellipse per visible club, derived from the
//    measured (carrySideYd, carryYd) distribution.
// 4. The ellipse should show the typical landing zone, not enclose every
//    shot or outlier.
// 5. Before implementing, choose and document the statistical coverage level
//    (e.g. 1σ covariance ellipse vs another confidence/coverage level).
const WIDTH = 360;
const HEIGHT = 380;
const MARGIN = { top: 14, right: 16, bottom: 40, left: 46 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const FALLBACK_COLOR = "#8b93a1";

function formatYards(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function DispersionChart({
  points,
  includedShotCount,
  colorsBySummaryId,
  namesBySummaryId,
}: DispersionChartProps) {
  const [hoveredShotId, setHoveredShotId] = useState<string | null>(null);
  const bounds = useMemo(() => computeDispersionBounds(points), [points]);
  const averages = useMemo(() => buildClubDispersionAverages(points), [points]);

  if (points.length === 0) {
    return (
      <p
        className="flex min-h-44 flex-1 items-center justify-center rounded-xl bg-muted/40 px-4 text-center text-sm text-muted-foreground"
        role="status"
      >
        No measured dispersion available for this selection.
      </p>
    );
  }

  const x = (lateralYd: number) =>
    MARGIN.left +
    ((lateralYd - bounds.minLateralYd) /
      (bounds.maxLateralYd - bounds.minLateralYd)) *
      PLOT_WIDTH;
  const y = (carryYd: number) =>
    MARGIN.top +
    ((bounds.maxCarryYd - carryYd) / (bounds.maxCarryYd - bounds.minCarryYd)) *
      PLOT_HEIGHT;
  const colorOf = (summaryId: number) =>
    colorsBySummaryId.get(summaryId) ?? FALLBACK_COLOR;
  const nameOf = (summaryId: number) =>
    namesBySummaryId.get(summaryId) ?? "Unknown Club";
  const hovered = points.find((point) => point.shotId === hoveredShotId) ?? null;
  const omittedCount = includedShotCount - points.length;

  return (
    <div
      role="group"
      aria-label="Measured carry dispersion"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 items-start justify-center">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Top-down scatter of measured carry distance and lateral carry position"
          className="h-auto max-h-[34rem] w-full min-w-0 text-muted-foreground"
          preserveAspectRatio="xMidYMid meet"
        >
          {bounds.carryTicks.map((tick) => (
            <g key={`carry-${tick}`}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 6}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                className="fill-current tabular-nums"
              >
                {tick}
              </text>
            </g>
          ))}
          {bounds.lateralTicks
            .filter((tick) => tick !== 0)
            .map((tick) => (
              <g key={`lateral-${tick}`}>
                <line
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={MARGIN.top}
                  y2={HEIGHT - MARGIN.bottom}
                  className="stroke-border"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
                <text
                  x={x(tick)}
                  y={HEIGHT - MARGIN.bottom + 14}
                  textAnchor="middle"
                  fontSize={10}
                  className="fill-current tabular-nums"
                >
                  {tick}
                </text>
              </g>
            ))}
          <line
            x1={x(0)}
            x2={x(0)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            className="stroke-foreground/60"
            strokeWidth={1.5}
          />
          <text
            x={x(0)}
            y={HEIGHT - MARGIN.bottom + 14}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            className="fill-foreground tabular-nums"
          >
            0
          </text>
          <text
            x={x(0)}
            y={HEIGHT - 6}
            textAnchor="middle"
            fontSize={10}
            className="fill-current"
          >
            Lateral position (yd) · 0 = target line
          </text>
          <text
            transform={`translate(11 ${MARGIN.top + PLOT_HEIGHT / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={10}
            className="fill-current"
          >
            Carry (yd)
          </text>

          {points.map((point) => (
            <circle
              key={point.shotId}
              cx={x(point.carrySideYd)}
              cy={y(point.carryYd)}
              r={hoveredShotId === point.shotId ? 5.5 : 3.5}
              fill={colorOf(point.summaryId)}
              fillOpacity={hoveredShotId === point.shotId ? 1 : 0.7}
              stroke={hoveredShotId === point.shotId ? "currentColor" : "none"}
              className="text-foreground"
              strokeWidth={1.5}
              onPointerEnter={() => setHoveredShotId(point.shotId)}
              onPointerLeave={() => setHoveredShotId(null)}
            >
              <title>
                {`${nameOf(point.summaryId)} · Shot ${point.rowIndex + 1}\nCarry: ${formatYards(
                  Number(point.carryYd.toFixed(1)),
                )} yd\nLateral: ${formatYards(Number(point.carrySideYd.toFixed(1)))} yd`}
              </title>
            </circle>
          ))}

          {averages.map((average) => (
            <circle
              key={`average-${average.summaryId}`}
              cx={x(average.carrySideYd)}
              cy={y(average.carryYd)}
              r={7}
              fill={colorOf(average.summaryId)}
              fillOpacity={0.15}
              stroke={colorOf(average.summaryId)}
              strokeWidth={2}
              pointerEvents="none"
            />
          ))}
        </svg>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span aria-live="polite">
          {hovered
            ? `${nameOf(hovered.summaryId)} · Shot ${hovered.rowIndex + 1} · Carry ${hovered.carryYd.toFixed(1)} yd · Lateral ${hovered.carrySideYd.toFixed(1)} yd`
            : `${points.length} of ${includedShotCount} included shots plotted · rings = club averages`}
        </span>
        {omittedCount > 0 && !hovered && (
          <span>{omittedCount} without measured carry or lateral omitted</span>
        )}
      </div>
    </div>
  );
}
