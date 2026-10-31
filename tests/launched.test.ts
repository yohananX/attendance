import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getSessionCookieName, signSession, validateSessionToken } from "@/lib/session";
import { POST } from "../src/app/api/messages/[sessionRef]/launched/route";

const clientMock = vi.mocked(getServerSupabaseClient);

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.SESSION_SECRET = "test-secret";
  vi.resetAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

const sessionRef = "11111111-1111-4111-8111-111111111111";
const launchedAt = "2026-11-07T10:00:00.000Z";
const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
const longPast = new Date(0).toISOString();

function requestWith(cookieValue?: string) {
  return new Request(
    `http://localhost/api/messages/${sessionRef}/launched`,
    {
      method: "POST",
      headers: cookieValue === undefined ? {} : { cookie: `session=${cookieValue}` },
    },
  );
}

function routeParams() {
  return { params: Promise.resolve({ sessionRef }) } as Parameters<typeof POST>[1];
}

function signedOutRow() {
  return {
    session_ref: sessionRef,
    signed_out_at: "2026-11-07T13:00:00.000Z",
    whatsapp_launched_at: null,
  };
}

/**
 * Install a mock Supabase client whose `maybeSingle` resolves the supplied
 * rows in order (first the existence check, then the marker read-back).
 */
function installSupabase(rows: Array<{ data: unknown; error: unknown } | null>) {
  const maybeSingle = vi.fn();
  for (const row of rows) maybeSingle.mockResolvedValueOnce(row ?? { data: null, error: null });
  const select = vi.fn(() => ({ eq: () => ({ maybeSingle }) }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ error: null });
  clientMock.mockReturnValue({ from, rpc } as any);
  return { from, rpc, maybeSingle };
}

async function postWith(cookieValue?: string) {
  return await POST(requestWith(cookieValue), routeParams());
}

function validCookie() {
  return signSession("Grace");
}

describe("POST /api/messages/{sessionRef}/launched (E4)", () => {
  it("returns 401 when no session cookie is provided", async () => {
    const res = await postWith(undefined);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthenticated");
    expect(body.serverTime).toBeDefined();
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the cookie signature is invalid", async () => {
    const cookie = validCookie();
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
    const res = await postWith(tampered);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("returns 401 with a hand-crafted expired token", async () => {
    const secret = process.env.SESSION_SECRET as string;
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ staffName: "Grace", iat: now - 86400, exp: now - 1000 });
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    const res = await postWith(`${payload}.${signature}`);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("returns 401 when SESSION_SECRET is not configured", async () => {
    delete process.env.SESSION_SECRET;
    const res = await postWith("session=garbage.token");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("returns 404 unknown_session for an unknown sessionRef", async () => {
    const { rpc } = installSupabase([{ data: null, error: null }]);
    const res = await postWith(validCookie());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("unknown_session");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 409 not_signed_out when signed_out_at is NULL", async () => {
    const { rpc } = installSupabase([
      { data: { ...signedOutRow(), signed_out_at: null }, error: null },
    ]);
    const res = await postWith(validCookie());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_signed_out");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 200 with the launch marker and serverTime for a signed-out session", async () => {
    const { rpc } = installSupabase([
      { data: signedOutRow(), error: null },
      { data: { whatsapp_launched_at: launchedAt }, error: null },
    ]);
    const res = await postWith(validCookie());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionRef).toBe(sessionRef);
    expect(body.whatsappLaunchedAt).toBe(launchedAt);
    expect(new Date(body.serverTime).getTime()).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("sessions_set_launch_marker", {
      p_session_ref: sessionRef,
      p_launched_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("is idempotent: a repeat call returns the existing marker unchanged (PD-D7)", async () => {
    const { rpc } = installSupabase([
      { data: signedOutRow(), error: null },
      { data: { whatsapp_launched_at: launchedAt }, error: null },
      { data: signedOutRow(), error: null },
      { data: { whatsapp_launched_at: launchedAt }, error: null },
    ]);
    const first = await postWith(validCookie());
    const second = await postWith(validCookie());
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.whatsappLaunchedAt).toBe(launchedAt);
    expect(secondBody.whatsappLaunchedAt).toBe(launchedAt);
    expect(firstBody.sessionRef).toBe(secondBody.sessionRef);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when Supabase is not configured", async () => {
    clientMock.mockImplementation(() => {
      throw new Error("Supabase is not configured");
    });
    const res = await postWith(validCookie());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("supabase_not_configured");
  });
});

describe("session cookie helpers", () => {
  it("validates a token it signed and rejects a tampered one", () => {
    const token = signSession("Grace");
    expect(validateSessionToken(token)?.staffName).toBe("Grace");
    expect(validateSessionToken(token.slice(0, -1) + "x")).toBeNull();
    expect(validateSessionToken("garbage")).toBeNull();
    expect(validateSessionToken("")).toBeNull();
  });
});
