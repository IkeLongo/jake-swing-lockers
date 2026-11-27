"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { ClubFlightVisualization } from "@/app/_components/visualizations/ClubFlightVisualization";
import { DispersionChart } from "@/app/_components/visualizations/DispersionChart";
import { GappingChart } from "@/app/_components/visualizations/GappingChart";
import type { DispersionPoint } from "@/lib/golf/dispersion";
import { buildCustomerShotFlights } from "@/lib/golf/flight/customerShotFlights";
import { buildGappingRows } from "@/lib/golf/gapping";
import type { CustomerClub, CustomerDemoClub } from "@/lib/queries/customer-sessions";

function subscribeThemeColors(onChange: () => void) {
  // Three.js needs resolved colors and cannot read CSS variables itself.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  return () => observer.disconnect();
}

function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return `${styles.getPropertyValue("--primary").trim()}|${styles.getPropertyValue("--accent").trim()}`;
}

function readServerThemeColors() {
  return "";
}

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

export function buildCustomerGapping(clubs: readonly CustomerClub[]) {
  const shots = clubs.flatMap((club) =>
    (club.approvedShotSnapshot?.shots ?? []).map((shot, rowIndex) => ({
      shotId: `${club.id}:${rowIndex}`,
      rowIndex,
      summaryId: club.id,
      carryYd: shot.measurements.carryYd,
    })),
  );
  const gapping = buildGappingRows(shots);
  const plottedIds = new Set(gapping.rows.map((row) => row.summaryId));
  return { ...gapping, unavailableClubs: clubs.filter((club) => !plottedIds.has(club.id)) };
}

function clubColor(index: number): string {
  return index === 0 ? "var(--primary)" : index === 1 ? "var(--accent)"
    : `hsl(${(210 + (index - 2) * 137.508) % 360}, 70%, 48%)`;
}

export function linkedDispersionClubs(clubs: readonly CustomerDemoClub[], selectedId: number): CustomerClub[] {
  const selectedTest = clubs.find((club) => club.id === selectedId);
  if (selectedTest) return selectedTest.comparisonClub ? [selectedTest.comparisonClub] : [];
  return clubs.filter((club) => club.comparisonClub?.id === selectedId);
}

export function ExplorePerformance({
  clubs,
  resultsClubs,
}: {
  clubs: CustomerDemoClub[];
  resultsClubs: CustomerClub[];
}) {
  const selectId = useId();
  const [selectedId, setSelectedId] = useState<number | null>(clubs[0]?.id ?? null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const themeColors = useSyncExternalStore(subscribeThemeColors, readThemeColors, readServerThemeColors);
  const clubsById = useMemo(() => {
    const result = new Map<number, CustomerClub>(clubs.map((club) => [club.id, club]));
    for (const club of clubs) {
      if (club.comparisonClub && !result.has(club.comparisonClub.id)) {
        result.set(club.comparisonClub.id, club.comparisonClub);
      }
    }
    return result;
  }, [clubs]);
  const selected = (selectedId === null ? undefined : clubsById.get(selectedId)) ?? clubs[0];
  const linkedClubs = useMemo(
    () => selected ? linkedDispersionClubs(clubs, selected.id) : [],
    [clubs, selected],
  );
  const flightData = useMemo(
    () => buildCustomerShotFlights(selected ? [selected, ...linkedClubs] : []),
    [selected, linkedClubs],
  );
  const gapping = useMemo(() => buildCustomerGapping(resultsClubs), [resultsClubs]);
  const selectedData = selected ? clubDispersion(selected) : { points: [], includedShotCount: 0 };
  const comparisons = linkedClubs.map((club) => ({ club, data: clubDispersion(club) }));
  const points = [...selectedData.points, ...comparisons.flatMap(({ data }) => data.points)];
  const includedShotCount = selectedData.includedShotCount +
    comparisons.reduce((total, { data }) => total + data.includedShotCount, 0);
  const colors = useMemo(() => new Map<number, string>(
    [...clubsById.keys()].sort((a, b) => a - b).map((id, index) => [
      id,
      clubColor(index),
    ]),
  ), [clubsById]);
  const names = useMemo(
    () => new Map([...clubsById.values()].map((club) => [club.id, clubName(club)])),
    [clubsById],
  );
  const gappingColors = useMemo(() => {
    const result = new Map(colors);
    const extraIds = resultsClubs.map((club) => club.id)
      .filter((id) => !result.has(id)).sort((a, b) => a - b);
    extraIds.forEach((id, index) => result.set(id, clubColor(colors.size + index)));
    return result;
  }, [colors, resultsClubs]);
  const gappingNames = useMemo(
    () => new Map(resultsClubs.map((club) => [club.id, clubName(club)])),
    [resultsClubs],
  );
  const clubOptions = useMemo(() => {
    if (!themeColors) return null;
    const [primary, accent] = themeColors.split("|");
    const hexColor = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
    if (!primary || !accent || !hexColor.test(primary) || !hexColor.test(accent)) return null;
    return {
      colorsBySummaryId: new Map([...colors].map(([id, color]) => [
        id,
        color === "var(--primary)" ? primary
          : color === "var(--accent)" ? accent : color,
      ])),
      namesBySummaryId: names,
    };
  }, [colors, names, themeColors]);

  return (
    <section aria-labelledby="explore-performance-heading" className="mb-8">
      <h2 id="explore-performance-heading" className="mb-4 font-subheading text-xl font-semibold text-foreground">
        Explore Your Performance
      </h2>
      <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-end">
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

        <div className="mt-5 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col">
            <h3 className="font-heading text-base font-semibold text-card-foreground">Shot Dispersion</h3>
            <p className="mt-1 font-body text-sm text-muted-foreground">See where your shots landed.</p>
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
          </div>
          <div className="flex min-w-0 flex-col">
            <h3 className="font-heading text-base font-semibold text-card-foreground">Shot Analyzer</h3>
            <p className="mt-1 font-body text-sm text-muted-foreground">Modeled flight from measured shot data.</p>
            <div className="mt-4 flex min-w-0 flex-1">
              {flightData.flights.length === 0 || clubOptions ? (
                <ClubFlightVisualization
                  flights={flightData.flights}
                  includedShotCount={flightData.includedShotCount}
                  selectedShotId={selectedShotId}
                  onSelectedShotChange={setSelectedShotId}
                  embedded
                  showSelectedFlightDetail={false}
                  clubOptions={clubOptions ?? undefined}
                />
              ) : (
                <p className="text-sm text-muted-foreground" role={themeColors ? "alert" : "status"}>
                  {themeColors ? "Unable to load shot analyzer colors." : "Loading shot analyzer…"}
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="mt-4 font-body text-xs text-muted-foreground">
          Lateral values are signed; left and right direction has not been verified.
        </p>
        <section aria-labelledby="club-gapping-heading" className="mt-6 min-w-0 border-t border-border pt-5">
          <h3 id="club-gapping-heading" className="font-heading text-base font-semibold text-card-foreground">Club Gapping</h3>
          <p className="mt-1 font-body text-sm text-muted-foreground">Carry distance ranges for your approved shots.</p>
          {gapping.rows.length > 0 && (
            <ul aria-label="Club gapping colors" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-body text-sm text-card-foreground">
              {gapping.rows.map((row) => (
                <li key={row.summaryId} className="inline-flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: gappingColors.get(row.summaryId) }} />
                  <span className="break-words">{gappingNames.get(row.summaryId)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex min-w-0">
            <GappingChart
              rows={gapping.rows}
              includedShotCount={gapping.includedShotCount}
              colorsBySummaryId={gappingColors}
              namesBySummaryId={gappingNames}
              averageLabel="Average carry of approved shots"
              emptyMessage="No approved carry measurements are available."
            />
          </div>
          {gapping.unavailableClubs.length > 0 && (
            <p className="mt-3 font-body text-xs text-muted-foreground">
              No approved carry measurements: {gapping.unavailableClubs.map(clubName).join(", ")}.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
