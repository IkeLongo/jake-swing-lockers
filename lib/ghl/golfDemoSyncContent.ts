// Pure builders shared by the legacy syncGolfDemoToGHL and the staged sync.

export interface SyncClubTest {
  clubRole: string;
  clubType: string | null;
  brand: string | null;
  model: string | null;
  isRecommended: boolean;
  estimatedPrice: { toNumber(): number } | null;
}

export interface SyncSessionInfo {
  id: number;
  demoDate: Date;
  salesRep: string | null;
  currentClub: string | null;
  clubTests: readonly SyncClubTest[];
}

export interface GolfDemoSummaries {
  recommendedClubSummary: string;
  currentClubSummary: string;
  demoClubCount: number;
  monetaryValue: number | undefined;
}

function clubLabel(test: SyncClubTest): string {
  const parts = [test.brand, test.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : test.clubType ?? "Unknown";
}

export function buildGolfDemoSummaries(
  session: SyncSessionInfo,
): GolfDemoSummaries {
  const demoPairs = session.clubTests.filter((t) => t.clubRole === "demo");
  const currentPairs = session.clubTests.filter((t) => t.clubRole === "current");

  const recommendedClub = demoPairs.find((t) => t.isRecommended);
  const recommendedClubSummary = recommendedClub
    ? clubLabel(recommendedClub)
    : demoPairs.map(clubLabel).join(", ");

  const currentClubSummary =
    currentPairs.length > 0
      ? currentPairs.map(clubLabel).join(", ")
      : session.currentClub ?? "";

  const priceSum = demoPairs
    .filter((t) => t.estimatedPrice != null)
    .reduce((acc, t) => acc + t.estimatedPrice!.toNumber(), 0);

  return {
    recommendedClubSummary,
    currentClubSummary,
    demoClubCount: demoPairs.length,
    monetaryValue: priceSum > 0 ? Math.round(priceSum * 100) / 100 : undefined,
  };
}

/** Contact custom fields; only fields with a configured env ID and a value are included. */
export function buildGolfDemoCustomFields(
  session: SyncSessionInfo,
  summaries: GolfDemoSummaries,
  lockerUrl: string,
  submittedAtIso: string,
  env: Record<string, string | undefined> = process.env,
): { id: string; value: string }[] {
  const fields: { id: string; value: string }[] = [];
  const add = (envKey: string, value: string | null | undefined) => {
    const fieldId = env[envKey];
    if (fieldId && value != null && value !== "") {
      fields.push({ id: fieldId, value });
    }
  };

  add("GHL_SWINGLOCKER_CF_SWING_LOCKER_URL", lockerUrl);
  add("GHL_SWINGLOCKER_CF_LATEST_DEMO_SESSION_ID", String(session.id));
  add(
    "GHL_SWINGLOCKER_CF_LATEST_DEMO_DATE",
    session.demoDate.toISOString().split("T")[0],
  );
  add("GHL_SWINGLOCKER_CF_RECOMMENDED_CLUB_SUMMARY", summaries.recommendedClubSummary);
  add("GHL_SWINGLOCKER_CF_CURRENT_CLUB_SUMMARY", summaries.currentClubSummary);
  add("GHL_SWINGLOCKER_CF_DEMO_FOLLOWUP_STATUS", "pending");
  add("GHL_SWINGLOCKER_CF_SALES_REP_NAME", session.salesRep ?? "");
  add("GHL_SWINGLOCKER_CF_DEMO_CLUB_COUNT", String(summaries.demoClubCount));
  add("GHL_SWINGLOCKER_CF_LAST_DEMO_SUBMITTED_AT", submittedAtIso);
  return fields;
}

export const GOLF_DEMO_TAGS = [
  "golf-demo:locker-ready",
  "golf-demo:followup-active",
];

export function golfDemoOpportunityName(client: {
  firstName: string | null;
  lastName: string | null;
}): string {
  const name = `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim();
  return `${name} - Golf Demo`.trim();
}
