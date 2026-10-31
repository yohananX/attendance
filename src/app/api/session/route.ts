/**
 * GET /api/session — return the authenticated staff name from the session cookie.
 *
 * Used by the client UI to (a) confirm a valid session before offering
 * capture actions and (b) display who is signed in. The staff name is
 * server-stamped from the cookie; the client never supplies it.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getCookie, SESSION_COOKIE_NAME, validateSessionToken } from "@/lib/session";

export async function GET(req: Request) {
  const serverTime = new Date().toISOString();
  const token = getCookie(req, SESSION_COOKIE_NAME);
  const session = token ? validateSessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "unauthenticated", serverTime }, { status: 401 });
  }
  return NextResponse.json(
    { staffName: session.staffName, expiresAt: session.expiresAt, serverTime },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
