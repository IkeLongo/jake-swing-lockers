"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeGappingBounds,
  type GappingClubRow,
} from "./reviewFittingGapping";

interface GappingChartProps {
  rows: readonly GappingClubRow[];
  includedShotCount: number;
  colorsBySummaryId: ReadonlyMap<number, string>;
  namesBySummaryId: ReadonlyMap<number, string>;
}

const MIN_WIDTH = 320;
const ROW_HEIGHT = 34;
const MARGIN = { top: 10, right: 16, bottom: 36, left: 96 };
const FALLBACK_COLOR = "#8b93a1";

function yd(value: number): string {
  return value.toFixed(1);
}

export function GappingChart({
  rows,
  includedShotCount,
  colorsBySummaryId,
  namesBySummaryId,
}: GappingChartProps) {
  const bounds = useMemo(() => computeGappingBounds(rows), [rows]);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(520);

  // Lay out in real pixels so a wider card adds plot room instead of scaling text.
  useEffect(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMeasuredWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  if (rows.length === 0) {
    return (
      <p
        className="flex min-h-32 flex-1 items-center justify-center rounded-xl bg-muted/40 px-4 text-center text-sm text-muted-foreground"
        role="status"
      >
        No measured carry available for this selection.
      </p>
    );
  }

  const WIDTH = Math.max(measuredWidth, MIN_WIDTH);
  const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = rows.length * ROW_HEIGHT;
  const height = MARGIN.top + plotHeight + MARGIN.bottom;
  const x = (carryYd: number) =>
    MARGIN.left +
    ((carryYd - bounds.minYd) / (bounds.maxYd - bounds.minYd)) * PLOT_WIDTH;
  const plotted = rows.reduce((sum, row) => sum + row.points.length, 0);

  return (
    <div
      ref={setContainer}
      role="group"
      aria-label="Measured carry gapping"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        width={WIDTH}
        height={height}
        role="img"
        aria-label="Measured carry distance by club, ordered by average carry"
        className="block max-w-full text-muted-foreground"
      >
        {bounds.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={x(tick)}
              x2={x(tick)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotHeight}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={x(tick)}
              y={MARGIN.top + plotHeight + 14}
              textAnchor="middle"
              fontSize={10}
              className="fill-current tabular-nums"
            >
              {tick}
            </text>
          </g>
        ))}
        <text
          x={MARGIN.left + PLOT_WIDTH / 2}
          y={height - 6}
          textAnchor="middle"
          fontSize={10}
          className="fill-current"
        >
          Carry (yd)
        </text>

        {rows.map((row, index) => {
          const color = colorsBySummaryId.get(row.summaryId) ?? FALLBACK_COLOR;
          const name = namesBySummaryId.get(row.summaryId) ?? "Unknown Club";
          const cy = MARGIN.top + index * ROW_HEIGHT + ROW_HEIGHT / 2;
          return (
            <g key={row.summaryId}>
              {index > 0 && (
                <line
                  x1={4}
                  x2={WIDTH - MARGIN.right}
                  y1={cy - ROW_HEIGHT / 2}
                  y2={cy - ROW_HEIGHT / 2}
                  className="stroke-border"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
              )}
              <text
                x={MARGIN.left - 10}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fontWeight={500}
                className="fill-foreground"
              >
                {name.length > 16 ? `${name.slice(0, 15)}…` : name}
                <title>{name}</title>
              </text>
              <line
                x1={x(row.minCarryYd)}
                x2={x(row.maxCarryYd)}
                y1={cy}
                y2={cy}
                stroke={color}
                strokeOpacity={0.35}
                strokeWidth={3}
                strokeLinecap="round"
              />
              {row.points.map((point) => (
                <circle
                  key={point.shotId}
                  cx={x(point.carryYd)}
                  cy={cy + point.jitter * 8}
                  r={3}
                  fill={color}
                  fillOpacity={0.75}
                  className="hover:fill-opacity-100"
                >
                  <title>
                    {`${name}\nShot ${point.rowIndex + 1}\nCarry: ${yd(point.carryYd)} yd`}
                  </title>
                </circle>
              ))}
              <g tabIndex={0} aria-label={`${name} average carry ${yd(row.averageCarryYd)} yards`}>
                <path
                  d={`M ${x(row.averageCarryYd)} ${cy - 8} L ${x(row.averageCarryYd) + 8} ${cy} L ${x(row.averageCarryYd)} ${cy + 8} L ${x(row.averageCarryYd) - 8} ${cy} Z`}
                  fill={color}
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth={1.5}
                />
                <title>
                  {`${name}\nAverage carry: ${yd(row.averageCarryYd)} yd\nRange: ${yd(row.minCarryYd)}–${yd(row.maxCarryYd)} yd\nShots: ${row.points.length}`}
                </title>
              </g>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">
        {plotted} of {includedShotCount} included shots plotted · ◆ = club average · line = min–max
      </p>
    </div>
  );
}
