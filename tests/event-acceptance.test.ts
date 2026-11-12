import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  acceptanceConfigFromSettings,
  checkEventAcceptance,
  DEFAULT_FUTURE_TOLERANCE_MINUTES,
  DEFAULT_LATE_SYNC_WINDOW_DAYS,
  type EventAcceptanceConfig,
} from "../src/lib/event-acceptance";

const CONFIG: EventAcceptanceConfig = {
  lateSyncWindowDays: 7,
  futureToleranceMinutes: 5,
};

// 2026-11-09T10:00:00Z is 11:00 Africa/Lagos on 2026-11-09.
const RECEIPT = new Date("2026-11-09T10:00:00.000Z");

function check(deviceEventAt: string, dayKey = "2026-11-09", config = CONFIG) {
  return checkEventAcceptance({ deviceEventAt, dayKey, serverReceivedAt: RECEIPT, config });
}

describe("acceptanceConfigFromSettings", () => {
  it("uses the approved PD-D1 seven-day / five-minute defaults when absent", () => {
    const config = acceptanceConfigFromSettings([]);
    expect(config).toEqual({
      lateSyncWindowDays: DEFAULT_LATE_SYNC_WINDOW_DAYS,
      futureToleranceMinutes: DEFAULT_FUTURE_TOLERANCE_MINUTES,
    });
    expect(config.lateSyncWindowDays).toBe(7);
  });

  it("reads configured values from app_settings rows", () => {
    const config = acceptanceConfigFromSettings([
      { setting_key: "late_sync_window_days", setting_value: "2" },
      { setting_key: "future_tolerance_minutes", setting_value: "30" },
    ]);
    expect(config).toEqual({ lateSyncWindowDays: 2, futureToleranceMinutes: 30 });
  });

  it("falls back to the defaults for null or unparseable values", () => {
    const config = acceptanceConfigFromSettings([
      { setting_key: "late_sync_window_days", setting_value: null },
      { setting_key: "future_tolerance_minutes", setting_value: "not-a-number" },
    ]);
    expect(config).toEqual({
      lateSyncWindowDays: DEFAULT_LATE_SYNC_WINDOW_DAYS,
      futureToleranceMinutes: DEFAULT_FUTURE_TOLERANCE_MINUTES,
    });
  });
});

describe("checkEventAcceptance", () => {
  it("accepts a current Lagos-day timestamp inside the tolerance", () => {
    expect(check("2026-11-09T09:59:00.000Z")).toBeNull();
  });

  it("rejects a timestamp whose Lagos day does not match the day key", () => {
    expect(check("2026-11-08T10:00:00.000Z")).toMatchObject({
      reason: "day_key_mismatch",
    });
  });

  it("recomputes the Lagos day across the UTC+1 boundary", () => {
    // 23:30Z on 2026-11-08 is 00:30 Lagos on 2026-11-09.
    expect(check("2026-11-08T23:30:00.000Z", "2026-11-09")).toBeNull();
    expect(check("2026-11-08T23:30:00.000Z", "2026-11-08")).toMatchObject({
      reason: "day_key_mismatch",
    });
  });

  it("rejects a timestamp beyond the future tolerance", () => {
    expect(check("2026-11-09T10:05:00.001Z")).toMatchObject({
      reason: "future_tolerance_exceeded",
    });
    // Exactly at the tolerance boundary is accepted.
    expect(check("2026-11-09T10:05:00.000Z")).toBeNull();
  });

  it("rejects a day older than the late-sync window", () => {
    // 8 Lagos days old is outside the approved default window.
    expect(check("2026-11-01T10:00:00.000Z", "2026-11-01")).toMatchObject({
      reason: "outside_late_window",
    });
    // Exactly 7 Lagos days old is inside the approved default window.
    expect(check("2026-11-02T10:00:00.000Z", "2026-11-02")).toBeNull();
    expect(check("2026-11-03T10:00:00.000Z", "2026-11-03")).toBeNull();
  });

  it("uses the configured thresholds rather than hard-coded values", () => {
    const config: EventAcceptanceConfig = {
      lateSyncWindowDays: 1,
      futureToleranceMinutes: 30,
    };
    expect(check("2026-11-09T10:20:00.000Z", "2026-11-09", config)).toBeNull();
    expect(check("2026-11-07T10:00:00.000Z", "2026-11-07", config)).toMatchObject({
      reason: "outside_late_window",
    });
  });
});
