export const DEFAULT_FITTING_TYPE = "Golf Fitting";
export const MAX_OPPORTUNITY_NAME_LENGTH = 255;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Fitting dates are stored as UTC wall-clock instants; always read them in UTC. */
export function formatFittingDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function resolveFittingDate(batch: {
  trackmanSessionDate: Date | null;
  fittingDateOverride: Date | null;
}): Date | null {
  return batch.trackmanSessionDate ?? batch.fittingDateOverride ?? null;
}

export function buildSuggestedOpportunityName(input: {
  firstName: string | null;
  lastName: string | null;
  fittingDate: Date;
  fittingType?: string;
}): string {
  const customer =
    `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim() || "Golf Customer";
  return `${customer} — ${input.fittingType ?? DEFAULT_FITTING_TYPE} — ${formatFittingDate(input.fittingDate)}`;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseOpportunityName(input: unknown): ParseResult<string> {
  if (typeof input !== "string") {
    return { ok: false, error: "opportunityName must be a string." };
  }
  const name = input.trim();
  if (name.length === 0) {
    return { ok: false, error: "opportunityName cannot be empty." };
  }
  if (name.length > MAX_OPPORTUNITY_NAME_LENGTH) {
    return {
      ok: false,
      error: `opportunityName must be at most ${MAX_OPPORTUNITY_NAME_LENGTH} characters.`,
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: "opportunityName cannot contain control characters." };
  }
  return { ok: true, value: name };
}

/** Accepts a real calendar day as YYYY-MM-DD and returns it as UTC midnight. */
export function parseFittingDateOverride(input: unknown): ParseResult<Date> {
  if (typeof input !== "string") {
    return { ok: false, error: "fittingDate must be a YYYY-MM-DD string." };
  }
  const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return { ok: false, error: "fittingDate must be a YYYY-MM-DD string." };
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, error: "fittingDate is not a valid calendar date." };
  }
  return { ok: true, value: date };
}
