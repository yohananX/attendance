import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabaseClient: vi.fn(),
}));

import { getServerSupabaseClient } from "@/lib/supabase/server";
import { SESSION_COOKIE_NAME, createSessionToken } from "../src/lib/session";
import { POST } from "../src/app/api/events/route";

const originalEnv = process.env;

describe("POST /api/events dataset identity", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SESSION_SECRET: "test-secret",
      ATTENDANCE_DATASET_ID: "production-data-v2",
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("rejects events queued for an old database before connecting to Supabase", async () => {
    const token = createSessionToken("Grace");
    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({ datasetId: "test-data-v1", events: [{}] }),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "dataset_mismatch",
      datasetId: "production-data-v2",
    });
    expect(getServerSupabaseClient).not.toHaveBeenCalled();
  });
});
