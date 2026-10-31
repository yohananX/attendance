/**
 * POST /api/messages/{sessionRef}/launched (E4)
 *
 * Server-held WhatsApp launch marker. Records that a `wa.me` link launch was
 * initiated for a session — the marker means "link launched", never
 * "sent" or "delivered" (BR-13, Q15 safe default).
 *
 * - Requires a valid session cookie → 401 `unauthenticated` otherwise (AC-04.4).
 * - `sessionRef` must exist and have an accepted sign-out
 *   (`signed_out_at IS NOT NULL`) → 404 `unknown_session` / 409 `not_signed_out`
 *   (a message needs both times — FR-25).
 * - Calls the sanctioned `sessions_set_launch_marker()` with the server clock
 *   (PD-A7); first write wins, repeats return the existing marker unchanged (PD-D7).
 * - Returns 200 `{ sessionRef, whatsappLaunchedAt, serverTime }`.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getStaffName } from "@/lib/session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(code: string, status: number, serverTime: string) {
  return NextResponse.json({ error: code, serverTime }, { status });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ sessionRef: string }> },
) {
  const serverTime = new Date().toISOString();
  const { sessionRef } = await context.params;

  // 1. Session cookie validation (AC-04.4).
  const staffName = getStaffName(req);
  if (!staffName) {
    return errorResponse("unauthenticated", 401, serverTime);
  }

  // 2. sessionRef must be a well-formed UUID before it can exist.
  if (!UUID_RE.test(sessionRef)) {
    return errorResponse("unknown_session", 404, serverTime);
  }

  let supabase;
  try {
    supabase = getServerSupabaseClient();
  } catch {
    return errorResponse("supabase_not_configured", 503, serverTime);
  }

  // 3. The session must exist.
  const { data: sessionRow, error: fetchError } = await supabase
    .from("sessions")
    .select("session_ref, signed_out_at, whatsapp_launched_at")
    .eq("session_ref", sessionRef)
    .maybeSingle();

  if (fetchError !== null) {
    return errorResponse("server_error", 500, serverTime);
  }
  if (sessionRow === null) {
    return errorResponse("unknown_session", 404, serverTime);
  }

  // 4. An accepted sign-out is required: a message needs both times (FR-25).
  const signedOutAt =
    (sessionRow as { signed_out_at: string | null }).signed_out_at;
  if (signedOutAt === null) {
    return errorResponse("not_signed_out", 409, serverTime);
  }

  // 5. Record the launch marker through the sanctioned path (server clock;
  //    first write wins — PD-D7).
  const { error: rpcError } = await supabase.rpc(
    "sessions_set_launch_marker",
    { p_session_ref: sessionRef, p_launched_at: serverTime },
  );
  if (rpcError !== null) {
    return errorResponse("server_error", 500, serverTime);
  }

  // 6. Read back the marker: newly set on first call, unchanged on repeats.
  const { data: markerRow, error: markerError } = await supabase
    .from("sessions")
    .select("whatsapp_launched_at")
    .eq("session_ref", sessionRef)
    .maybeSingle();

  if (markerError !== null) {
    return errorResponse("server_error", 500, serverTime);
  }

  return NextResponse.json({
    sessionRef,
    whatsappLaunchedAt:
      (markerRow as { whatsapp_launched_at: string | null } | null)
        ?.whatsapp_launched_at ?? null,
    serverTime,
  });
}
