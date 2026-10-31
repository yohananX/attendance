/**
 * Server-level session cookie and Lagos date helpers.
 *
 * Cookie format (architecture §4.2): the session cookie value is a signed
 * descriptor `{staffName, iat, exp}` serialized as JSON, followed by an
 * HMAC-SHA256 signature over the payload using SESSION_SECRET
 * (`payload.signature`, base64url). Cookie lifetime is 12 hours (FR-02/S1).
 *
 * `iat`/`exp` are epoch milliseconds so the client and server can compare
 * against `Date.now()` directly.
 *
 * This module is guarded by the `server-only` package: SESSION_SECRET never
 * reaches browser code, page source or client bundles (S2, AC-G1).
 *
 * Validation is lazy (reads process.env at call time) so `next build`
 * succeeds without secrets present.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

// Africa/Lagos is UTC+1 with no DST.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

function getSessionSecret(): string | null {
  return process.env.SESSION_SECRET?.trim() ?? null;
}

function buildToken(staffName: string, secret: string): string {
  const now = Date.now();
  const payload = JSON.stringify({ staffName, iat: now, exp: now + SESSION_MAX_AGE_SECONDS * 1000 });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  // Sign the raw payload string and base64url the raw digest bytes.
  const signature = createHmac("sha256", secret).update(payload).digest().toString("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Create a signed session token. Returns `null` when SESSION_SECRET is
 * missing (secure default — no token is issued without a secret).
 */
export function createSessionToken(staffName: string): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  return buildToken(staffName, secret);
}

/** Sign a session descriptor and return the cookie token. Throws when SESSION_SECRET is missing. */
export function signSession(staffName: string): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured. See .env.example.");
  }
  return buildToken(staffName, secret);
}

/** Cookie attributes appended to the token in the Set-Cookie header. */
export function sessionCookieAttributes(): string {
  const secure = process.env.NODE_ENV === "production";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${
    secure ? "; Secure" : ""
  }`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    secure ? "; Secure" : ""
  }`;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

/**
 * Constant-time verification of a session token.
 * Returns { staffName, issuedAt, expiresAt } (epoch ms) when the signature is
 * valid and the session has not expired; null otherwise. Never distinguishes
 * a bad signature from expiry.
 */
export function validateSessionToken(
  token: string,
): { staffName: string; issuedAt: number; expiresAt: number } | null {
  try {
    const secret = getSessionSecret();
    if (!secret) return null;

    const dotIndex = token.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === token.length - 1) return null;

    const payloadB64 = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);

    const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    const expected = createHmac("sha256", secret).update(payload).digest().toString("base64url");

    const expectedBuf = Buffer.from(expected, "base64url");
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    const sigBuf = Buffer.from(signature, "base64url");
    if (
      expectedBuf.length !== sigBuf.length ||
      sigBuf.toString("base64url") !== signature ||
      !timingSafeEqual(expectedBuf, sigBuf)
    ) {
      return null;
    }

    let descriptor: { staffName: unknown; iat: unknown; exp: unknown };
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

    if (Date.now() > descriptor.exp) return null;

    return {
      staffName: descriptor.staffName,
      issuedAt: descriptor.iat,
      expiresAt: descriptor.exp,
    };
  } catch {
    return null;
  }
}

/** Alias of `validateSessionToken` used by some route handlers. */
export const validateSession = validateSessionToken;

/** Read a cookie by name from the Cookie header. */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1);
    if (key === name) return value;
  }
  return undefined;
}

/**
 * Read the session cookie from an incoming Request and return the staff name,
 * or null when there is no valid session (401 territory for callers).
 */
export function getStaffName(req: Request): string | null {
  try {
    const cookieHeader = req.headers.get("cookie");
    if (!cookieHeader) return null;

    const name = getSessionCookieName() + "=";
    let token: string | undefined;
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      const key = eq === -1 ? part.trim() : part.slice(0, eq).trim();
      if (key === name.slice(0, -1)) {
        token = eq === -1 ? "" : part.slice(eq + 1);
        break;
      }
    }
    if (!token) return null;

    return validateSessionToken(token)?.staffName ?? null;
  } catch {
    return null;
  }
}

/**
 * Africa/Lagos calendar date (UTC+1, no DST) of an ISO-8601 instant, as
 * `YYYY-MM-DD`. Used to recompute and verify the client's day key.
 */
export function lagosDateKey(isoString: string): string | null {
  const ms = new Date(isoString).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole-day difference between two `YYYY-MM-DD` Lagos dates (a - b). */
export function lagosDayDifference(dayKey: string, serverLagosDay: string): number {
  const a = new Date(`${dayKey}T00:00:00Z`).getTime();
  const b = new Date(`${serverLagosDay}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}
