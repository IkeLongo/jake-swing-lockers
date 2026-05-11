import { createHash, randomInt, timingSafeEqual } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const OTP_LENGTH = 6;
const OTP_MAX = 10 ** OTP_LENGTH; // 1_000_000

// ── Generate ──────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure 6-digit OTP string.
 * Zero-padded to always be exactly 6 characters (e.g. "007431").
 *
 * Uses crypto.randomInt which draws from the OS CSPRNG.
 */
export function generateOtp(): string {
  // randomInt(max) returns a value in [0, max)
  const code = randomInt(OTP_MAX);
  return code.toString().padStart(OTP_LENGTH, "0");
}

// ── Hash ──────────────────────────────────────────────────────────────────────

/**
 * Hash a plaintext OTP code with SHA-256 for storage.
 * Returns a hex digest string.
 *
 * OTP codes are short-lived single-use values.  SHA-256 (without salt) is
 * acceptable here because:
 *   - codes expire in 10 minutes
 *   - codes are single-use (usedAt is set on first verify)
 *   - the 6-digit keyspace is not a secret — it is the expiry and single-use
 *     constraints that provide the security guarantee
 */
export function hashOtp(plaintextCode: string): string {
  return createHash("sha256").update(plaintextCode).digest("hex");
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verify a submitted plaintext OTP code against a stored SHA-256 hash.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Returns true if the code matches.
 */
export function verifyOtpHash(
  plaintextCode: string,
  storedHash: string
): boolean {
  const candidateHash = hashOtp(plaintextCode);

  // Both are hex strings of the same fixed length (64 chars for SHA-256).
  // Encode to Buffer for timingSafeEqual.
  const candidateBuf = Buffer.from(candidateHash, "hex");
  const storedBuf = Buffer.from(storedHash, "hex");

  if (candidateBuf.length !== storedBuf.length) {
    // Lengths differ — return false without leaking timing information.
    return false;
  }

  return timingSafeEqual(candidateBuf, storedBuf);
}
