import type { ReactNode } from "react";
import type { CustomerClub, CustomerPurchaseClub, CustomerSessionDetail } from "@/lib/queries/customer-sessions";
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

function resultClubName(club: CustomerClub): string {
  const name = club.clubType?.trim() || "Club";
  const tags = club.tags.join(", ");
  const suffix = ` - ${tags}`;
  const baseName = tags && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  return tags && !baseName.endsWith(` · ${tags}`) ? `${baseName} · ${tags}` : baseName;
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

function RecommendedEquipment({ clubs }: { clubs: CustomerPurchaseClub[] }) {
  if (clubs.length === 0) return null;

  return (
    <section aria-labelledby="recommended-equipment-heading">
      <h2 id="recommended-equipment-heading" className="mb-4 font-subheading text-xl font-semibold text-foreground">
        Recommended Clubs
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
        </table>
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
      <ExplorePerformance clubs={session.clubs} resultsClubs={session.resultsClubs} />

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

      <RecommendedEquipment clubs={session.purchaseClubs} />

      {purchaseAction}
    </>
  );
}
