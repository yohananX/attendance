import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
  SupabaseConfigError: class SupabaseConfigError extends Error {},
}));
vi.mock("@/lib/supabase/rpc", () => ({ ingestAttendanceEvent: vi.fn() }));

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { ingestAttendanceEvent } from "@/lib/supabase/rpc";
import { SESSION_COOKIE_NAME, createSessionToken, lagosDateKey } from "../src/lib/session";
import { POST } from "../src/app/api/events/route";

const originalEnv = process.env;

function mockSupabase() {
  const from = vi.fn(() => ({
    select: vi.fn().mockResolvedValue({
      data: [
        { setting_key: "late_sync_window_days", setting_value: "7" },
        { setting_key: "future_tolerance_minutes", setting_value: "5" },
      ],
    }),
  }));
  (getServerSupabaseClient as unknown as Mock).mockReturnValue({ from });
}

function request(events: Record<string, unknown>[]): Request {
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${SESSION_COOKIE_NAME}=${createSessionToken("Grace")}`,
    },
    body: JSON.stringify({ datasetId: "production-data-v2", events }),
  });
}

function signOutEvent(overrides: Record<string, unknown> = {}) {
  const deviceEventAt = new Date().toISOString();
  return {
    eventId: randomUUID(),
    eventType: "sign_out",
    sessionRef: randomUUID(),
    deviceEventAt,
    capturedOffline: false,
    deviceId: randomUUID(),
    deviceSeq: 1,
    dayKey: lagosDateKey(deviceEventAt),
    staffName: "ignored — server stamps the cookie name",
    ...overrides,
  };
}

function sessionSnapshot(sessionRef: string, overrides: Record<string, unknown> = {}) {
  return {
    session_ref: sessionRef,
    day_key: lagosDateKey(new Date().toISOString()),
    student_name: "Ada Obi",
    parent_phone: "+2348012345678",
    signed_in_at: "2026-11-09T07:00:00.000Z",
    signed_out_at: "2026-11-09T15:00:00.000Z",
    signed_in_by: "Grace",
    signed_out_by: "Grace",
    server_version: 2,
    corrected: false,
    conflict_type: null as string | null,
    late_synced: false,
    needs_review: false,
    provisional: false,
    whatsapp_launched_at: null,
    ...overrides,
  };
}

describe("POST /api/events atomic ingest acknowledgement", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SESSION_SECRET: "test-secret",
      ATTENDANCE_DATASET_ID: "production-data-v2",
    };
    vi.clearAllMocks();
    mockSupabase();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("acks a retained competing event as a conflict (not a rejection)", async () => {
    const event = signOutEvent();
    const serverReceivedAt = new Date().toISOString();
    (ingestAttendanceEvent as Mock).mockResolvedValue({
      eventId: event.eventId,
      result: "conflict",
      reason: "competing_sign_out",
      duplicate: false,
      serverReceivedAt,
      conflict: {
        conflictId: "conflict-1",
        type: "time_conflict",
        winningEventId: "winner-1",
        losingEventIds: [event.eventId],
      },
      projection: sessionSnapshot(event.sessionRef, {
        signed_out_at: "2026-11-09T14:55:00.000Z",
        conflict_type: "time_conflict",
        needs_review: true,
      }),
    });

    const response = await POST(request([event]));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      eventId: event.eventId,
      result: "conflict",
      reason: "competing_sign_out",
      conflict: {
        conflictId: "conflict-1",
        type: "time_conflict",
        winningEventId: "winner-1",
        losingEventIds: [event.eventId],
      },
      // The client needs the canonical (winning) projection and the review
      // flag to update its local copy of the session.
      projection: {
        sessionRef: event.sessionRef,
        signedOutAt: "2026-11-09T14:55:00.000Z",
        conflictType: "time_conflict",
        needsReview: true,
      },
    });
    expect(body.results[0].result).not.toBe("rejected");

    const rpcArgs = (ingestAttendanceEvent as Mock).mock.calls[0][0];
    expect(rpcArgs).toMatchObject({
      eventId: event.eventId,
      eventType: "sign_out",
      sessionRef: event.sessionRef,
      staffName: "Grace",
      studentName: null,
      parentPhone: null,
    });
  });

  it("fails the batch as retryable when the ingest transaction errors", async () => {
    const event = signOutEvent();
    (ingestAttendanceEvent as Mock).mockRejectedValue(new Error("connection reset"));

    const response = await POST(request([event]));

    // A database failure must never be reported as a per-event rejection: a
    // rejected event is not retried, a failed transaction must be.
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "ingest_failed" });
  });

  it("returns the original acknowledgement for a duplicate event id", async () => {
    const event = signOutEvent();
    const originalReceivedAt = "2026-11-09T10:00:00.000Z";
    (ingestAttendanceEvent as Mock).mockResolvedValue({
      eventId: event.eventId,
      result: "duplicate",
      reason: null,
      duplicate: true,
      serverReceivedAt: originalReceivedAt,
      conflict: null,
      projection: sessionSnapshot(event.sessionRef),
    });

    const response = await POST(request([event]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      result: "duplicate",
      serverReceivedAt: originalReceivedAt,
    });
  });

  it("passes a provisional-session reconciliation acknowledgement through", async () => {
    const event = signOutEvent({ eventType: "sign_in", studentName: "Ada Obi", parentPhone: "08012345678" });
    (ingestAttendanceEvent as Mock).mockResolvedValue({
      eventId: event.eventId,
      result: "accepted",
      reason: "provisional_reconciled",
      duplicate: false,
      serverReceivedAt: new Date().toISOString(),
      conflict: null,
      projection: sessionSnapshot(event.sessionRef, { provisional: false, needs_review: true }),
    });

    const response = await POST(request([event]));
    const body = await response.json();

    expect(body.results[0]).toMatchObject({ result: "accepted", reason: "provisional_reconciled" });
    // The phone is normalised server-side before it reaches the database.
    expect((ingestAttendanceEvent as Mock).mock.calls[0][0].parentPhone).toBe("+2348012345678");
    expect((ingestAttendanceEvent as Mock).mock.calls[0][0].studentName).toBe("Ada Obi");
  });

  it("keeps group staff authentication: no cookie means no ingest call", async () => {
    const event = signOutEvent();
    const response = await POST(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId: "production-data-v2", events: [event] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(ingestAttendanceEvent).not.toHaveBeenCalled();
  });
});
