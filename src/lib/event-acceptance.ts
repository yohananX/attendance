/**
 * Shared event acceptance-window policy (PD-D1).
 *
 * Both ingestion paths — the batch sync queue (`POST /api/events`) and the
 * legacy one-tap sign-out (`POST /api/sign-out`) — must enforce the same rules
 * for a caller-supplied device capture time:
 *
 *   1. The Lagos calendar day recomputed from `deviceEventAt` must match the
 *      applicable day key (the event's day key, or the target session's).
 *   2. `deviceEventAt` may not be more than the configured future tolerance
 *      ahead of server receipt.
 *   3. The day key may not be older than the configured late-sync window.
 *
 * The thresholds are configuration (`app_settings`), never hard-coded policy.
 * The approved PD-D1 defaults apply only when a setting is absent.
 */
import "server-only";

import { lagosDateKey, lagosDayDifference } from "@/lib/session";

export const DEFAULT_LATE_SYNC_WINDOW_DAYS = 7;
export const DEFAULT_FUTURE_TOLERANCE_MINUTES = 5;

export interface EventAcceptanceConfig {
  lateSyncWindowDays: number;
  futureToleranceMinutes: number;
}

export interface EventAcceptanceSettingsRow {
  setting_key: string;
  setting_value: string | null;
}

export type EventAcceptanceRejectionReason =
  | "day_key_mismatch"
  | "future_tolerance_exceeded"
  | "outside_late_window";

export interface EventAcceptanceRejection {
  reason: EventAcceptanceRejectionReason;
  message: string;
}

export interface EventAcceptanceInput {
  /** Device capture time (ISO-8601) supplied by the caller. */
  deviceEventAt: string;
  /** Lagos day key the event belongs to. */
  dayKey: string;
  /** Server receipt time, stamped once per request. */
  serverReceivedAt: Date;
  config: EventAcceptanceConfig;
}

function positiveNumberOr(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build the acceptance config from `app_settings` rows. Missing (or
 * unparseable) settings fall back to the approved PD-D1 defaults.
 */
export function acceptanceConfigFromSettings(
  rows: readonly EventAcceptanceSettingsRow[] | null | undefined,
): EventAcceptanceConfig {
  const byKey = Object.fromEntries((rows ?? []).map((row) => [row.setting_key, row.setting_value]));
  return {
    lateSyncWindowDays: positiveNumberOr(
      byKey["late_sync_window_days"],
      DEFAULT_LATE_SYNC_WINDOW_DAYS,
    ),
    futureToleranceMinutes: positiveNumberOr(
      byKey["future_tolerance_minutes"],
      DEFAULT_FUTURE_TOLERANCE_MINUTES,
    ),
  };
}

/**
 * Check a caller-supplied device timestamp against the acceptance window.
 * Returns `null` when accepted, or a rejection with the same reason/message
 * used by the batch ingestion acknowledgement.
 */
export function checkEventAcceptance(
  input: EventAcceptanceInput,
): EventAcceptanceRejection | null {
  const { deviceEventAt, dayKey, serverReceivedAt, config } = input;
  const receiptMs = serverReceivedAt.getTime();
  const serverLagosDay =
    lagosDateKey(serverReceivedAt.toISOString()) ?? new Date().toISOString().slice(0, 10);
  const deviceMs = new Date(deviceEventAt).getTime();

  // Acceptance window: server recomputes and verifies the Lagos day key.
  const eventLagosDay = lagosDateKey(deviceEventAt);
  if (!eventLagosDay || eventLagosDay !== dayKey) {
    return {
      reason: "day_key_mismatch",
      message: `Submitted dayKey ${dayKey} does not match server-recomputed Lagos date ${eventLagosDay ?? "<unparseable>"}`,
    };
  }

  // deviceEventAt not more than the configured future tolerance ahead of receipt.
  if (deviceMs > receiptMs + config.futureToleranceMinutes * 60 * 1000) {
    return {
      reason: "future_tolerance_exceeded",
      message: `deviceEventAt is more than ${config.futureToleranceMinutes} minutes ahead of server receipt`,
    };
  }

  // dayKey within the configured late-sync window (Lagos days old).
  // Age is server day minus event day, so a past event is positive.
  const dayAge = lagosDayDifference(serverLagosDay, dayKey);
  if (dayAge > config.lateSyncWindowDays) {
    return {
      reason: "outside_late_window",
      message: `Event is ${dayAge} days old; permitted window is ${config.lateSyncWindowDays} days`,
    };
  }

  return null;
}
