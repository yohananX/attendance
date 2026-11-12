/**
 * POST /api/events — batch event ingestion (E2).
 *
 * Accepts a batch of sign_in / sign_out events, authenticates via the session
 * cookie (reusing T3's session validation from @/lib/session), validates each
 * event (schema, parentPhone normalisation, acceptance window), and commits it
 * through the sanctioned atomic ingest RPC, returning one per-event result
 * (accepted / duplicate / rejected / conflict).
 *
 * Pipeline per API_CONTRACT_v1.0.md §4 / DATABASE_CONTRACT_v1.0.md §3:
 *   1. Session cookie validation — invalid cookie stops the whole request (401).
 *   2. Batch limits: ≤ 50 events and ≤ 128 KB per request.
 *   3. Per event: schema validation → parentPhone normalisation (FR-06) →
 *      acceptance window (server-recomputed Lagos dayKey, future tolerance,
 *      late-sync window from app_settings — PD-D1, configurable, never
 *      hard-coded) → one atomic ingest transaction (idempotency, conflict
 *      classification and audit, event insert, projection, review flags).
 *
 * HTTP 200 whenever the batch was authenticated and well-formed; every event
 * carries a per-event result. Partial failure is per-event, never
 * all-or-nothing (architecture §5.5).
 *
 * The sessions table mutability guard blocks direct UPDATEs, so projection
 * writes go only through ingest_attendance_event() (see
 * src/lib/supabase/rpc.ts), which sets the sanctioned mutation GUC inside the
 * same transaction that inserts the event. A database failure therefore never
 * leaves a projection change without its event: it rolls both back.
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getServerSupabaseClient, SupabaseConfigError } from "@/lib/supabase/server";
import {
  ingestAttendanceEvent,
  type IngestSessionSnapshot,
} from "@/lib/supabase/rpc";
import { getStaffName } from "@/lib/session";
import {
  acceptanceConfigFromSettings,
  checkEventAcceptance,
  type EventAcceptanceConfig,
} from "@/lib/event-acceptance";
import { normalizePhone } from "@/lib/phone";
import { getAttendanceDatasetId } from "@/lib/attendance-dataset";

const MAX_BATCH_EVENTS = 50;
const MAX_BATCH_BYTES = 128 * 1024;

type EventResultStatus = "accepted" | "duplicate" | "rejected" | "conflict";

/** Conflict evidence attached to a `conflict` acknowledgement (API contract §4.2). */
interface EventConflict {
  conflictId: string;
  type: string;
  winningEventId: string | null;
  losingEventIds: string[];
}

/** Canonical session projection snapshot in the client-facing camelCase shape. */
interface ProjectionSnapshot {
  sessionRef: string;
  studentName: string | null;
  parentPhone: string | null;
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
  provisional: boolean;
  whatsappLaunchedAt: string | null;
}

interface EventResult {
  eventId: string;
  result: EventResultStatus;
  reason?: string;
  message?: string;
  serverReceivedAt?: string;
  projection?: ProjectionSnapshot | null;
  conflict?: EventConflict;
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

function toProjection(row: IngestSessionSnapshot | null): ProjectionSnapshot | null {
  if (!row) return null;
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
    provisional: row.provisional,
    whatsappLaunchedAt: row.whatsapp_launched_at,
  };
}

function conflictMessage(reason: string | null): string {
  if (reason === "competing_sign_in") {
    return "Another sign-in already holds this session. This event was saved and sent to review.";
  }
  return "Another sign-out already holds this session. This event was saved and sent to review.";
}

async function ingestEvent(
  raw: Record<string, unknown>,
  staffName: string,
  config: EventAcceptanceConfig,
  serverReceivedAt: Date,
): Promise<EventResult> {
  const receiptMs = serverReceivedAt.getTime();

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

  // Shared PD-D1 acceptance window (same policy as the legacy sign-out route).
  const acceptanceRejection = checkEventAcceptance({
    deviceEventAt,
    dayKey,
    serverReceivedAt,
    config,
  });
  if (acceptanceRejection) {
    return rejected(eventId, acceptanceRejection.reason, acceptanceRejection.message);
  }

  // One atomic transaction: idempotency, conflict classification + audit,
  // append-only event insert, projection update and review flags commit
  // together. A conflict is acceptance-plus-flag, never a discard.
  const queuedDurationMs = Math.max(0, receiptMs - deviceMs);
  const ack = await ingestAttendanceEvent({
    eventId,
    eventType,
    sessionRef: raw.sessionRef as string,
    dayKey,
    studentName,
    parentPhone,
    deviceEventAt,
    serverReceivedAt: serverReceivedAt.toISOString(),
    queuedDuration: `${queuedDurationMs} milliseconds`,
    capturedOffline: Boolean(raw.capturedOffline),
    deviceId: raw.deviceId as string,
    deviceSeq: raw.deviceSeq as number,
    staffName,
  });

  const message =
    ack.result === "duplicate"
      ? `Duplicate event ${eventId}; original acknowledged ${ack.serverReceivedAt}.`
      : ack.result === "conflict"
        ? conflictMessage(ack.reason)
        : undefined;

  return {
    eventId,
    result: ack.result,
    reason: ack.reason ?? undefined,
    message,
    serverReceivedAt: ack.serverReceivedAt,
    projection: toProjection(ack.projection),
    conflict: ack.conflict ?? undefined,
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

  const datasetId = getAttendanceDatasetId();
  if (!datasetId) {
    return NextResponse.json({ error: "dataset_not_configured", serverTime }, { status: 503 });
  }

  // 2. Parse the batch envelope.
  let body: { datasetId?: unknown; events?: unknown; probe?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed_request", serverTime }, { status: 400 });
  }
  if (body.datasetId !== datasetId) {
    return NextResponse.json(
      { error: "dataset_mismatch", datasetId, serverTime },
      { status: 409 },
    );
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
  const config: EventAcceptanceConfig = acceptanceConfigFromSettings(settings);

  // 6. Per-event pipeline — partial failure is per-event, never all-or-nothing.
  const results: EventResult[] = [];
  for (const raw of body.events as Record<string, unknown>[]) {
    try {
      results.push(await ingestEvent(raw, staffName, config, serverReceivedAt));
    } catch {
      // A database failure is not a validation rejection. The transaction
      // rolled back, so the event is still only on the device: fail the batch
      // so the client keeps every event queued and retries it.
      return NextResponse.json({ error: "ingest_failed", serverTime }, { status: 500 });
    }
  }

  // 7. Commit → then acknowledge (200 whenever authenticated and well-formed).
  return NextResponse.json({ serverTime, results }, { status: 200 });
}
