import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/rpc", () => ({ ingestAttendanceEvent: vi.fn() }));

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { ingestAttendanceEvent } from "@/lib/supabase/rpc";
import { SESSION_COOKIE_NAME, createSessionToken } from "../src/lib/session";
import { POST } from "../src/app/api/sign-out/route";

const originalEnv = process.env;

interface SessionRow {
  session_ref: string;
  day_key: string;
  signed_out_at: string | null;
  signed_out_by: string | null;
}

const baseSession: SessionRow = {
  session_ref: randomUUID(),
  day_key: "2026-11-09",
  signed_out_at: null,
  signed_out_by: null,
};

function mockSupabase(row: SessionRow | null, lookupError: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: lookupError });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  (getServerSupabaseClient as unknown as Mock).mockReturnValue({ from });
  return { from, select, eq, maybeSingle };
}

function sessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=${createSessionToken("Grace")}`;
}

function request(body: unknown, cookie: string | null = sessionCookie()): Request {
  return new Request("http://localhost/api/sign-out", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function projection(overrides: Record<string, unknown> = {}) {
  return {
    session_ref: baseSession.session_ref,
    day_key: baseSession.day_key,
    student_name: "Ada Obi",
    parent_phone: "+2348012345678",
    signed_in_at: "2026-11-09T07:00:00.000Z",
    signed_out_at: "2026-11-09T15:00:00.000Z",
    signed_in_by: "Grace",
    signed_out_by: "Grace",
    server_version: 2,
    corrected: false,
    conflict_type: null,
    late_synced: false,
    needs_review: false,
    provisional: false,
    whatsapp_launched_at: null,
    ...overrides,
  };
}

function acceptedAck(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    result: "accepted",
    reason: null,
    duplicate: false,
    serverReceivedAt: new Date().toISOString(),
    conflict: null,
    projection: projection(),
    ...overrides,
  };
}

describe("POST /api/sign-out atomic event ingestion", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, SESSION_SECRET: "test-secret" };
    vi.clearAllMocks();
    mockSupabase({ ...baseSession });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("ingests the sign-out as an immutable event through ingestAttendanceEvent", async () => {
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(200);
    expect(ingestAttendanceEvent).toHaveBeenCalledTimes(1);
    const params = (ingestAttendanceEvent as Mock).mock.calls[0][0];
    expect(params).toMatchObject({
      eventType: "sign_out",
      sessionRef: baseSession.session_ref,
      dayKey: baseSession.day_key,
      studentName: null,
      parentPhone: null,
      staffName: "Grace",
    });
    expect(params.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Number.isNaN(new Date(params.deviceEventAt).getTime())).toBe(false);
    expect(params.serverReceivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const body = await response.json();
    expect(body).toMatchObject({
      sessionRef: baseSession.session_ref,
      signedOutAt: "2026-11-09T15:00:00.000Z",
      signedOutBy: "Grace",
      eventId: params.eventId,
      alreadySignedOut: false,
    });
    expect(body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never calls sessions_apply_projection directly", () => {
    const source = fs.readFileSync(
      path.resolve("src/app/api/sign-out/route.ts"),
      "utf8",
    );
    // No direct projection RPC call of any kind, and no raw mutation path.
    expect(source).not.toMatch(/\.rpc\(\s*["']sessions_apply_projection["']/);
    expect(source).not.toMatch(/\.from\(\s*["']sessions["']\s*\)\s*\.update\(/);
    expect(source).toContain('from "@/lib/supabase/rpc"');
    expect(source).toContain("ingestAttendanceEvent");
  });

  it("returns the canonical sign-out for an already-signed-out session without ingesting", async () => {
    mockSupabase({
      ...baseSession,
      signed_out_at: "2026-11-09T14:30:00.000Z",
      signed_out_by: "Alice",
    });

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(200);
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      sessionRef: baseSession.session_ref,
      signedOutAt: "2026-11-09T14:30:00.000Z",
      signedOutBy: "Alice",
      alreadySignedOut: true,
    });
  });

  it("treats a repeated event id as a duplicate acknowledgement, not a second sign-out", async () => {
    const eventId = randomUUID();
    (ingestAttendanceEvent as Mock).mockResolvedValue(
      acceptedAck({
        eventId,
        result: "duplicate",
        duplicate: true,
        projection: projection({ server_version: 2 }),
      }),
    );

    const response = await POST(request({ sessionRef: baseSession.session_ref, eventId }));

    expect(response.status).toBe(200);
    expect(ingestAttendanceEvent).toHaveBeenCalledTimes(1);
    expect((ingestAttendanceEvent as Mock).mock.calls[0][0].eventId).toBe(eventId);
    expect(await response.json()).toMatchObject({
      signedOutAt: "2026-11-09T15:00:00.000Z",
      alreadySignedOut: true,
    });
  });

  it("returns the competing winner's canonical time for a conflict acknowledgement", async () => {
    (ingestAttendanceEvent as Mock).mockResolvedValue(
      acceptedAck({
        result: "conflict",
        reason: "competing_sign_out",
        conflict: {
          conflictId: randomUUID(),
          type: "time_conflict",
          winningEventId: randomUUID(),
          losingEventIds: [randomUUID()],
        },
        projection: projection({
          signed_out_at: "2026-11-09T14:55:00.000Z",
          conflict_type: "time_conflict",
          needs_review: true,
        }),
      }),
    );

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      signedOutAt: "2026-11-09T14:55:00.000Z",
      alreadySignedOut: true,
      conflict: true,
    });
  });

  it("derives the same event id for repeated legacy requests without an event id", async () => {
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());

    await POST(request({ sessionRef: baseSession.session_ref }));
    await POST(request({ sessionRef: baseSession.session_ref }));

    const calls = (ingestAttendanceEvent as Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].eventId).toBe(calls[1][0].eventId);
  });

  it("preserves an explicit device timestamp instead of substituting the server clock", async () => {
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());
    const deviceEventAt = "2026-11-09T14:00:00.000Z";

    await POST(request({ sessionRef: baseSession.session_ref, deviceEventAt }));

    const params = (ingestAttendanceEvent as Mock).mock.calls[0][0];
    expect(params.deviceEventAt).toBe(deviceEventAt);
  });

  it("rejects unauthenticated requests without ingesting", async () => {
    const response = await POST(request({ sessionRef: baseSession.session_ref }, null));

    expect(response.status).toBe(401);
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed json body", "not-an-object"],
    ["missing sessionRef", {}],
    ["non-string sessionRef", { sessionRef: 42 }],
    ["invalid eventId", { sessionRef: baseSession.session_ref, eventId: "not-a-uuid" }],
    ["invalid deviceEventAt", { sessionRef: baseSession.session_ref, deviceEventAt: "soon" }],
    ["invalid deviceSeq", { sessionRef: baseSession.session_ref, deviceSeq: 1.5 }],
  ])("rejects %s without ingesting", async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("rejects an unknown target session without ingesting", async () => {
    mockSupabase(null);

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "unknown_session" });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("answers a non-UUID session reference as unknown without ingesting", async () => {
    const { from } = mockSupabase(null);

    const response = await POST(request({ sessionRef: "not-a-session-uuid" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "unknown_session" });
    expect(from).not.toHaveBeenCalled();
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("returns a database error for a failed session lookup, never a success", async () => {
    mockSupabase(null, { message: "connection reset" });

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "sign_out_failed" });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("returns a database error when ingestion fails, never a false success", async () => {
    (ingestAttendanceEvent as Mock).mockRejectedValue(
      new Error("ingest_attendance_event failed: connection reset"),
    );

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: "sign_out_failed" });
    expect(body).not.toHaveProperty("signedOutAt");
    expect(body).not.toHaveProperty("alreadySignedOut");
  });

  it("returns 503 when Supabase is not configured", async () => {
    (getServerSupabaseClient as unknown as Mock).mockImplementation(() => {
      throw new Error("missing env");
    });

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(503);
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });
});
