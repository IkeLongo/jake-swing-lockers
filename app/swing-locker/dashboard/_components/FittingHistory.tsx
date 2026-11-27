import Link from "next/link";
import type {
  CustomerSessionClubSummary,
  CustomerSessionSummary,
} from "@/lib/queries/customer-sessions";

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const MAX_VISIBLE_CLUBS = 3;

function formatSessionDate(date: Date): string {
  const raw = date.toISOString();
  const match = ISO_DATE_PREFIX.exec(raw);

  if (!match) {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function generateFittingTitle(
  clubs: readonly CustomerSessionClubSummary[],
): string {
  const titles = new Map<string, string>();
  for (const club of clubs) {
    const name = club.name?.trim();
    if (!name || /^(club|unknown club|unassigned)$/i.test(name)) continue;
    const formattedName = name.replace(/^(\d+)\s*iron$/i, "$1 Iron");
    titles.set(formattedName.toLocaleLowerCase("en-US"), formattedName);
  }

  const names = [...titles.values()];
  if (names.length === 0 || names.length > 2) return "Golf Club Fitting";
  return `${names.join(" & ")} Fitting`;
}

function ClubSummary({
  heading,
  clubs,
}: {
  heading: string;
  clubs: readonly CustomerSessionClubSummary[];
}) {
  const visible = clubs.slice(0, MAX_VISIBLE_CLUBS);
  const remaining = clubs.length - visible.length;

  return (
    <div className="min-w-0">
      <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {heading}
      </p>
      <p className="mt-1 break-words font-body text-sm text-card-foreground">
        {visible.length > 0
          ? visible.map((club) => club.label).join(", ")
          : "No included clubs recorded."}
        {remaining > 0 && (
          <span className="text-muted-foreground"> · +{remaining} more</span>
        )}
      </p>
    </div>
  );
}

function FittingCard({
  session,
  isMostRecent,
}: {
  session: CustomerSessionSummary;
  isMostRecent: boolean;
}) {
  const formattedDate = formatSessionDate(session.demoDate);

  return (
    <article
      className={`min-w-0 rounded-2xl border bg-card p-5 shadow-sm sm:p-6 ${
        isMostRecent ? "border-accent/50" : "border-border"
      }`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {isMostRecent && (
            <span className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 font-body text-[11px] font-semibold text-foreground">
              Most Recent Fitting
            </span>
          )}
          <h3 className="mt-2 break-words font-heading text-lg font-semibold text-card-foreground">
            {generateFittingTitle(session.includedClubs)}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm text-muted-foreground">
            <time dateTime={session.demoDate.toISOString()}>{formattedDate}</time>
            <span aria-hidden="true">·</span>
            <span>
              {session.includedClubCount} included club
              {session.includedClubCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <Link
          href={`/swing-locker/dashboard/sessions/${session.id}`}
          className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-body text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto"
        >
          View Fitting
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="mt-5 grid min-w-0 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <ClubSummary heading="Included clubs" clubs={session.includedClubs} />
        {session.recommendedClubs.length > 0 && (
          <ClubSummary heading="Recommended clubs" clubs={session.recommendedClubs} />
        )}
      </div>
    </article>
  );
}

export function FittingHistory({
  sessions,
}: {
  sessions: readonly CustomerSessionSummary[];
}) {
  return (
    <section aria-labelledby="fitting-history-heading">
      <div className="mb-4 flex items-center gap-2">
        <span aria-hidden="true" className="h-4 w-0.5 shrink-0 rounded-full bg-accent" />
        <h2
          id="fitting-history-heading"
          className="font-subheading text-xl font-semibold text-foreground"
        >
          Your Fitting History
        </h2>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
          <p className="font-body text-sm text-muted-foreground">
            No finalized fittings yet. Your fitting history will appear here.
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {sessions.map((session, index) => (
            <FittingCard
              key={session.id}
              session={session}
              isMostRecent={index === 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}
