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
import type { GolfShotVizFlight } from "@/lib/golf/flight/golfShotVizAdapter";
import type { ModeledShotFlight } from "@/lib/golf/flight/types";

interface ClubFlightVisualizationProps {
  flights: readonly ModeledShotFlight[];
  includedShotCount: number;
  selectedShotId: string | null;
  onSelectedShotChange: (shotId: string | null) => void;
}

type CameraView = "broadcast" | "side";

const flightPalette = [
  ...DEFAULT_PALETTE,
  "#1c7d9c",
  "#a24f44",
  "#708b34",
  "#6e5f87",
];

const cameraViews: readonly { label: string; value: CameraView }[] = [
  { label: "Perspective", value: "broadcast" },
  { label: "Side", value: "side" },
];

export function ClubFlightVisualization({
  flights,
  includedShotCount,
  selectedShotId,
  onSelectedShotChange,
}: ClubFlightVisualizationProps) {
  const sceneRef = useRef<GolfShotVizHandle>(null);
  const [cameraView, setCameraView] = useState<CameraView>("broadcast");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const rendererFlights = useMemo(() => toGolfShotVizFlights(flights), [flights]);
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

  return (
    <section
      aria-label="Modeled club flight visualization"
      className="min-w-0 border-y border-border py-5"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-subheading text-sm font-semibold text-foreground">
            Shot flight
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Modeled flight from measured TrackMan data
          </p>
        </div>
        {renderableCount > 0 && (
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
        )}
      </div>

      {renderableCount === 0 ? (
        <p
          className="flex min-h-44 items-center justify-center rounded-xl bg-muted/40 px-4 text-center text-sm text-muted-foreground"
          role="status"
        >
          Flight visualization isn&apos;t available for these shots.
        </p>
      ) : (
        <>
          <div className="h-64 min-w-0 overflow-hidden rounded-xl border border-border bg-muted/30 sm:h-80">
            <GolfShotViz
              ref={sceneRef}
              key={resolvedTheme ?? "light"}
              shots={rendererFlights}
              className="h-full w-full"
              mode="studio"
              units="yards"
              colorBy="index"
              palette={flightPalette}
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
            {selectedShotId && (
              <SelectedFlightDetail
                flights={rendererFlights}
                selectedShotId={selectedShotId}
              />
            )}
          </div>
        </>
      )}
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
