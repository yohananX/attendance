import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getServerSupabaseConfig, SupabaseConfigError } from "../src/lib/supabase/env";

describe("getServerSupabaseConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when missing SUPABASE_URL", () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    expect(() => getServerSupabaseConfig()).toThrow(SupabaseConfigError);
  });

  it("throws when missing SUPABASE_SERVICE_ROLE_KEY", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getServerSupabaseConfig()).toThrow(SupabaseConfigError);
  });

  it("throws on invalid URL", () => {
    process.env.SUPABASE_URL = "not-a-url";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    expect(() => getServerSupabaseConfig()).toThrow(SupabaseConfigError);
  });

  it("throws on http non-loopback", () => {
    process.env.SUPABASE_URL = "http://example.com";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    expect(() => getServerSupabaseConfig()).toThrow(SupabaseConfigError);
  });

  it("allows http on localhost", () => {
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const config = getServerSupabaseConfig();
    expect(config.url).toBe("http://localhost:54321");
  });

  it("normalizes trailing slash", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const config = getServerSupabaseConfig();
    expect(config.url).toBe("https://example.supabase.co");
  });
});
