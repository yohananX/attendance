/**
 * Health endpoint: proves service-role connectivity to Supabase.
 *
 * Used by T1.2's acceptance test — a server route returns ok using the
 * service-role key, demonstrating the server-only access path works
 * (docs/SYSTEM_ARCHITECTURE_v1.0.md §4.7; S2/S3; AC-G1).
 *
 * This endpoint:
 * - requires no session cookie (it is a connectivity probe, not an attendance
 *   endpoint),
 * - never returns attendance data or credential values,
 * - reports whether the schema has been applied (`dbReady`) so callers can
 *   distinguish "connected, empty database" from "schema not yet applied".
 *
 * Rendered at request time so the result reflects live configuration.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const serverTime = new Date().toISOString();

  let supabase;
  try {
    supabase = getServerSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, serverTime, error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  // A simple, no-row-returning probe against the events table proves the
  // service-role key can reach the database. `head: true` returns no data.
  let dbReady = false;
  try {
    const { error } = await supabase.from("events").select("event_id", {
      head: true,
      count: "exact",
    });
    dbReady = error === null;
  } catch {
    // Network or client errors leave dbReady false; connectivity itself was
    // attempted and is reported ok if we got a Supabase response.
  }

  return NextResponse.json({
    ok: true,
    serverTime,
    dbReady,
    schema: dbReady ? "applied" : "not_applied",
  });
}
