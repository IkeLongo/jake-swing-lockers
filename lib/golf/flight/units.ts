export function yardsToFeet(yards: number | null): number | null {
  return yards === null || !Number.isFinite(yards) ? null : yards * 3;
}

export function yardsToMeters(yards: number): number {
  return yards * 0.9144;
}
