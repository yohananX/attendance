import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";

vi.mock("server-only", () => ({}));

import { createSessionToken, validateSessionToken } from "../src/lib/session";

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.SESSION_SECRET = "test-secret-do-not-use-in-production";
});

afterEach(() => {
  process.env = originalEnv;
});

function signPayload(payload: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET as string)
    .update(payload)
    .digest()
    .toString("base64url");
}

function b64u(str: string): string {
  return Buffer.from(str, "utf8").toString("base64url");
}

describe("validateSessionToken", () => {
  it("accepts a token created by createSessionToken", () => {
    const token = createSessionToken("Grace");
    expect(token).toBeDefined();
    const session = validateSessionToken(token as string);
    expect(session).not.toBeNull();
    expect(session!.staffName).toBe("Grace");
    expect(session!.issuedAt).toBeGreaterThan(0);
    expect(session!.expiresAt).toBeGreaterThan(session!.issuedAt);
  });

  it("binds the staff name and 12-hour expiry to the token", () => {
    const a = validateSessionToken(createSessionToken("Alice") as string)!;
    const b = validateSessionToken(createSessionToken("Bob") as string)!;
    expect(a.staffName).toBe("Alice");
    expect(b.staffName).toBe("Bob");
    expect(a.expiresAt - a.issuedAt).toBe(12 * 60 * 60 * 1000);
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken("Grace") as string;
    const [payloadB64, sigB64] = token.split(".");
    const tamperedSig = sigB64.replace(/^./, (c) => (c === "a" ? "b" : "a"));
    expect(validateSessionToken(`${payloadB64}.${tamperedSig}`)).toBeNull();
  });

  it("rejects non-canonical base64url signature variants", () => {
    const token = createSessionToken("Grace") as string;
    const [payloadB64, sigB64] = token.split(".");
    const finalCharacter = sigB64.endsWith("A") ? "B" : "A";
    expect(validateSessionToken(`${payloadB64}.${sigB64.slice(0, -1)}${finalCharacter}`)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken("Grace") as string;
    const [payloadB64, sigB64] = token.split(".");
    const tamperedPayload = payloadB64.replace(/^./, (c) => (c === "a" ? "b" : "a"));
    expect(validateSessionToken(`${tamperedPayload}.${sigB64}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const now = Date.now();
    const payload = JSON.stringify({ staffName: "Grace", iat: now - 200000, exp: now - 1000 });
    const token = `${b64u(payload)}.${signPayload(payload)}`;
    expect(validateSessionToken(token)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(validateSessionToken("not-a-token")).toBeNull();
    expect(validateSessionToken("")).toBeNull();
    expect(validateSessionToken("a.b")).toBeNull();
    expect(validateSessionToken("a.b.c")).toBeNull();
  });

  it("rejects all tokens when SESSION_SECRET is missing (secure default)", () => {
    delete process.env.SESSION_SECRET;
    expect(createSessionToken("Grace")).toBeNull();
    expect(validateSessionToken("whatever")).toBeNull();
  });
});
