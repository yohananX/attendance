/**
 * POST /api/login — staff login (E1).
 *
 * Verifies the server-held PIN and, on success, issues a signed HTTP-only
 * session cookie (12 h) stamping the staff name. The cookie is required on
 * every other server API call; the client-supplied staffName is informational
 * only and is what gets stamped on events (architecture §4.1–4.2, PD-D4).
 *
 * Rate limiting and the Ed25519 session descriptor (T3.2) are deferred to the
 * full login task; this is the minimal cookie gate needed for sign-out (T6).
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import {
  SESSION_COOKIE_NAME,
  signSession,
  sessionCookieAttributes,
} from "@/lib/session";
import { getAttendanceDatasetId } from "@/lib/attendance-dataset";

export async function POST(req: Request) {
  const serverTime = new Date().toISOString();

  let body: { staffName?: unknown; pin?: unknown; deviceId?: unknown };
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
    }
    body = parsed as { staffName?: unknown; pin?: unknown; deviceId?: unknown };
  } catch {
    return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
  }

  const { staffName, pin, deviceId } = body;
  if (
    typeof staffName !== "string" ||
    staffName.trim().length === 0 ||
    staffName.trim().length > 100 ||
    typeof pin !== "string" ||
    !/^[0-9]{6,32}$/.test(pin) ||
    typeof deviceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)
  ) {
    return NextResponse.json({ error: "blank_fields", serverTime }, { status: 400 });
  }

  const expectedPin = process.env.STAFF_PIN?.trim();
  if (!expectedPin || !/^[0-9]{6,32}$/.test(expectedPin)) {
    return NextResponse.json({ error: "server_not_configured", serverTime }, { status: 503 });
  }

  // Constant-time PIN comparison (FR-01, S5).
  const pinBuf = Buffer.from(pin, "utf8");
  const expectedBuf = Buffer.from(expectedPin, "utf8");
  let authorized = false;
  if (pinBuf.length === expectedBuf.length) {
    authorized = timingSafeEqual(pinBuf, expectedBuf);
  }
  if (!authorized) {
    return NextResponse.json({ error: "invalid_pin", serverTime }, { status: 401 });
  }

  const datasetId = getAttendanceDatasetId();
  if (!datasetId) {
    return NextResponse.json({ error: "dataset_not_configured", serverTime }, { status: 503 });
  }

  let token: string;
  try {
    token = signSession(staffName.trim());
  } catch {
    return NextResponse.json({ error: "server_not_configured", serverTime }, { status: 503 });
  }
  const cookie = `${SESSION_COOKIE_NAME}=${token}; ${sessionCookieAttributes()}`;
  const sessionExpiresAt = Date.now() + 12 * 60 * 60 * 1000;

  return NextResponse.json(
    { staffName: staffName.trim(), expiresAt: sessionExpiresAt, datasetId, serverTime },
    { status: 200, headers: { "set-cookie": cookie, "cache-control": "no-store" } },
  );
}
