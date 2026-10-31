import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { GET } from "../src/app/api/health/route";

const clientMock = vi.mocked(getServerSupabaseClient);

function requestWith(headerValue?: string) {
  return new Request("http://localhost/api/health", {
    headers: headerValue === undefined ? {} : { "x-health-secret": headerValue },
  });
}

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.HEALTH_CHECK_SECRET = "test-secret";
  vi.resetAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

function privilegedClient() {
  const abortSignal = vi.fn().mockResolvedValue({ error: null });
  const select = vi.fn(() => ({ abortSignal }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ data: "service_role", error: null });
  return { from, rpc, abortSignal, select } as any;
}

describe("GET /api/health", () => {
  it("returns 401 when no health secret header is provided (H1)", async () => {
    const res = await GET(requestWith(undefined));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the health secret does not match (H1)", async () => {
    const res = await GET(requestWith("wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
    expect(clientMock).not.toHaveBeenCalled();
  });

  it("returns 503 when Supabase is not configured", async () => {
    clientMock.mockImplementation(() => {
      throw new Error("missing Supabase configuration");
    });
    const res = await GET(requestWith("test-secret"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("supabase_not_configured");
  });

  it("returns 200 with dbReady true when privileged and probe succeeds (H2)", async () => {
    const fake = privilegedClient();
    clientMock.mockReturnValue(fake);
    const res = await GET(requestWith("test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dbReady).toBe(true);
    expect(fake.rpc).toHaveBeenCalledWith("health_privilege_check");
    expect(fake.from).toHaveBeenCalledWith("events");
  });

  it("dbReady is false when the privilege probe returns the anon role (H2)", async () => {
    const fake = privilegedClient();
    fake.rpc.mockResolvedValue({ data: "anon", error: null });
    clientMock.mockReturnValue(fake);
    const res = await GET(requestWith("test-secret"));
    const body = await res.json();
    expect(body.dbReady).toBe(false);
  });

  it("dbReady is false when the privilege probe errors (H2)", async () => {
    const fake = privilegedClient();
    fake.rpc.mockResolvedValue({ data: null, error: new Error("rpc failed") });
    clientMock.mockReturnValue(fake);
    const res = await GET(requestWith("test-secret"));
    const body = await res.json();
    expect(body.dbReady).toBe(false);
  });

  it("dbReady is false when the connectivity probe errors even if privileged (H2)", async () => {
    const fake = privilegedClient();
    fake.abortSignal.mockResolvedValue({ error: new Error("db down") });
    clientMock.mockReturnValue(fake);
    const res = await GET(requestWith("test-secret"));
    const body = await res.json();
    expect(body.dbReady).toBe(false);
  });

  it("includes a serverTime in every response", async () => {
    const fake = privilegedClient();
    clientMock.mockReturnValue(fake);
    const res = await GET(requestWith("test-secret"));
    const body = await res.json();
    expect(body.serverTime).toBeDefined();
    expect(new Date(body.serverTime as string).getTime()).toBeGreaterThan(0);
  });
});
