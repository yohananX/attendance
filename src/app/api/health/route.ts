/**
 * Health endpoint: proves service-role connectivity to Supabase (protected).
 *
 * This endpoint is protected and must not be publicly accessible.
 * It requires an operator secret header to mitigate unauthenticated probing.
 */

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { getServerSupabaseClient } from "@/lib/supabase/server";

const HEALTH_SECRET_HEADER = "x-health-secret";

export async function GET(req: Request) {
  const serverTime = new Date().toISOString();
  const secret = process.env.HEALTH_CHECK_SECRET?.trim();
  const provided = req.headers.get(HEALTH_SECRET_HEADER)?.trim();

  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ ok: false, serverTime, error: "unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = getServerSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, serverTime, error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  let dbReady = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    // Privilege probe: proves the call runs as the service role (the only role
    // the server is permitted to use). RLS with no policies lets anon or
    // authenticated keys read zero rows without error, so connectivity alone
    // cannot establish privileged capability; dbReady requires the exact
    // service_role.
    const { data: role, error: roleError } = await supabase.rpc("health_privilege_check");
    const isPrivileged = !roleError && role === "service_role";
    const probe = await supabase
      .from("events")
      .select("event_id", { head: true, count: "exact" })
      .abortSignal(controller.signal as any);
    clearTimeout(timeout);
    dbReady = isPrivileged && probe.error === null;
  } catch {
    dbReady = false;
  }

  return NextResponse.json({
    ok: true,
    serverTime,
    dbReady,
  });
}
