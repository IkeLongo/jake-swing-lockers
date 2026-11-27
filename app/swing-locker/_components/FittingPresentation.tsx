import type { ReactNode } from "react";
import type { CustomerClub, CustomerDemoClub, CustomerPurchaseClub, CustomerSessionDetail } from "@/lib/queries/customer-sessions";
import { ExplorePerformance } from "./ExplorePerformance";
import { SwingLockerHero } from "./SwingLockerHero";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtNum(value: number | null, decimals = 1): string {
  if (value == null) return "—";
  return value.toFixed(decimals);
}

function clubName(club: CustomerClub): string {
  return [club.clubType, club.brand, club.model].filter(Boolean).join(" · ") || "Club";
}

function resultClubName(club: CustomerClub): string {
  const name = club.clubType?.trim() || "Club";
  const tags = club.tags.join(", ");
  const suffix = ` - ${tags}`;
  const baseName = tags && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  return tags && !baseName.endsWith(` · ${tags}`) ? `${baseName} · ${tags}` : baseName;
}

function CompactMetricCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="bg-card px-3 py-3 text-center">
      <p className="font-body text-base font-semibold text-card-foreground tabular-nums leading-none">
        {value}
        {unit && (
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
      <p className="mt-1 font-body text-[10px] text-muted-foreground uppercase tracking-widest">
        {label}
      </p>
    </div>
  );
}

function ClubResults({ clubs }: { clubs: CustomerClub[] }) {
  return (
    <section aria-labelledby="club-results-heading" className="mb-8">
      <h2 id="club-results-heading" className="mb-4 font-subheading text-xl font-semibold text-foreground">
        Club Results
      </h2>
      {clubs.length > 0 && (
        <p className="mb-3 font-body text-xs text-muted-foreground lg:hidden">
          Scroll to see all results.
        </p>
      )}
      {clubs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center shadow-sm">
          <p className="font-body text-sm text-muted-foreground">
            No club data recorded for this session.
          </p>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-xl border border-border bg-card shadow-sm" role="region" aria-label="Club results" tabIndex={0}>
          <table className="w-full min-w-[760px] text-left font-body text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-4 font-semibold">Club</th>
                <th scope="col" className="px-4 py-4 text-right font-semibold">Avg Carry <span className="block font-normal">(yd)</span></th>
                <th scope="col" className="px-4 py-4 text-right font-semibold">Avg Total <span className="block font-normal">(yd)</span></th>
                <th scope="col" className="px-4 py-4 text-right font-semibold">Ball Speed <span className="block font-normal">(mph)</span></th>
                <th scope="col" className="px-5 py-4 text-right font-semibold">Avg Height <span className="block font-normal">(ft)</span></th>
              </tr>
            </thead>
            <tbody className="text-card-foreground">
              {clubs.map((club) => (
                <tr key={club.id} className="border-t border-border">
                  <th scope="row" className="px-5 py-4 font-semibold">
                    {resultClubName(club)}
                    {[club.brand, club.model, club.shaft, club.loft].filter(Boolean).length > 0 && (
                      <span className="mt-1 block font-normal text-muted-foreground">
                        {[club.brand, club.model, club.shaft, club.loft].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-4 text-right tabular-nums">{fmtNum(club.carryDistance)}</td>
                  <td className="px-4 py-4 text-right tabular-nums">{fmtNum(club.totalDistance)}</td>
                  <td className="px-4 py-4 text-right tabular-nums">{fmtNum(club.ballSpeed)}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{fmtNum(club.avgMaxHeight === null ? null : club.avgMaxHeight * 3.28084)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ClubComparisons({ clubs }: { clubs: CustomerDemoClub[] }) {
  const comparisons = clubs.filter((club) => club.comparisonClub != null);
  if (comparisons.length === 0) return null;

  return (
    <section aria-labelledby="club-comparisons-heading" className="mb-8">
      <h2 id="club-comparisons-heading" className="mb-4 font-subheading text-xl font-semibold text-foreground">
        Current vs. Demo Club Comparisons
      </h2>
      <div className="flex flex-col gap-4">
        {comparisons.map((club) => {
          const current = club.comparisonClub;
          if (!current) return null;
          return (
            <div key={club.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="px-5 py-4">
                <h3 className="break-words font-heading text-base font-semibold text-card-foreground [overflow-wrap:anywhere]">{clubName(club)}</h3>
                <p className="mt-2 font-body text-xs font-semibold uppercase tracking-widest text-muted-foreground">Compared with</p>
                <p className="mt-1 break-words font-heading text-sm font-semibold text-card-foreground [overflow-wrap:anywhere]">
                  {[current.brand, current.model, current.clubType].filter(Boolean).join(" ") || "Current Club"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-5">
                <CompactMetricCell label="Club Speed" value={fmtNum(current.clubSpeed)} unit="mph" />
                <CompactMetricCell label="Ball Speed" value={fmtNum(current.ballSpeed)} unit="mph" />
                <CompactMetricCell label="Spin Rate" value={fmtNum(current.spinRate, 0)} unit="rpm" />
                <CompactMetricCell label="Carry" value={fmtNum(current.carryDistance, 0)} unit="yds" />
                <CompactMetricCell label="Total" value={fmtNum(current.totalDistance, 0)} unit="yds" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EquipmentPricing({ clubs, estimatedTotal }: {
  clubs: CustomerPurchaseClub[];
  estimatedTotal: number | null;
}) {
  if (clubs.length === 0) return null;

  return (
    <section aria-labelledby="equipment-pricing-heading">
      <h2 id="equipment-pricing-heading" className="mb-4 font-subheading text-xl font-semibold text-foreground">
        Equipment Pricing
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full table-fixed text-left font-body text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-4 font-semibold">Club</th>
              <th scope="col" className="w-36 px-5 py-4 text-right font-semibold">Estimated price</th>
            </tr>
          </thead>
          <tbody className="text-card-foreground">
            {clubs.map((club) => (
              <tr key={club.id} className="border-t border-border">
                <th scope="row" className="break-words px-5 py-4 font-medium [overflow-wrap:anywhere]">{club.label}</th>
                <td className="px-5 py-4 text-right tabular-nums">
                  {club.estimatedPrice != null ? fmtPrice(club.estimatedPrice) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          {estimatedTotal != null && (
            <tfoot>
              <tr className="border-t border-border font-semibold text-card-foreground">
                <th scope="row" className="px-5 py-4">Total estimated price</th>
                <td className="px-5 py-4 text-right tabular-nums">{fmtPrice(estimatedTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {estimatedTotal != null && clubs.some((club) => club.estimatedPrice == null) && (
          <p className="border-t border-border px-5 py-3 font-body text-xs text-muted-foreground">
            Total includes available estimates only.
          </p>
        )}
      </div>
    </section>
  );
}

export function PurchaseRequestSubmitted() {
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center gap-2">
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
      <p className="font-body text-sm font-semibold text-slate-600">
        Purchase request submitted
      </p>
    </div>
  );
}

export function FittingPresentation({
  session,
  purchaseAction,
}: {
  session: CustomerSessionDetail;
  purchaseAction: ReactNode;
}) {
  return (
    <>
      <SwingLockerHero customerName={session.customerName} fittingDate={session.demoDate} />

      <ClubResults clubs={session.resultsClubs} />
      <ExplorePerformance clubs={session.clubs} />
      <ClubComparisons clubs={session.clubs} />

      {session.notes && (
        <div className="mb-8 rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-3.5 w-0.5 rounded-full bg-accent shrink-0" />
            <h2 className="font-subheading text-base font-semibold text-card-foreground">
              Session Notes
            </h2>
          </div>
          <p className="font-body text-sm text-card-foreground leading-relaxed whitespace-pre-wrap break-words">
            {session.notes}
          </p>
        </div>
      )}

      <EquipmentPricing clubs={session.purchaseClubs} estimatedTotal={session.estimatedTotal} />

      {purchaseAction}
    </>
  );
}
