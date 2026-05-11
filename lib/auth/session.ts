import { createHmac, timingSafeEqual } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Cookie name used for the staff session. Defined here so all phases use
 *  the same constant — cookie setting/reading is implemented in Phase 3+. */
export const STAFF_SESSION_COOKIE = "staff_session";

/** Default session lifetime: 8 hours. */
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

// ── Environment ───────────────────────────────────────────────────────────────

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_SECRET environment variable.");
  }
  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters for adequate HMAC security."
    );
  }
  return secret;
}

// ── Payload type ──────────────────────────────────────────────────────────────

export interface StaffSessionPayload {
  /** Primary key of the StaffUser record. */
  staffUserId: number;
  /** Unix timestamp (ms) at which the session expires. */
  expiresAt: number;
}

// ── Token format ──────────────────────────────────────────────────────────────
//
//   token = <payload_b64url> + "." + <sig_b64url>
//
//   payload_b64url  = base64url( JSON.stringify(StaffSessionPayload) )
//   sig_b64url      = base64url( HMAC-SHA256( SESSION_SECRET, payload_b64url ) )
//
//   Verification: re-derive sig from payload, compare with timing-safe equal,
//   then check expiresAt.  No database lookup required.

function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(str: string): Buffer {
  // Pad back to standard base64 length
  const padded = str + "===".slice(0, (4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// ── Build payload ─────────────────────────────────────────────────────────────

/**
 * Create a session payload for the given staff user.
 * Does NOT sign or serialize — call signStaffSessionToken for the full token.
 */
export function createStaffSessionPayload(
  staffUserId: number,
  durationMs = SESSION_DURATION_MS
): StaffSessionPayload {
  return {
    staffUserId,
    expiresAt: Date.now() + durationMs,
  };
}

// ── Sign ──────────────────────────────────────────────────────────────────────

/**
 * Serialize and HMAC-sign a StaffSessionPayload.
 * Returns the opaque token string suitable for storing in a cookie.
 *
 * Reads SESSION_SECRET from environment at call time — throws if missing.
 */
export function signStaffSessionToken(payload: StaffSessionPayload): string {
  const secret = getSessionSecret();

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(Buffer.from(payloadJson, "utf8"));

  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const sigB64 = toBase64Url(sig);

  return `${payloadB64}.${sigB64}`;
}

// ── Verify ────────────────────────────────────────────────────────────────────

export type VerifyResult =
  | { valid: true; payload: StaffSessionPayload }
  | { valid: false; reason: "malformed" | "invalid_signature" | "expired" };

/**
 * Verify an HMAC-signed staff session token.
 *
 * Checks:
 *   1. Token has exactly two dot-separated parts.
 *   2. HMAC signature matches (timing-safe comparison).
 *   3. Session has not expired.
 *
 * Returns a discriminated union — never throws.
 */
export function verifyStaffSessionToken(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed" };
  }

  const [payloadB64, sigB64] = parts;

  // Re-derive expected signature
  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
  const expectedSigB64 = toBase64Url(expectedSig);

  // Timing-safe comparison of base64url strings (compare as Buffers)
  const actualBuf = Buffer.from(sigB64, "utf8");
  const expectedBuf = Buffer.from(expectedSigB64, "utf8");

  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return { valid: false, reason: "invalid_signature" };
  }

  // Decode and parse payload
  let payload: StaffSessionPayload;
  try {
    const payloadJson = fromBase64Url(payloadB64).toString("utf8");
    payload = JSON.parse(payloadJson) as StaffSessionPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  // Check expiry
  if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
