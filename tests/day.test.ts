import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { cookies } from "next/headers";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { createSessionToken } from "../src/lib/session";
import { GET } from "../src/app/api/day/route";

const mockCookies = vi.mocked(cookies);
const mockGetClient = vi.mocked(getServerSupabaseClient);

const originalEnv = process.env;

const rows = [
  {
    session_ref: "11111111-1111-1111-1111-111111111111",
    day_key: "2026-10-31",
    student_name: "Ada",
    parent_phone: "+2348012345678",
    signed_in_at: "2026-10-31T07:00:00.000Z",
    signed_out_at: null,
    signed_in_by: "Grace",
    signed_out_by: null,
    server_version: 1,
    corrected: false,
    conflict_type: null,
    late_synced: false,
    needs_review: false,
    whatsapp_launched_at: null,
  },
  {
    session_ref: "22222222-2222-2222-2222-222222222222",
    day_key: "2026-10-31",
    student_name: "Bola",
    parent_phone: "+2348012345679",
    signed_in_at: "2026-10-31T08:00:00.000Z",
    signed_out_at: "2026-10-31T12:00:00.000Z",
    signed_in_by: "Grace",
    signed_out_by: "Grace",
    server_version: 2,
    corrected: false,
    conflict_type: null,
    late_synced: false,
    needs_review: false,
    whatsapp_launched_at: null,
  },
  {
    session_ref: "33333333-3333-3333-3333-333333333333",
    day_key: "2026-10-31",
    student_name: "Chidi",
    parent_phone: "+2348012345680",
    signed_in_at: "2026-10-31T09:00:00.000Z",
    signed_out_at: "2026-10-31T13:00:00.000Z",
    signed_in_by: "Grace",
    signed_out_by: "Grace",
    server_version: 1,
    corrected: false,
    conflict_type: null,
    late_synced: false,
    needs_review: false,
    whatsapp_launched_at: "2026-10-31T13:05:00.000Z",
  },
];

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.SESSION_SECRET = "test-secret";
  vi.resetAllMocks();

  const client = {
    from: vi.fn(() => client),
    select: vi.fn(() => client),
    eq: vi.fn(() => client),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  mockGetClient.mockReturnValue(client as any);
});

afterEach(() => {
  process.env = originalEnv;
});

function setCookie(value: string | undefined) {
  mockCookies.mockReturnValue(
    Promise.resolve(
      { get: vi.fn(() => (value === undefined ? undefined : { value })) } as any,
    ),
  );
}

async function makeRequest(url = "http://localhost/api/day?dayKey=2026-10-31") {
  return GET(new Request(url));
}

describe("GET /api/day", () => {
  it("returns 401 when no session cookie is present", async () => {
    setCookie(undefined);
    const res = await makeRequest();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthenticated");
  });

  it("returns 401 when the session cookie is invalid", async () => {
    setCookie("tampered.cookie.token");
    const res = await makeRequest();
    expect(res.status).toBe(401);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it("returns 200 with the day payload when the session is valid", async () => {
    const token = createSessionToken("Grace") as string;
    setCookie(token);
    const res = await makeRequest();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dayKey).toBe("2026-10-31");
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions).toHaveLength(3);
    expect(body.sessions[0]).toMatchObject({
      sessionRef: rows[0].session_ref,
      studentName: "Ada",
      parentPhone: "+2348012345678",
      signedInAt: rows[0].signed_in_at,
      signedOutAt: null,
      signedInBy: "Grace",
      serverVersion: 1,
      corrected: false,
      conflictType: null,
      lateSynced: false,
      needsReview: false,
      whatsappLaunchedAt: null,
    });
    expect(body.serverTime).toBeDefined();
    expect(new Date(body.serverTime as string).getTime()).toBeGreaterThan(0);
  });

  it("queries Supabase for the requested dayKey", async () => {
    const token = createSessionToken("Grace") as string;
    setCookie(token);
    await makeRequest("http://localhost/api/day?dayKey=2026-11-07");
    const client = mockGetClient() as any;
    expect(client.from).toHaveBeenCalledWith("sessions");
    expect(client.eq).toHaveBeenCalledWith("day_key", "2026-11-07");
  });

  it("computes counts correctly", async () => {
    const token = createSessionToken("Grace") as string;
    setCookie(token);
    const res = await makeRequest();
    const body = await res.json();
    expect(body.counts).toEqual({
      inSchool: 1,
      signedOut: 2,
      outstandingMessages: 1,
    });
  });

  it("returns outstanding messages without launch markers", async () => {
    const token = createSessionToken("Grace") as string;
    setCookie(token);
    const res = await makeRequest();
    const body = await res.json();
    expect(body.outstandingMessages).toEqual([
      { sessionRef: rows[1].session_ref, studentName: "Bola", whatsappLaunchedAt: null },
    ]);
  });

  it("defaults dayKey to the current Lagos day when not supplied", async () => {
    const token = createSessionToken("Grace") as string;
    setCookie(token);
    const res = await makeRequest("http://localhost/api/day");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(/^\d{4}-\d{2}-\d{2}$/.test(body.dayKey)).toBe(true);
  });

  it("returns 400 for a malformed dayKey", async () => {
    const token = createSessionToken("Grace") as string;
    setCookie(token);
    const res = await makeRequest("http://localhost/api/day?dayKey=not-a-date");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "schema_invalid" });
  });
});
