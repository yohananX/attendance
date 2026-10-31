import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "../src/app/api/login/route";
import { SESSION_COOKIE_NAME, validateSessionToken } from "../src/lib/session";

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: "production" };
  process.env.STAFF_PIN = "123456";
  process.env.SESSION_SECRET = "test-session-secret";
});

afterEach(() => {
  process.env = originalEnv;
});

function request(body: unknown): Request {
  return new Request("https://attendance.example/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/login", () => {
  const validBody = {
    staffName: "  Grace  ",
    pin: "123456",
    deviceId: "11111111-1111-4111-8111-111111111111",
  };

  it("rejects malformed or incomplete login data", async () => {
    const malformed = await POST(new Request("https://attendance.example/api/login", { method: "POST", body: "{" }));
    expect(malformed.status).toBe(400);

    const incomplete = await POST(request({ ...validBody, staffName: " " }));
    expect(incomplete.status).toBe(400);

    const shortPin = await POST(request({ ...validBody, pin: "123" }));
    expect(shortPin.status).toBe(400);
  });

  it("rejects an incorrect PIN without issuing a cookie", async () => {
    const response = await POST(request({ ...validBody, pin: "654321" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ error: "invalid_pin" });
  });

  it("issues a secure 12-hour HttpOnly cookie for a valid PIN", async () => {
    const response = await POST(request(validBody));
    const setCookie = response.headers.get("set-cookie");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.staffName).toBe("Grace");
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=43200");

    const token = setCookie?.split(";")[0].slice(SESSION_COOKIE_NAME.length + 1);
    expect(token && validateSessionToken(token)?.staffName).toBe("Grace");
  });

  it("fails closed when the session signing secret is missing", async () => {
    delete process.env.SESSION_SECRET;
    const response = await POST(request(validBody));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
