/**
 * POST /api/sign-out — sign a child out (one-tap from the dashboard)
 *
 * Validates the session cookie, then records the sign-out through the
 * sanctioned projection path (`sessions_apply_projection`), which sets
 * `signed_out_at` once (a second tap is a no-op because the update is
 * guarded by `signed_out_at IS NULL`). The time comes from the server clock.
 *
 * Returns 401 without a valid session, 404 for an unknown session, 200
 * otherwise (idempotent: signing out an already-signed-out child succeeds
 * without changing anything).
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { SESSION_COOKIE_NAME, getCookie, validateSession } from "@/lib/session";

interface SessionRow {
  session_ref: string;
  day_key: string;
  student_name: string;
  parent_phone: string;
  signed_out_at: string | null;
  signed_out_by: string | null;
}

export async function POST(req: Request) {
  const serverTime = new Date().toISOString();

  const token = getCookie(req, SESSION_COOKIE_NAME);
  const session = token ? validateSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: "unauthenticated", serverTime }, { status: 401 });
  }

  let body: { sessionRef?: unknown };
  try {
    body = (await req.json()) as { sessionRef?: unknown };
  } catch {
    return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
  }

  const sessionRef = body.sessionRef;
  if (typeof sessionRef !== "string" || sessionRef.length === 0) {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getServerSupabaseClient();
  } catch {
    return NextResponse.json({ error: "supabase_not_configured", serverTime }, { status: 503 });
  }

  const { data: rows } = await supabase
    .from("sessions")
    .select("session_ref, day_key, student_name, parent_phone, signed_out_at, signed_out_by")
    .eq("session_ref", sessionRef)
    .maybeSingle();

  if (!rows) {
    return NextResponse.json({ error: "unknown_session", serverTime }, { status: 404 });
  }

  // Already signed out: idempotent no-op, matches "sign out once" behaviour.
  if (rows.signed_out_at !== null) {
    return NextResponse.json({
      sessionRef,
      signedOutAt: rows.signed_out_at,
      signedOutBy: rows.signed_out_by,
      alreadySignedOut: true,
      serverTime,
    });
  }

  const signedOutAt = new Date().toISOString();

  const { error } = await supabase.rpc("sessions_apply_projection", {
    p_session_ref: sessionRef,
    p_day_key: rows.day_key,
    p_student_name: rows.student_name,
    p_parent_phone: rows.parent_phone,
    p_event_type: "sign_out",
    p_event_at: signedOutAt,
    p_staff_name: session.staffName,
  });

  if (error) {
    return NextResponse.json({ error: "sign_out_failed", serverTime }, { status: 500 });
  }

  return NextResponse.json({
    sessionRef,
    signedOutAt,
    signedOutBy: session.staffName,
    serverTime,
  });
}
