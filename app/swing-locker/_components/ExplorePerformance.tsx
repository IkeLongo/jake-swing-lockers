"use client";

import { useId, useState } from "react";
import { DispersionChart } from "@/app/_components/visualizations/DispersionChart";
import type { DispersionPoint } from "@/lib/golf/dispersion";
import type { CustomerClub, CustomerDemoClub } from "@/lib/queries/customer-sessions";

function clubName(club: CustomerClub): string {
  const name = club.clubType?.trim() || "Club";
  const tags = club.tags.join(", ");
  // Some finalized comparison names already include their tags.
  const legacySuffix = ` - ${tags}`;
  const baseName = tags && name.endsWith(legacySuffix)
    ? name.slice(0, -legacySuffix.length)
    : name;
  const labeledName = tags && !baseName.endsWith(` · ${tags}`)
    ? `${baseName} · ${tags}`
    : baseName;
  return [labeledName, club.brand, club.model].filter(Boolean).join(" · ");
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

export function linkedDispersionClubs(clubs: readonly CustomerDemoClub[], selectedId: number): CustomerClub[] {
  const selectedTest = clubs.find((club) => club.id === selectedId);
  if (selectedTest) return selectedTest.comparisonClub ? [selectedTest.comparisonClub] : [];
  return clubs.filter((club) => club.comparisonClub?.id === selectedId);
}

export function ExplorePerformance({ clubs }: { clubs: CustomerDemoClub[] }) {
  const selectId = useId();
  const [selectedId, setSelectedId] = useState<number | null>(clubs[0]?.id ?? null);
  const clubsById = new Map<number, CustomerClub>(clubs.map((club) => [club.id, club]));
  for (const club of clubs) {
    if (club.comparisonClub && !clubsById.has(club.comparisonClub.id)) {
      clubsById.set(club.comparisonClub.id, club.comparisonClub);
    }
  }
  const selected = (selectedId === null ? undefined : clubsById.get(selectedId)) ?? clubs[0];
  const linkedClubs = selected ? linkedDispersionClubs(clubs, selected.id) : [];
  const selectedData = selected ? clubDispersion(selected) : { points: [], includedShotCount: 0 };
  const comparisons = linkedClubs.map((club) => ({ club, data: clubDispersion(club) }));
  const points = [...selectedData.points, ...comparisons.flatMap(({ data }) => data.points)];
  const includedShotCount = selectedData.includedShotCount +
    comparisons.reduce((total, { data }) => total + data.includedShotCount, 0);
  const colors = new Map<number, string>(
    [...clubsById.keys()].sort((a, b) => a - b).map((id, index) => [
      id,
      index === 0 ? "var(--primary)" : index === 1 ? "var(--accent)"
        : `hsl(${(210 + (index - 2) * 137.508) % 360} 70% 48%)`,
    ]),
  );
  const names = new Map([...clubsById.values()].map((club) => [club.id, clubName(club)]));

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
              See where your shots landed.
            </p>
          </div>
          {selected && (
            <div className="w-full min-w-0 sm:w-64">
              <label htmlFor={selectId} className="mb-1.5 block font-body text-xs font-semibold text-muted-foreground">
                Select club
              </label>
              <select
                id={selectId}
                value={selected.id}
                onChange={(event) => setSelectedId(Number(event.target.value))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 font-body text-sm text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {[...clubsById.values()].map((club) => <option key={club.id} value={club.id}>{clubName(club)}</option>)}
              </select>
            </div>
          )}
        </div>

        {selected && (
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 font-body text-sm text-card-foreground">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colors.get(selected.id) }} />
              <span className="break-words">{clubName(selected)}</span>
            </span>
            {comparisons.map(({ club }) => (
              <span key={club.id} className="inline-flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colors.get(club.id) }} />
                <span className="break-words">{clubName(club)}</span>
              </span>
            ))}
          </div>
        )}

        {selected && selectedData.points.length === 0 && points.length > 0 && (
          <p className="mt-4 font-body text-sm text-muted-foreground">
            No measured dispersion is available for {clubName(selected)}.
          </p>
        )}
        {comparisons.filter(({ data }) => data.points.length === 0).map(({ club }) => (
          <p key={club.id} className="mt-2 font-body text-sm text-muted-foreground">
            No measured dispersion is available for {clubName(club)}.
          </p>
        ))}
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
