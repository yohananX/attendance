/**
 * Sanctioned session-mutation RPC helpers.
 *
 * The `sessions` table is protected by the `sessions_mutability_guard`
 * trigger: direct UPDATEs are rejected unless a sanctioned path has set the
 * transaction-local `app.session_mutation_authorized` GUC. Event ingestion is
 * the sanctioned `ingest_attendance_event()` path, so all projection writes
 * made from an attendance event must go through this module — never a direct
 * `supabase.from("sessions").update()`, and never as a separate request that
 * could commit a projection without its event.
 *
 * This module is server-only (service-role key); it must never be imported
 * from client components.
 */
import "server-only";

import { getServerSupabaseClient } from "@/lib/supabase/server";

export type ProjectionEventType = "sign_in" | "sign_out";

export interface IngestAttendanceEventParams {
  /** Client-generated event identity — the idempotency key. */
  eventId: string;
  eventType: ProjectionEventType;
  /** Client-generated session reference (PK of the sessions row). */
  sessionRef: string;
  /** Lagos calendar date (YYYY-MM-DD) of the accepted event. */
  dayKey: string;
  /** Submitted student identity (required for sign_in, null for sign_out). */
  studentName: string | null;
  /** Normalised parent phone in E.164 +234… form (sign_in only). */
  parentPhone: string | null;
  /** Device capture time (ISO-8601 UTC) — becomes signed_in_at / signed_out_at. */
  deviceEventAt: string;
  /** Server receipt time (ISO-8601 UTC), stamped once per request. */
  serverReceivedAt: string;
  /** Receipt time minus capture time, as a Postgres interval literal. */
  queuedDuration: string;
  capturedOffline: boolean;
  deviceId: string;
  deviceSeq: number;
  /** Staff name stamped from the authenticated session cookie. */
  staffName: string;
}

/** Conflict audit evidence returned with a `conflict` acknowledgement. */
export interface IngestConflictInfo {
  conflictId: string;
  type: "time_conflict" | "correction_conflict";
  winningEventId: string | null;
  losingEventIds: string[];
}

/** Canonical session projection snapshot (snake_case — maps `sessions` columns). */
export interface IngestSessionSnapshot {
  session_ref: string;
  day_key: string;
  student_name: string | null;
  parent_phone: string | null;
  signed_in_at: string | null;
  signed_out_at: string | null;
  signed_in_by: string | null;
  signed_out_by: string | null;
  server_version: number;
  corrected: boolean;
  conflict_type: string | null;
  late_synced: boolean;
  needs_review: boolean;
  provisional: boolean;
  whatsapp_launched_at: string | null;
}

export type IngestAcknowledgementResult = "accepted" | "duplicate" | "conflict";

/**
 * Per-event acknowledgement. An acknowledgement only exists because the
 * database transaction that stored the event committed: `accepted` (projection
 * applied), `duplicate` (this event id was already acknowledged) or `conflict`
 * (the event was retained and classified against a competing winner).
 */
export interface IngestAcknowledgement {
  eventId: string;
  result: IngestAcknowledgementResult;
  reason: string | null;
  duplicate: boolean;
  serverReceivedAt: string;
  conflict: IngestConflictInfo | null;
  projection: IngestSessionSnapshot | null;
}

/**
 * Call the sanctioned `ingest_attendance_event()` RPC.
 *
 * A single statement, so the idempotency check, conflict classification, the
 * append-only event insert, the conflict audit row, the projection update and
 * the session review flags either all commit or all roll back. Ingest is
 * serialised per session inside the function, which is what makes two
 * competing submissions resolve to one accepted winner plus one retained loser.
 *
 * @throws if the RPC errors; the caller must treat that as retryable, never as
 *   a per-event rejection (a rejected event is never retried, a failed
 *   transaction must be).
 */
export async function ingestAttendanceEvent(
  params: IngestAttendanceEventParams,
): Promise<IngestAcknowledgement> {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase.rpc("ingest_attendance_event", {
    p_event_id: params.eventId,
    p_event_type: params.eventType,
    p_session_ref: params.sessionRef,
    p_day_key: params.dayKey,
    p_student_name: params.studentName,
    p_parent_phone: params.parentPhone,
    p_device_event_at: params.deviceEventAt,
    p_server_received_at: params.serverReceivedAt,
    p_queued_duration: params.queuedDuration,
    p_captured_offline: params.capturedOffline,
    p_device_id: params.deviceId,
    p_device_seq: params.deviceSeq,
    p_staff_name: params.staffName,
  });
  if (error) {
    throw new Error(`ingest_attendance_event failed: ${error.message}`);
  }
  return data as IngestAcknowledgement;
}
