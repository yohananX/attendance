/**
 * Sanctioned session-mutation RPC helpers.
 *
 * The `sessions` table is protected by the `sessions_mutability_guard`
 * trigger: direct UPDATEs are rejected unless a sanctioned path has set the
 * transaction-local `app.session_mutation_authorized` GUC. The only sanctioned
 * ingest path is `sessions_apply_projection()`, so all projection writes must
 * go through this module — never a direct `supabase.from("sessions").update()`.
 *
 * This module is server-only (service-role key); it must never be imported
 * from client components.
 */
import "server-only";

import { getServerSupabaseClient } from "@/lib/supabase/server";

export type ProjectionEventType = "sign_in" | "sign_out";

export interface ApplySessionProjectionParams {
  /** Client-generated session reference (PK of the sessions row). */
  sessionRef: string;
  /** Lagos calendar date (YYYY-MM-DD) of the accepted event. */
  dayKey: string;
  /** Submitted student identity (sign_in only). */
  studentName: string;
  /** Normalised parent phone in E.164 +234… form. */
  parentPhone: string;
  eventType: ProjectionEventType;
  /** Device capture time (ISO-8601 UTC) — becomes signed_in_at / signed_out_at. */
  eventAt: string;
  /** Staff name stamped from the authenticated session cookie. */
  staffName: string;
}

/**
 * Call the sanctioned `sessions_apply_projection()` RPC.
 *
 * Creates a session row from an accepted sign-in (first write wins, idempotent
 * on the session row), or records an accepted sign-out (sets displayed
 * sign-out time once, bumps server_version). Runs as security definer with the
 * projection mutation path authorised, so the mutability guard permits it.
 *
 * @throws if the RPC errors (e.g. mutability guard, constraint violation).
 */
export async function applySessionProjection(
  params: ApplySessionProjectionParams,
): Promise<void> {
  const supabase = getServerSupabaseClient();
  const { error } = await supabase.rpc("sessions_apply_projection", {
    p_session_ref: params.sessionRef,
    p_day_key: params.dayKey,
    p_student_name: params.studentName,
    p_parent_phone: params.parentPhone,
    p_event_type: params.eventType,
    p_event_at: params.eventAt,
    p_staff_name: params.staffName,
  });
  if (error) {
    throw new Error(`sessions_apply_projection failed: ${error.message}`);
  }
}
