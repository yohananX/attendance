/**
 * POST /api/sign-out — sign a child out (one-tap from the dashboard)
 *
 * Validates the session cookie, checks the target session, then records the
 * sign-out as an immutable attendance event through the sanctioned atomic
 * ingest path (`ingest_attendance_event()`), which persists the event, applies
 * the session projection and commits any conflict audit row in one database
 * transaction. The route never calls `sessions_apply_projection()` directly,
 * so a sign-out can no longer change the session without its event.
 *
 * The legacy contract has no client event identity or device timestamp: the
 * event id and capture time default to the server clock at request time. A
 * caller that captured the tap on a device may send `eventId`,
 * `deviceEventAt`, `deviceId`, `deviceSeq` and `capturedOffline`. Because an
 * event id is the ingestion idempotency key and its timestamp is immutable,
 * `eventId` must be sent together with `deviceEventAt`; without a timestamp the
 * route generates a new id and the server clock is the capture time.
 *
 * A supplied `deviceEventAt` is held to the same acceptance window as
 * `/api/events` (shared helper, PD-D1 configuration from `app_settings`): its
 * Lagos day must match the session's day key, it may not exceed the configured
 * future tolerance, and it may not fall outside the late-sync window. Rejected
 * timestamps return 422 and never reach the ingest RPC. No timestamp is ever
 * clamped or rewritten to force acceptance.
 *
 * Returns 401 without a valid session, 400 for a malformed/invalid body, 404
 * for an unknown session, 409 when a reused event id identifies a different
 * event, 422 for a timestamp outside the acceptance window, 503 when Supabase
 * is not configured, 500 when the ingest transaction fails, and 200 otherwise.
 * Signing out an already-signed-out child is idempotent: it returns the
 * canonical stored sign-out without ingesting a second event.
 */

export const dynamic = "force-dynamic";

import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { ingestAttendanceEvent } from "@/lib/supabase/rpc";
import { SESSION_COOKIE_NAME, getCookie, validateSession } from "@/lib/session";
import {
  acceptanceConfigFromSettings,
  checkEventAcceptance,
} from "@/lib/event-acceptance";

interface SessionRow {
  session_ref: string;
  day_key: string;
  signed_out_at: string | null;
  signed_out_by: string | null;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

interface SignOutBody {
  sessionRef?: unknown;
  eventId?: unknown;
  deviceEventAt?: unknown;
  deviceId?: unknown;
  deviceSeq?: unknown;
  capturedOffline?: unknown;
}

export async function POST(req: Request) {
  const serverTime = new Date().toISOString();

  const token = getCookie(req, SESSION_COOKIE_NAME);
  const session = token ? validateSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: "unauthenticated", serverTime }, { status: 401 });
  }

  let body: SignOutBody;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
    }
    body = parsed as SignOutBody;
  } catch {
    return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
  }

  const sessionRef = body.sessionRef;
  if (typeof sessionRef !== "string" || sessionRef.length === 0) {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }
  // A non-UUID reference cannot name a session row. Answer as unknown (the
  // legacy contract) rather than letting a database cast error become a 500.
  if (!isUuid(sessionRef)) {
    return NextResponse.json({ error: "unknown_session", serverTime }, { status: 404 });
  }

  // Optional device-supplied identity/timestamp fields are validated when
  // present so an invalid value can never reach the ingest RPC.
  if (body.eventId !== undefined && !isUuid(body.eventId)) {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }
  if (body.deviceEventAt !== undefined && !isIsoTimestamp(body.deviceEventAt)) {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }
  if (body.deviceId !== undefined && !isUuid(body.deviceId)) {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }
  if (
    body.deviceSeq !== undefined &&
    (typeof body.deviceSeq !== "number" || !Number.isInteger(body.deviceSeq))
  ) {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }
  if (body.capturedOffline !== undefined && typeof body.capturedOffline !== "boolean") {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }

  // An event id without its immutable device timestamp could not be replayed
  // idempotently (the server clock would differ on retry), so require the pair.
  if (body.eventId !== undefined && body.deviceEventAt === undefined) {
    return NextResponse.json({ error: "schema_invalid", serverTime }, { status: 400 });
  }

  let supabase;
  try {
    supabase = getServerSupabaseClient();
  } catch {
    return NextResponse.json({ error: "supabase_not_configured", serverTime }, { status: 503 });
  }

  // Target-session validation is preserved: an unknown session is never
  // allowed to create a provisional row through this legacy endpoint.
  const { data: rows, error: lookupError } = await supabase
    .from("sessions")
    .select("session_ref, day_key, signed_out_at, signed_out_by")
    .eq("session_ref", sessionRef)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "sign_out_failed", serverTime }, { status: 500 });
  }

  if (!rows) {
    return NextResponse.json({ error: "unknown_session", serverTime }, { status: 404 });
  }

  const sessionRow = rows as unknown as SessionRow;

  // Already signed out: idempotent no-op, matches "sign out once" behaviour.
  // No event is created because the accepted sign-out already has one.
  if (sessionRow.signed_out_at !== null) {
    return NextResponse.json({
      sessionRef,
      signedOutAt: sessionRow.signed_out_at,
      signedOutBy: sessionRow.signed_out_by,
      alreadySignedOut: true,
      serverTime,
    });
  }

  const hasDeviceTimestamp = isIsoTimestamp(body.deviceEventAt);
  const deviceEventAt = hasDeviceTimestamp
    ? new Date(body.deviceEventAt as string).toISOString()
    : serverTime;

  // A caller-supplied capture time must satisfy the same PD-D1 acceptance
  // window as /api/events, against this session's day key. The legacy
  // server-clock default is not re-dated or checked against the session day.
  if (hasDeviceTimestamp) {
    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value");
    const rejection = checkEventAcceptance({
      deviceEventAt,
      dayKey: sessionRow.day_key,
      serverReceivedAt: new Date(serverTime),
      config: acceptanceConfigFromSettings(settings),
    });
    if (rejection) {
      return NextResponse.json(
        { error: rejection.reason, message: rejection.message, serverTime },
        { status: 422 },
      );
    }
  }

  const eventId: string =
    typeof body.eventId === "string" ? body.eventId : randomUUID();
  const deviceId: string = typeof body.deviceId === "string" ? body.deviceId : eventId;
  const deviceSeq: number = typeof body.deviceSeq === "number" ? body.deviceSeq : 1;

  const queuedDurationMs = Math.max(
    0,
    new Date(serverTime).getTime() - new Date(deviceEventAt).getTime(),
  );

  let acknowledgement;
  try {
    acknowledgement = await ingestAttendanceEvent({
      eventId,
      eventType: "sign_out",
      sessionRef,
      dayKey: sessionRow.day_key,
      // A sign-out carries no student identity; the projection already knows it.
      studentName: null,
      parentPhone: null,
      deviceEventAt,
      serverReceivedAt: serverTime,
      queuedDuration: `${queuedDurationMs} milliseconds`,
      capturedOffline: body.capturedOffline === true,
      deviceId,
      deviceSeq,
      staffName: session.staffName,
    });
  } catch (error) {
    // A reused event id that belongs to another logical event is a client
    // conflict, not a database outage. The transaction raised before writing,
    // so the original event and projection are untouched.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("event_id_reuse_mismatch")) {
      return NextResponse.json(
        {
          error: "event_id_conflict",
          message: "This event id already belongs to a different attendance event.",
          serverTime,
        },
        { status: 409 },
      );
    }
    // The ingest transaction rolled back, so nothing was persisted. Never
    // report success when the event/projection did not commit.
    return NextResponse.json({ error: "sign_out_failed", serverTime }, { status: 500 });
  }

  // The canonical projection is authoritative: a duplicate or a competing
  // sign-out must return the stored (winning) sign-out, not this request's
  // timestamp, and must not claim a second accepted sign-out.
  const projection = acknowledgement.projection;
  const signedOutAt = projection?.signed_out_at ?? deviceEventAt;
  const signedOutBy = projection?.signed_out_by ?? session.staffName;
  const alreadySignedOut = acknowledgement.result !== "accepted";

  return NextResponse.json({
    sessionRef,
    signedOutAt,
    signedOutBy,
    eventId,
    alreadySignedOut,
    ...(acknowledgement.result === "conflict" ? { conflict: true } : {}),
    serverTime,
  });
}
