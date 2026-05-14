/**
 * Generate all plausible stored formats for a US phone number so DB lookups
 * succeed regardless of how the number was originally saved.
 *
 * Examples:
 *   "2107306232"     → ["2107306232", "+12107306232", "12107306232"]
 *   "(210) 730-6232" → ["2107306232", "+12107306232", "12107306232"]
 *   "+12107306232"   → ["+12107306232", "12107306232", "2107306232"]
 */
export function phoneSearchCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const candidates = new Set<string>();

  candidates.add(raw.trim());   // exact input (trimmed)
  candidates.add(digits);       // raw digits

  if (digits.length === 10) {
    candidates.add(`+1${digits}`);
    candidates.add(`1${digits}`);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    candidates.add(`+${digits}`);
    candidates.add(digits.slice(1)); // 10-digit without leading 1
  }

  return [...candidates].filter(Boolean);
}
