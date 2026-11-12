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

const FIXED_NOW = "2026-11-09T10:00:00.000Z";

interface SessionRow {
  session_ref: string;
  day_key: string;
  signed_out_at: string | null;
  signed_out_by: string | null;
}

interface SettingRow {
  setting_key: string;
  setting_value: string | null;
}

const baseSession: SessionRow = {
  session_ref: randomUUID(),
  day_key: "2026-11-09",
  signed_out_at: null,
  signed_out_by: null,
};

const DEFAULT_SETTINGS: SettingRow[] = [
  { setting_key: "late_sync_window_days", setting_value: "7" },
  { setting_key: "future_tolerance_minutes", setting_value: "5" },
];

interface MockOptions {
  session?: SessionRow | null;
  lookupError?: { message: string } | null;
  settings?: SettingRow[] | null;
}

function mockSupabase(options: MockOptions = {}) {
  const session = options.session === undefined ? { ...baseSession } : options.session;
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: session, error: options.lookupError ?? null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const sessionsSelect = vi.fn(() => ({ eq }));
  const settingsSelect = vi
    .fn()
    .mockResolvedValue({ data: options.settings ?? DEFAULT_SETTINGS, error: null });
  const from = vi.fn((table: string) => {
    if (table === "sessions") return { select: sessionsSelect };
    if (table === "app_settings") return { select: settingsSelect };
    throw new Error(`unexpected table ${table}`);
  });
  (getServerSupabaseClient as unknown as Mock).mockReturnValue({ from });
  return { from, sessionsSelect, settingsSelect, maybeSingle };
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
    serverReceivedAt: FIXED_NOW,
    conflict: null,
    projection: projection(),
    ...overrides,
  };
}

function useFixedNow(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
}

describe("POST /api/sign-out atomic event ingestion", () => {
  beforeEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv, SESSION_SECRET: "test-secret" };
    vi.clearAllMocks();
    mockSupabase();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  it("ingests the sign-out as an immutable event through ingestAttendanceEvent", async () => {
    useFixedNow();
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
      deviceEventAt: FIXED_NOW,
      serverReceivedAt: FIXED_NOW,
    });
    expect(params.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const body = await response.json();
    expect(body).toMatchObject({
      sessionRef: baseSession.session_ref,
      signedOutAt: "2026-11-09T15:00:00.000Z",
      signedOutBy: "Grace",
      eventId: params.eventId,
      alreadySignedOut: false,
    });
    expect(body.serverTime).toBe(FIXED_NOW);
  });

  it("never calls sessions_apply_projection directly", () => {
    const source = fs.readFileSync(path.resolve("src/app/api/sign-out/route.ts"), "utf8");
    expect(source).not.toMatch(/\.rpc\(\s*["']sessions_apply_projection["']/);
    expect(source).not.toMatch(/\.from\(\s*["']sessions["']\s*\)\s*\.update\(/);
    expect(source).toContain('from "@/lib/supabase/rpc"');
    expect(source).toContain("ingestAttendanceEvent");
  });

  it("returns the canonical sign-out for an already-signed-out session without ingesting", async () => {
    const mock = mockSupabase({
      session: {
        ...baseSession,
        signed_out_at: "2026-11-09T14:30:00.000Z",
        signed_out_by: "Alice",
      },
    });

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(200);
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
    expect(mock.settingsSelect).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      sessionRef: baseSession.session_ref,
      signedOutAt: "2026-11-09T14:30:00.000Z",
      signedOutBy: "Alice",
      alreadySignedOut: true,
    });
  });

  it("treats a repeated event id as a duplicate acknowledgement, not a second sign-out", async () => {
    useFixedNow();
    const eventId = randomUUID();
    (ingestAttendanceEvent as Mock).mockResolvedValue(
      acceptedAck({ eventId, result: "duplicate", duplicate: true }),
    );

    const response = await POST(
      request({ sessionRef: baseSession.session_ref, eventId, deviceEventAt: FIXED_NOW }),
    );

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

  it("preserves an explicit device timestamp instead of substituting the server clock", async () => {
    useFixedNow();
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());
    const deviceEventAt = "2026-11-09T09:50:00.000Z";

    await POST(request({ sessionRef: baseSession.session_ref, deviceEventAt }));

    const params = (ingestAttendanceEvent as Mock).mock.calls[0][0];
    expect(params.deviceEventAt).toBe(deviceEventAt);
    // Server receipt stays separate from device capture.
    expect(params.serverReceivedAt).toBe(FIXED_NOW);
  });

  it("requires a device timestamp whenever an event id is supplied", async () => {
    const response = await POST(
      request({ sessionRef: baseSession.session_ref, eventId: randomUUID() }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "schema_invalid" });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("accepts a current Lagos-day device timestamp inside the window", async () => {
    useFixedNow();
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());
    const mock = mockSupabase();

    const response = await POST(
      request({
        sessionRef: baseSession.session_ref,
        deviceEventAt: "2026-11-09T09:59:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(mock.settingsSelect).toHaveBeenCalledTimes(1);
    expect(ingestAttendanceEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects a device timestamp whose Lagos day differs from the session day", async () => {
    useFixedNow();

    const response = await POST(
      request({
        sessionRef: baseSession.session_ref,
        deviceEventAt: "2026-11-08T10:00:00.000Z",
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "day_key_mismatch",
      message: expect.stringContaining("2026-11-08"),
    });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("rejects a device timestamp beyond the configured future tolerance", async () => {
    useFixedNow();

    const response = await POST(
      request({
        sessionRef: baseSession.session_ref,
        deviceEventAt: "2026-11-09T10:10:00.000Z",
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "future_tolerance_exceeded",
      message: expect.stringContaining("5 minutes"),
    });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("rejects a device timestamp outside the configured late-sync window", async () => {
    useFixedNow();
    mockSupabase({ session: { ...baseSession, day_key: "2026-11-01" } });

    const response = await POST(
      request({
        sessionRef: baseSession.session_ref,
        deviceEventAt: "2026-11-01T10:00:00.000Z",
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "outside_late_window",
      message: expect.stringContaining("7 days"),
    });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("respects configured settings instead of the defaults", async () => {
    useFixedNow();
    mockSupabase({
      settings: [
        { setting_key: "late_sync_window_days", setting_value: "1" },
        { setting_key: "future_tolerance_minutes", setting_value: "30" },
      ],
    });
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());

    // 20 minutes ahead exceeds the default 5 but is inside the configured 30.
    const accepted = await POST(
      request({
        sessionRef: baseSession.session_ref,
        deviceEventAt: "2026-11-09T10:20:00.000Z",
      }),
    );
    expect(accepted.status).toBe(200);

    // Two Lagos days old is inside the default 7 but outside the configured 1.
    mockSupabase({
      session: { ...baseSession, day_key: "2026-11-07" },
      settings: [
        { setting_key: "late_sync_window_days", setting_value: "1" },
        { setting_key: "future_tolerance_minutes", setting_value: "30" },
      ],
    });
    vi.clearAllMocks();
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());
    const rejected = await POST(
      request({
        sessionRef: baseSession.session_ref,
        deviceEventAt: "2026-11-07T10:00:00.000Z",
      }),
    );
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ error: "outside_late_window" });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("uses the approved defaults when settings are absent", async () => {
    useFixedNow();
    mockSupabase({ settings: [] });

    const response = await POST(
      request({
        sessionRef: baseSession.session_ref,
        deviceEventAt: "2026-11-09T10:06:00.000Z",
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "future_tolerance_exceeded",
      message: expect.stringContaining("5 minutes"),
    });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("does not query settings or validate the server clock when no device timestamp is supplied", async () => {
    useFixedNow();
    const mock = mockSupabase();
    (ingestAttendanceEvent as Mock).mockResolvedValue(acceptedAck());

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(200);
    expect(mock.settingsSelect).not.toHaveBeenCalled();
    expect((ingestAttendanceEvent as Mock).mock.calls[0][0].deviceEventAt).toBe(FIXED_NOW);
  });

  it("maps a reused event id with a different payload to a 409 conflict", async () => {
    useFixedNow();
    (ingestAttendanceEvent as Mock).mockRejectedValue(
      new Error(
        "ingest_attendance_event failed: event_id_reuse_mismatch: event abc already identifies a different logical event",
      ),
    );

    const response = await POST(
      request({
        sessionRef: baseSession.session_ref,
        eventId: randomUUID(),
        deviceEventAt: FIXED_NOW,
      }),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ error: "event_id_conflict" });
    expect(body).not.toHaveProperty("signedOutAt");
    expect(body).not.toHaveProperty("alreadySignedOut");
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
    mockSupabase({ session: null });

    const response = await POST(request({ sessionRef: baseSession.session_ref }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "unknown_session" });
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("answers a non-UUID session reference as unknown without ingesting", async () => {
    const mock = mockSupabase({ session: null });

    const response = await POST(request({ sessionRef: "not-a-session-uuid" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "unknown_session" });
    expect(mock.from).not.toHaveBeenCalled();
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });

  it("returns a database error for a failed session lookup, never a success", async () => {
    mockSupabase({ session: null, lookupError: { message: "connection reset" } });

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
