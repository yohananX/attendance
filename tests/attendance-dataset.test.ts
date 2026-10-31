import { afterEach, describe, expect, it } from "vitest";

import { getAttendanceDatasetId } from "../src/lib/attendance-dataset";

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
});

describe("getAttendanceDatasetId", () => {
  it("uses the configured dataset identity", () => {
    process.env = { ...originalEnv, NODE_ENV: "production", ATTENDANCE_DATASET_ID: "prod-2026-10" };
    expect(getAttendanceDatasetId()).toBe("prod-2026-10");
  });

  it("requires an explicit identity in production", () => {
    process.env = { ...originalEnv, NODE_ENV: "production" };
    delete process.env.ATTENDANCE_DATASET_ID;
    expect(getAttendanceDatasetId()).toBeNull();
  });

  it("uses a development identity outside production", () => {
    process.env = { ...originalEnv, NODE_ENV: "development" };
    delete process.env.ATTENDANCE_DATASET_ID;
    expect(getAttendanceDatasetId()).toBe("development");
  });

  it("rejects malformed identities", () => {
    process.env = { ...originalEnv, ATTENDANCE_DATASET_ID: "test dataset" };
    expect(getAttendanceDatasetId()).toBeNull();
  });
});
