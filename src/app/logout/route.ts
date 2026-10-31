/**
 * POST /api/logout — clear the session cookie and redirect to /login.
 *
 * Clears the HttpOnly session cookie so the browser no longer sends it on
 * subsequent requests, then redirects to the login page. No secrets are
 * read, logged or returned.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/session";

export async function POST(req: Request): Promise<Response> {
  return NextResponse.redirect(new URL("/login", req.url), {
    status: 303,
    headers: { "Set-Cookie": clearSessionCookie() },
  });
}
