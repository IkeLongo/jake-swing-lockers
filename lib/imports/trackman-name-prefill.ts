export interface TrackManNamePrefill {
  firstName: string;
  lastName: string;
}

export function getTrackManNamePrefill(
  playerName: string | null | undefined,
): TrackManNamePrefill {
  const tokens = playerName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (tokens.length < 2) {
    return { firstName: tokens[0] ?? "", lastName: "" };
  }

  return {
    firstName: tokens.slice(0, -1).join(" "),
    lastName: tokens[tokens.length - 1],
  };
}
