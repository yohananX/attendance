/**
 * Server-only session cookie helpers for staff authentication.
 *
 * This module is guarded by the `server-only` package: importing it from a
 * client component fails the production build, so SESSION_SECRET can never
 * reach browser code, page source or client bundles (SYSTEM_ARCHITECTURE
 * §4.7, S2/S3, AC-G1).
 *
 * The session cookie value is a signed descriptor: `{staffName, iat, exp}`
 * serialized as JSON, followed by an HMAC-SHA256 signature over the payload
 * using SESSION_SECRET. The cookie value never contains the PIN or the
 * session secret itself (S5).
 *
 * Session lifetime is 12 hours (FR-02/S1).
 */
import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "session";
const SESSION_DURATION_SECONDS = 12 * 60 * 60; // 12 hours

/** Shape of the signed session descriptor (never contains PIN or secret material). */
export interface SessionDescriptor {
  staffName: string;
  iat: number;
  exp: number;
}

/** Read and validate SESSION_SECRET. Lazily validated at call time so `next
 * build` succeeds without secrets present (CI without secrets). */
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured. See .env.example.");
  }
  return secret;
}

/** Sign a session descriptor and return the cookie value (payload.signature). */
export function createSessionCookie(staffName: string): string {
  const secret = getSessionSecret();
  const now = Math.floor(Date.now() / 1000);
  const descriptor: SessionDescriptor = {
    staffName,
    iat: now,
    exp: now + SESSION_DURATION_SECONDS,
  };
  const payload = JSON.stringify(descriptor);
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Constant-time HMAC verification of a session cookie value.
 *
 * Returns { staffName } when the signature is valid and the session has not
 * expired; null otherwise. Never leaks whether failure was due to a bad
 * signature or an expired session.
 */
export function validateSessionCookie(
  cookieValue: string,
): { staffName: string } | null {
  const secret = getSessionSecret();

  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex <= 0) {
    return null;
  }

  const payload = cookieValue.slice(0, dotIndex);
  const signature = cookieValue.slice(dotIndex + 1);

  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  // Constant-time comparison: decode both sides, require equal length, then
  // compare with timingSafeEqual. A length mismatch returns null without
  // revealing which side was longer.
  const expectedBuf = Buffer.from(expected, "base64url");
  const sigBuf = Buffer.from(signature, "base64url");
  if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
    return null;
  }

  let descriptor: SessionDescriptor;
  try {
    descriptor = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    !descriptor ||
    typeof descriptor.staffName !== "string" ||
    descriptor.staffName.length === 0 ||
    typeof descriptor.iat !== "number" ||
    typeof descriptor.exp !== "number"
  ) {
    return null;
  }

  // Expired sessions are invalid. Use the same null return as a bad signature
  // so the failure reason cannot be distinguished (timing-safe).
  if (Date.now() > descriptor.exp * 1000) {
    return null;
  }

  return { staffName: descriptor.staffName };
}

/** Returns a Set-Cookie header value that clears the session cookie. */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}
