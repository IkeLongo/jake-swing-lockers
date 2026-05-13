import { createHmac, timingSafeEqual } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Cookie name used for the swing locker customer session. */
export const SWING_LOCKER_SESSION_COOKIE = "swing_locker_session";

/** Default session lifetime: 24 hours. */
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

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

export interface SwingLockerSessionPayload {
  /** Primary key of the GolfClient record. */
  golfClientId: number;
  /** Unix timestamp (ms) at which the session expires. */
  expiresAt: number;
}

// ── Token format ──────────────────────────────────────────────────────────────
//
//   token = <payload_b64url> + "." + <sig_b64url>
//
//   payload_b64url  = base64url( JSON.stringify(SwingLockerSessionPayload) )
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
  const padded = str + "===".slice(0, (4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// ── Build payload ─────────────────────────────────────────────────────────────

export function createSwingLockerSessionPayload(
  golfClientId: number,
  durationMs = SESSION_DURATION_MS
): SwingLockerSessionPayload {
  return {
    golfClientId,
    expiresAt: Date.now() + durationMs,
  };
}

// ── Sign ──────────────────────────────────────────────────────────────────────

export function signSwingLockerSessionToken(
  payload: SwingLockerSessionPayload
): string {
  const secret = getSessionSecret();

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(Buffer.from(payloadJson, "utf8"));

  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  const sigB64 = toBase64Url(sig);

  return `${payloadB64}.${sigB64}`;
}

// ── Verify ────────────────────────────────────────────────────────────────────

export type SwingLockerVerifyResult =
  | { valid: true; payload: SwingLockerSessionPayload }
  | { valid: false; reason: "malformed" | "invalid_signature" | "expired" };

export function verifySwingLockerSessionToken(
  token: string
): SwingLockerVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed" };
  }

  const [payloadB64, sigB64] = parts;

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
  const expectedSigB64 = toBase64Url(expectedSig);

  const actualBuf = Buffer.from(sigB64, "utf8");
  const expectedBuf = Buffer.from(expectedSigB64, "utf8");

  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return { valid: false, reason: "invalid_signature" };
  }

  let payload: SwingLockerSessionPayload;
  try {
    const json = fromBase64Url(payloadB64).toString("utf8");
    payload = JSON.parse(json) as SwingLockerSessionPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (Date.now() > payload.expiresAt) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
