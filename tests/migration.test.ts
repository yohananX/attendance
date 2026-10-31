import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const MIGRATION = fs.readFileSync(
  path.resolve("supabase/migrations/20261031000000_initial_schema.sql"),
  "utf8",
);

describe("migration SQL content", () => {
  it("creates all five contract tables plus the PD-D1 settings table", () => {
    for (const t of [
      "sessions",
      "events",
      "conflicts",
      "corrections",
      "login_attempts",
      "app_settings",
    ]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS ${t} (`);
    }
  });

  it("enables RLS with no policies on every data table", () => {
    for (const t of ["sessions", "events", "conflicts", "corrections", "login_attempts", "app_settings"]) {
      expect(MIGRATION).toMatch(new RegExp(`ALTER TABLE\\s+${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    }
    expect(MIGRATION).not.toMatch(/^[ \t]*CREATE POLICY/m);
  });

  it("enforces append-only triggers on events, corrections and conflicts", () => {
    for (const t of ["events", "corrections", "conflicts"]) {
      expect(MIGRATION).toContain(`CREATE TRIGGER ${t}_no_update`);
      expect(MIGRATION).toContain(`CREATE TRIGGER ${t}_no_delete`);
    }
  });

  it("sessions mutability guardrail is GUC-based so sanctioned paths can write", () => {
    expect(MIGRATION).toContain("CREATE TRIGGER sessions_no_direct_update");
    expect(MIGRATION).toContain("session_mutation_authorized");
    expect(MIGRATION).toContain("IS NOT 'true'");
    expect(MIGRATION).toContain("sessions_mutability_guard");
  });

  it("declares the four sanctioned session mutation paths", () => {
    for (const f of [
      "sessions_authorize_mutation",
      "sessions_apply_projection",
      "sessions_apply_correction",
      "sessions_set_launch_marker",
      "sessions_flag_conflict",
    ]) {
      expect(MIGRATION).toContain(`CREATE OR REPLACE FUNCTION ${f}`);
    }
  });

  it("implements PD-D2 partial unique indexes (not deferred)", () => {
    expect(MIGRATION).toContain("idx_events_one_sign_in_per_session");
    expect(MIGRATION).toContain("idx_events_one_sign_out_per_session");
    expect(MIGRATION).toContain(
      "WHERE event_type = 'sign_in' AND conflict_marker = 'none'",
    );
    expect(MIGRATION).toContain(
      "WHERE event_type = 'sign_out' AND conflict_marker = 'none'",
    );
    expect(MIGRATION).not.toContain("PD-D2 indexes deferred");
  });

  it("implements PD-D1 configurable late-sync settings with 7-day default", () => {
    expect(MIGRATION).toContain("late_sync_window_days");
    expect(MIGRATION).toContain("'7'");
    expect(MIGRATION).toContain("clock_tolerance_minutes");
    expect(MIGRATION).toContain("future_tolerance_minutes");
    // Q5 thresholds are stored as configuration, never hard-coded in the migration text
    expect(MIGRATION).toContain("ON CONFLICT (setting_key) DO NOTHING");
  });

  it("exposes health_privilege_check RPC for H2 privileged-capability probe", () => {
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION health_privilege_check");
    expect(MIGRATION).toContain("SELECT current_user");
  });
});
