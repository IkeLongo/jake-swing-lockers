"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PALETTE } from "golf-shot-viz";
import { GolfShotViz } from "golf-shot-viz/react";
import type { ShotInput } from "golf-shot-viz";
import type { GolfShotVizHandle } from "golf-shot-viz/react";
import { useTheme } from "next-themes";
import {
  getVisibleSelectedFlightId,
  toGolfShotVizFlights,
} from "@/lib/golf/flight/golfShotVizAdapter";
import type {
  GolfShotVizClubOptions,
  GolfShotVizFlight,
} from "@/lib/golf/flight/golfShotVizAdapter";
import type { ModeledShotFlight } from "@/lib/golf/flight/types";

interface ClubFlightVisualizationProps {
  flights: readonly ModeledShotFlight[];
  includedShotCount: number;
  selectedShotId: string | null;
  onSelectedShotChange: (shotId: string | null) => void;
  embedded?: boolean;
  showSelectedFlightDetail?: boolean;
  showBottomBorder?: boolean;
  clubOptions?: GolfShotVizClubOptions;
  clubLegend?: readonly {
    summaryId?: number;
    label: string;
    color: string;
  }[];
}

type CameraView = "broadcast" | "side";

export const FLIGHT_PALETTE = [
  ...DEFAULT_PALETTE,
  "#1c7d9c",
  "#a24f44",
  "#708b34",
  "#6e5f87",
] as const;

const cameraViews: readonly { label: string; value: CameraView }[] = [
  { label: "Perspective", value: "broadcast" },
  { label: "Side", value: "side" },
];

export function ClubFlightVisualization({
  flights,
  includedShotCount,
  selectedShotId,
  onSelectedShotChange,
  embedded = false,
  showSelectedFlightDetail = true,
  showBottomBorder = true,
  clubOptions,
  clubLegend = [],
}: ClubFlightVisualizationProps) {
  const sceneRef = useRef<GolfShotVizHandle>(null);
  const [cameraView, setCameraView] = useState<CameraView>("broadcast");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const rendererFlights = useMemo(
    () => toGolfShotVizFlights(flights, clubOptions),
    [clubOptions, flights],
  );
  const renderableCount = rendererFlights.length;
  const centeredOnlyCount = rendererFlights.filter(
    (flight) => !flight.lateralDataAvailable,
  ).length;

  useEffect(() => {
    sceneRef.current?.scene?.select(
      getVisibleSelectedFlightId(rendererFlights, selectedShotId),
    );
  }, [rendererFlights, selectedShotId]);

  const handleSelect = (flight: ShotInput | null) => {
    onSelectedShotChange(flight?.id ?? null);
  };

  const header = (
    <div
      className={`flex flex-wrap items-end justify-between gap-3 ${
        embedded ? "mb-2" : "mb-3"
      }`}
    >
      {!embedded ? (
        <div>
          <h3 className="font-subheading text-sm font-semibold text-foreground">
            Shot flight
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Modeled flight from measured TrackMan data
          </p>
        </div>
      ) : null}
      {renderableCount > 0 ? (
        <div
          aria-label="Camera view"
          className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5"
          role="group"
        >
          {cameraViews.map((view) => (
            <button
              key={view.value}
              type="button"
              aria-pressed={cameraView === view.value}
              onClick={() => setCameraView(view.value)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                cameraView === view.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const visualization = (
    <>
      {renderableCount === 0 ? (
        <p
          className="flex min-h-44 flex-1 items-center justify-center rounded-xl bg-muted/40 px-4 text-center text-sm text-muted-foreground"
          role="status"
        >
          No flight visualization available for this selection.
        </p>
      ) : (
        <>
          <div
            className={`${
              embedded ? "h-[18rem] min-h-[18rem]" : "h-64 sm:h-80"
            } min-w-0 overflow-hidden rounded-xl border border-border bg-muted/30`}
          >
            {/* TODO: golf-shot-viz@0.2.0 hardcodes trajectory line width, so the
                70% canvas opacity below is a temporary visual workaround. Once
                configurable width is exposed, use thinner lines and restore
                normal canvas opacity. */}
            <GolfShotViz
              ref={sceneRef}
              key={resolvedTheme ?? "light"}
              shots={rendererFlights}
              className="h-full w-full [&>canvas]:opacity-70"
              mode="studio"
              units="yards"
              colorBy={clubOptions ? "club" : "index"}
              palette={[...FLIGHT_PALETTE]}
              background={null}
              groundColor={isDark ? "#222925" : "#e8eaeb"}
              tooltip={false}
              autoRotate={false}
              rollout={false}
              cameraPreset={cameraView}
              onSelect={handleSelect}
            />
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {renderableCount} of {includedShotCount} included shots shown
            </span>
            {centeredOnlyCount > 0 && (
              <span>
                Lateral position unavailable for {centeredOnlyCount} modeled{" "}
                {centeredOnlyCount === 1 ? "shot" : "shots"}; centered only to
                show flight height and distance.
              </span>
            )}
            {showSelectedFlightDetail && selectedShotId && (
              <SelectedFlightDetail
                flights={rendererFlights}
                selectedShotId={selectedShotId}
              />
            )}
          </div>
          {clubLegend.length > 0 && (
            <ul
              aria-label="Club colors"
              className="mt-2 flex max-h-12 min-w-0 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-[11px] text-muted-foreground"
            >
              {clubLegend.map(({ summaryId, label, color }) => (
                <li
                  key={summaryId ?? label}
                  className="inline-flex min-w-0 items-center gap-1.5"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="max-w-40 truncate">{label}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return (
      <div
        role="group"
        aria-label="Modeled club flight visualization"
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {header}
        {visualization}
      </div>
    );
  }

  return (
    <section
      aria-label="Modeled club flight visualization"
      className={`min-w-0 border-t border-border py-5 ${
        showBottomBorder ? "border-b" : ""
      }`}
    >
      {header}
      {visualization}
    </section>
  );
}

function SelectedFlightDetail({
  flights,
  selectedShotId,
}: {
  flights: readonly GolfShotVizFlight[];
  selectedShotId: string;
}) {
  const selectedFlight = flights.find((flight) => flight.id === selectedShotId);
  if (!selectedFlight) return null;

  return (
    <span>
      Shot {selectedFlight.rowIndex + 1}
      {selectedFlight.apexHeightFt !== null &&
        ` · measured apex ${selectedFlight.apexHeightFt.toFixed(1)} ft`}
    </span>
  );
}
