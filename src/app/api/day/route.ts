/**
 * GET /api/day — day cache sync (API contract v1.0 §8, E3).
 *
 * Query: ?dayKey=YYYY-MM-DD (defaults to the current Africa/Lagos day).
 * Returns every session row for that dayKey plus outstanding messages,
 * counts, and an advisory serverTime. Requires a valid session cookie;
 * missing/invalid/expired cookie → 401.
 */

export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { SESSION_COOKIE_NAME, validateSessionToken } from "@/lib/session";

interface SessionRow {
  session_ref: string;
  student_name: string;
  parent_phone: string;
  day_key: string;
  signed_in_at: string | null;
  signed_out_at: string | null;
  signed_in_by: string | null;
  signed_out_by: string | null;
  server_version: number;
  corrected: boolean;
  conflict_type: string | null;
  late_synced: boolean;
  needs_review: boolean;
  whatsapp_launched_at: string | null;
}

interface SessionSnapshot {
  sessionRef: string;
  studentName: string;
  parentPhone: string;
  dayKey: string;
  signedInAt: string | null;
  signedOutAt: string | null;
  signedInBy: string | null;
  signedOutBy: string | null;
  serverVersion: number;
  corrected: boolean;
  conflictType: string | null;
  lateSynced: boolean;
  needsReview: boolean;
  whatsappLaunchedAt: string | null;
}

interface OutstandingMessage {
  sessionRef: string;
  studentName: string;
  whatsappLaunchedAt: string | null;
}

interface DayResponse {
  dayKey: string;
  sessions: SessionSnapshot[];
  outstandingMessages: OutstandingMessage[];
  counts: { inSchool: number; signedOut: number; outstandingMessages: number };
  serverTime: string;
}

/** Current Africa/Lagos calendar date as YYYY-MM-DD (Lagos is UTC+1, no DST). */
function lagosDayKey(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Lagos",
  }); // en-CA date format is YYYY-MM-DD
}

function mapSession(row: SessionRow): SessionSnapshot {
  return {
    sessionRef: row.session_ref,
    studentName: row.student_name,
    parentPhone: row.parent_phone,
    dayKey: row.day_key,
    signedInAt: row.signed_in_at,
    signedOutAt: row.signed_out_at,
    signedInBy: row.signed_in_by,
    signedOutBy: row.signed_out_by,
    serverVersion: row.server_version,
    corrected: row.corrected,
    conflictType: row.conflict_type,
    lateSynced: row.late_synced,
    needsReview: row.needs_review,
    whatsappLaunchedAt: row.whatsapp_launched_at,
  };
}

export async function GET(req: Request): Promise<Response> {
  const serverTime = new Date().toISOString();

  // --- Session validation (architecture §4.7: cookie required on every data endpoint) ---
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? validateSessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "unauthenticated", serverTime }, { status: 401 });
  }

  const url = new URL(req.url);
  const dayKey = url.searchParams.get("dayKey") || lagosDayKey();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return NextResponse.json(
      { error: "schema_invalid", serverTime, message: "dayKey must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  let supabase;
  try {
    supabase = getServerSupabaseClient();
  } catch {
    return NextResponse.json(
      { error: "supabase_not_configured", serverTime },
      { status: 503 },
    );
  }

  const { data: rows, error } = await supabase
    .from("sessions")
    .select(
      "session_ref, student_name, parent_phone, day_key, signed_in_at, " +
        "signed_out_at, signed_in_by, signed_out_by, server_version, " +
        "corrected, conflict_type, late_synced, needs_review, whatsapp_launched_at",
    )
    .eq("day_key", dayKey)
    .order("signed_in_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "query_failed", serverTime }, { status: 500 });
  }

  const sessions = ((rows ?? []) as unknown as SessionRow[]).map(mapSession);

  const inSchool = sessions.filter(
    (s) => s.signedInAt !== null && s.signedOutAt === null,
  ).length;
  const signedOut = sessions.filter((s) => s.signedOutAt !== null).length;

  const outstandingMessages: OutstandingMessage[] = sessions
    .filter((s) => s.signedOutAt !== null && s.whatsappLaunchedAt === null)
    .map((s) => ({
      sessionRef: s.sessionRef,
      studentName: s.studentName,
      whatsappLaunchedAt: s.whatsappLaunchedAt,
    }));

  const response: DayResponse = {
    dayKey,
    sessions,
    outstandingMessages,
    counts: { inSchool, signedOut, outstandingMessages: outstandingMessages.length },
    serverTime,
  };

  return NextResponse.json(response, { status: 200 });
}
