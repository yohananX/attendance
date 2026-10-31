/**
 * POST /api/events — batch event ingestion (E2).
 *
 * Accepts a batch of sign_in / sign_out events, authenticates via the session
 * cookie (reusing T3's session validation from @/lib/session), validates each
 * event (schema, parentPhone normalisation, acceptance window), applies the
 * sanctioned projection via sessions_apply_projection(), inserts an append-only
 * event row, and returns one per-event result (accepted / duplicate / rejected
 * / conflict).
 *
 * Pipeline per API_CONTRACT_v1.0.md §4 / DATABASE_CONTRACT_v1.0.md §3:
 *   1. Session cookie validation — invalid cookie stops the whole request (401).
 *   2. Batch limits: ≤ 50 events and ≤ 128 KB per request.
 *   3. Per event: schema validation → parentPhone normalisation (FR-06) →
 *      acceptance window (server-recomputed Lagos dayKey, future tolerance,
 *      late-sync window from app_settings — PD-D1, configurable, never
 *      hard-coded) → idempotency lookup on eventId → sanctioned projection via
 *      sessions_apply_projection() → event row insert.
 *
 * HTTP 200 whenever the batch was authenticated and well-formed; every event
 * carries a per-event result. Partial failure is per-event, never
 * all-or-nothing (architecture §5.5).
 *
 * The sessions table mutability guard blocks direct UPDATEs, so projection
 * writes go only through sessions_apply_projection() (see
 * src/lib/supabase/rpc.ts). PD-D2 partial unique indexes defend against a
 * second accepted sign_in/sign_out per session.
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getServerSupabaseClient, SupabaseConfigError } from "@/lib/supabase/server";
import { applySessionProjection } from "@/lib/supabase/rpc";
import { getStaffName, lagosDateKey, lagosDayDifference } from "@/lib/session";
import { normalizePhone } from "@/lib/phone";

const MAX_BATCH_EVENTS = 50;
const MAX_BATCH_BYTES = 128 * 1024;

type EventResultStatus = "accepted" | "duplicate" | "rejected" | "conflict";

interface EventResult {
  eventId: string;
  result: EventResultStatus;
  reason?: string;
  message?: string;
  serverReceivedAt?: string;
  projection?: Record<string, unknown> | null;
}

interface IngestConfig {
  lateSyncWindowDays: number;
  futureToleranceMinutes: number;
}

interface SessionRow {
  session_ref: string;
  day_key: string;
  student_name: string;
  parent_phone: string;
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

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function rejected(eventId: string, reason: string, message: string): EventResult {
  return { eventId, result: "rejected", reason, message };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function ingestEvent(
  supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>,
  raw: Record<string, unknown>,
  staffName: string,
  config: IngestConfig,
  serverReceivedAt: Date,
): Promise<EventResult> {
  const receiptMs = serverReceivedAt.getTime();
  const serverLagosDay = lagosDateKey(serverReceivedAt.toISOString()) ?? new Date().toISOString().slice(0, 10);

  const eventId = raw.eventId;
  if (typeof eventId !== "string" || !isUuid(eventId)) {
    return rejected(String(eventId ?? ""), "schema_invalid", "eventId must be a UUID");
  }

  const eventType = raw.eventType;
  if (eventType !== "sign_in" && eventType !== "sign_out") {
    return rejected(eventId, "event_type_invalid", "eventType must be sign_in or sign_out");
  }

  if (!isUuid(raw.sessionRef)) {
    return rejected(eventId, "schema_invalid", "sessionRef must be a UUID");
  }
  if (!isIsoTimestamp(raw.deviceEventAt)) {
    return rejected(eventId, "schema_invalid", "deviceEventAt must be an ISO-8601 timestamp");
  }
  if (!isUuid(raw.deviceId)) {
    return rejected(eventId, "schema_invalid", "deviceId must be a UUID");
  }
  if (typeof raw.deviceSeq !== "number" || !Number.isInteger(raw.deviceSeq)) {
    return rejected(eventId, "schema_invalid", "deviceSeq must be an integer");
  }
  if (!isDayKey(raw.dayKey)) {
    return rejected(eventId, "schema_invalid", "dayKey must be YYYY-MM-DD");
  }

  let studentName: string | null = null;
  let parentPhone: string | null = null;
  if (eventType === "sign_in") {
    if (typeof raw.studentName !== "string" || raw.studentName.length < 1 || raw.studentName.length > 100) {
      return rejected(eventId, "schema_invalid", "studentName is required (1-100 chars)");
    }
    studentName = raw.studentName.trim();
    try {
      parentPhone = normalizePhone(raw.parentPhone as string);
    } catch {
      return rejected(
        eventId,
        "phone_unnormalisable",
        "Parent phone could not be normalised to E.164 (+234…) form.",
      );
    }
  }

  const deviceEventAt = raw.deviceEventAt as string;
  const dayKey = raw.dayKey as string;
  const deviceMs = new Date(deviceEventAt).getTime();

  // Acceptance window: server recomputes and verifies the Lagos day key.
  const eventLagosDay = lagosDateKey(deviceEventAt);
  if (!eventLagosDay || eventLagosDay !== dayKey) {
    return rejected(
      eventId,
      "day_key_mismatch",
      `Submitted dayKey ${dayKey} does not match server-recomputed Lagos date ${eventLagosDay ?? "<unparseable>"}`,
    );
  }

  // deviceEventAt not more than the configured future tolerance ahead of receipt.
  if (deviceMs > receiptMs + config.futureToleranceMinutes * 60 * 1000) {
    return rejected(
      eventId,
      "future_tolerance_exceeded",
      `deviceEventAt is more than ${config.futureToleranceMinutes} minutes ahead of server receipt`,
    );
  }

  // dayKey within the configured late-sync window (Lagos days old).
  const dayAge = lagosDayDifference(dayKey, serverLagosDay);
  if (dayAge > config.lateSyncWindowDays) {
    return rejected(
      eventId,
      "outside_late_window",
      `Event is ${dayAge} days old; permitted window is ${config.lateSyncWindowDays} days`,
    );
  }

  // Idempotency lookup on eventId: return the original acknowledgement.
  const { data: existing, error: idemError } = await supabase
    .from("events")
    .select("event_id, ingest_result, server_received_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (idemError) throw idemError;
  if (existing) {
    return {
      eventId,
      result: "duplicate",
      serverReceivedAt: existing.server_received_at as string,
      message: `Duplicate event ${eventId}; original acknowledged ${existing.server_received_at}.`,
    };
  }

  // Projection apply (sanctioned path — sets the mutation GUC, updates sessions).
  try {
    await applySessionProjection({
      sessionRef: raw.sessionRef as string,
      dayKey,
      studentName: studentName ?? "",
      parentPhone: parentPhone ?? "",
      eventType: eventType as "sign_in" | "sign_out",
      eventAt: deviceEventAt,
      staffName,
    });
  } catch (err) {
    return rejected(
      eventId,
      "processing_error",
      `Projection apply failed: ${(err as Error).message}`,
    );
  }

  // Insert the append-only event row.
  const queuedDurationMs = Math.max(0, receiptMs - deviceMs);
  const { error: insertError } = await supabase.from("events").insert({
    event_id: eventId,
    event_type: eventType,
    session_ref: raw.sessionRef,
    student_name: studentName,
    parent_phone: parentPhone,
    device_event_at: deviceEventAt,
    server_received_at: serverReceivedAt.toISOString(),
    queued_duration: `${queuedDurationMs} milliseconds`,
    captured_offline: Boolean(raw.capturedOffline),
    device_id: raw.deviceId,
    device_seq: raw.deviceSeq,
    staff_name: staffName,
    day_key: dayKey,
    conflict_marker: "none",
    ingest_result: "accepted",
  });

  if (insertError) {
    const message = String(insertError.message ?? "");
    // PD-D2 partial unique index: duplicate accepted sign_in/sign_out per session.
    if (/duplicate key|unique|one_sign_(in|out)_per_session/i.test(message)) {
      return {
        eventId,
        result: "conflict",
        reason: "competing_event",
        serverReceivedAt: serverReceivedAt.toISOString(),
        message: "A competing event already occupies this session slot.",
      };
    }
    throw insertError;
  }

  // Fetch the canonical session projection snapshot for the acknowledgement.
  const { data: session } = await supabase
    .from("sessions")
    .select(
      "session_ref, day_key, student_name, parent_phone, signed_in_at, signed_out_at, " +
        "signed_in_by, signed_out_by, server_version, corrected, conflict_type, " +
        "late_synced, needs_review, whatsapp_launched_at",
    )
    .eq("session_ref", raw.sessionRef)
    .maybeSingle();

  const sessionRow = session as unknown as SessionRow | null;

  const projection =
    sessionRow === null
      ? null
      : {
          sessionRef: sessionRow.session_ref,
          studentName: sessionRow.student_name,
          parentPhone: sessionRow.parent_phone,
          dayKey: sessionRow.day_key,
          signedInAt: sessionRow.signed_in_at,
          signedOutAt: sessionRow.signed_out_at,
          signedInBy: sessionRow.signed_in_by,
          signedOutBy: sessionRow.signed_out_by,
          serverVersion: sessionRow.server_version,
          corrected: sessionRow.corrected,
          conflictType: sessionRow.conflict_type,
          lateSynced: sessionRow.late_synced,
          needsReview: sessionRow.needs_review,
          whatsappLaunchedAt: sessionRow.whatsapp_launched_at,
        };

  return {
    eventId,
    result: "accepted",
    serverReceivedAt: serverReceivedAt.toISOString(),
    projection,
  };
}

export async function POST(req: Request): Promise<Response> {
  const serverTime = new Date().toISOString();
  const serverReceivedAt = new Date();

  // 1. Authentication — invalid cookie stops the whole request (401).
  const staffName = getStaffName(req);
  if (!staffName) {
    return NextResponse.json({ error: "unauthenticated", serverTime }, { status: 401 });
  }

  // 2. Parse the batch envelope.
  let body: { events?: unknown; probe?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
  }
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
  }

  // 3. Batch limits (architecture §5.3).
  if (body.events.length > MAX_BATCH_EVENTS) {
    return NextResponse.json({ error: "batch_too_large", serverTime }, { status: 413 });
  }
  const byteLength = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (byteLength > MAX_BATCH_BYTES) {
    return NextResponse.json({ error: "batch_too_large", serverTime }, { status: 413 });
  }

  // 4. Supabase client (service role).
  let supabase: Awaited<ReturnType<typeof getServerSupabaseClient>>;
  try {
    supabase = getServerSupabaseClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        serverTime,
        error: err instanceof SupabaseConfigError ? "supabase_not_configured" : "server_error",
      },
      { status: 503 },
    );
  }

  // 5. Load PD-D1 configuration from app_settings (never hard-coded).
  const { data: settings } = await supabase.from("app_settings").select("setting_key, setting_value");
  const byKey = Object.fromEntries((settings ?? []).map((s) => [s.setting_key, s.setting_value]));
  const config: IngestConfig = {
    lateSyncWindowDays: Number(byKey["late_sync_window_days"] ?? 7),
    futureToleranceMinutes: Number(byKey["future_tolerance_minutes"] ?? 5),
  };

  // 6. Per-event pipeline — partial failure is per-event, never all-or-nothing.
  const results: EventResult[] = [];
  for (const raw of body.events as Record<string, unknown>[]) {
    results.push(await ingestEvent(supabase, raw, staffName, config, serverReceivedAt));
  }

  // 7. Commit → then acknowledge (200 whenever authenticated and well-formed).
  return NextResponse.json({ serverTime, results }, { status: 200 });
}
