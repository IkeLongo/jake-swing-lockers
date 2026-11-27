"use client";

import { useId, useState } from "react";
import { DispersionChart } from "@/app/_components/visualizations/DispersionChart";
import type { DispersionPoint } from "@/lib/golf/dispersion";
import type { CustomerClub, CustomerDemoClub } from "@/lib/queries/customer-sessions";

function clubName(club: CustomerClub): string {
  return [club.clubType, club.brand, club.model].filter(Boolean).join(" · ") || "Club";
}

function clubDispersion(club: CustomerClub) {
  const shots = club.approvedShotSnapshot?.shots ?? [];
  const points: DispersionPoint[] = shots.flatMap((shot, rowIndex) => {
    const { carryYd, carrySideYd } = shot.measurements;
    if (
      typeof carryYd !== "number" || !Number.isFinite(carryYd) ||
      typeof carrySideYd !== "number" || !Number.isFinite(carrySideYd)
    ) return [];
    return [{
      shotId: `${club.id}:${rowIndex}`,
      rowIndex,
      summaryId: club.id,
      carryYd,
      carrySideYd,
    }];
  });
  return { points, includedShotCount: shots.length };
}

export function ExplorePerformance({ clubs }: { clubs: CustomerDemoClub[] }) {
  const selectId = useId();
  const [selectedId, setSelectedId] = useState<number | null>(clubs[0]?.id ?? null);
  const [showCurrent, setShowCurrent] = useState(true);
  const selected = clubs.find((club) => club.id === selectedId) ?? clubs[0];
  const demo = selected ? clubDispersion(selected) : { points: [], includedShotCount: 0 };
  const currentClub = selected?.comparisonClub ?? null;
  const current = currentClub ? clubDispersion(currentClub) : null;
  const hasCurrent = current !== null && current.points.length > 0;
  const comparing = hasCurrent && showCurrent;
  const points = comparing ? [...demo.points, ...current.points] : demo.points;
  const includedShotCount = demo.includedShotCount + (comparing ? current.includedShotCount : 0);
  const colors = new Map<number, string>();
  const names = new Map<number, string>();
  if (selected) {
    colors.set(selected.id, "var(--primary)");
    names.set(selected.id, clubName(selected));
  }
  if (currentClub && comparing) {
    colors.set(currentClub.id, "var(--accent)");
    names.set(currentClub.id, clubName(currentClub));
  }

  return (
    <section aria-labelledby="explore-performance-heading" className="mb-8">
      <h2 id="explore-performance-heading" className="mb-4 font-subheading text-xl font-semibold text-foreground">
        Explore Your Performance
      </h2>
      <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-heading text-base font-semibold text-card-foreground">Shot Dispersion</h3>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              Explore where your approved shots landed.
            </p>
          </div>
          {selected && (
            <div className="w-full min-w-0 sm:w-64">
              <label htmlFor={selectId} className="mb-1.5 block font-body text-xs font-semibold text-muted-foreground">
                Demo club
              </label>
              <select
                id={selectId}
                value={selected.id}
                onChange={(event) => {
                  setSelectedId(Number(event.target.value));
                  setShowCurrent(true);
                }}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 font-body text-sm text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {clubs.map((club) => <option key={club.id} value={club.id}>{clubName(club)}</option>)}
              </select>
            </div>
          )}
        </div>

        {selected && (
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 font-body text-sm text-card-foreground">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-primary" />
              <span className="break-words">Demo: {clubName(selected)}</span>
            </span>
            {currentClub && hasCurrent && (
              <label className="inline-flex min-w-0 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={showCurrent}
                  onChange={(event) => setShowCurrent(event.target.checked)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-accent" />
                <span className="break-words">Compare current: {clubName(currentClub)}</span>
              </label>
            )}
          </div>
        )}

        {selected && demo.points.length === 0 && comparing && (
          <p className="mt-4 font-body text-sm text-muted-foreground">
            No measured dispersion is available for this demo club.
          </p>
        )}
        {currentClub && !hasCurrent && (
          <p className="mt-2 font-body text-sm text-muted-foreground">
            No measured dispersion is available for the current club.
          </p>
        )}
        <div className="mx-auto mt-4 flex w-full max-w-md min-w-0">
          <DispersionChart
            points={points}
            includedShotCount={includedShotCount}
            colorsBySummaryId={colors}
            namesBySummaryId={names}
          />
        </div>
        <p className="mt-4 font-body text-xs text-muted-foreground">
          Lateral values are signed; left and right direction has not been verified.
        </p>
      </div>
    </section>
  );
}
