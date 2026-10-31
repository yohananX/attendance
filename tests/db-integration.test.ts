import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "fs";
import path from "path";

const DATABASE_URL = process.env.DATABASE_URL;
const migrationSql = fs.readFileSync(
  path.resolve("supabase/migrations/20261031000000_initial_schema.sql"),
  "utf8",
);

describe.skipIf(!DATABASE_URL)(
  "database integration (migration executed against live Postgres)",
  () => {
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString: DATABASE_URL });
      await client.connect();
      await client.query(migrationSql);
    });

    afterAll(async () => {
      await client.end().catch(() => {
        /* best-effort cleanup */
      });
    });

    it("applies the migration cleanly and creates all tables", async () => {
      const { rows } = await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      const names = rows.map((r) => r.table_name);
      for (const t of [
        "app_settings",
        "conflicts",
        "corrections",
        "events",
        "login_attempts",
        "sessions",
      ]) {
        expect(names).toContain(t);
      }
    });

    it("seeds PD-D1 late_sync_window_days = 7 (never hard-coded)", async () => {
      const { rows } = await client.query<{ setting_value: string }>(
        "SELECT setting_value FROM app_settings WHERE setting_key = $1",
        ["late_sync_window_days"],
      );
      expect(rows[0].setting_value).toBe("7");
    });

    it("enables RLS and creates no policies", async () => {
      const { rows: rls } = await client.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE relname = $1",
        ["events"],
      );
      expect(rls[0].relrowsecurity).toBe(true);
      const { rows: policies } = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'public'",
      );
      expect(Number(policies[0].count)).toBe(0);
    });

    it("events append-only: UPDATE and DELETE fail at the data layer", async () => {
      await client.query(
        `INSERT INTO events (event_id, event_type, session_ref, student_name, parent_phone, device_event_at, device_id, device_seq, staff_name, day_key)
         VALUES (gen_random_uuid(), 'sign_in', gen_random_uuid(), 'A Child', '+2348012345678', now(), gen_random_uuid(), 1, 'Staff', CURRENT_DATE)`,
      );
      await expect(client.query("UPDATE events SET conflict_marker = 'losing'")).rejects.toThrow();
      await expect(client.query("DELETE FROM events")).rejects.toThrow();
    });

    it("sessions guardrail: direct UPDATE fails", async () => {
      await client.query(
        "INSERT INTO sessions (session_ref, day_key, student_name, parent_phone, signed_in_by) VALUES (gen_random_uuid(), CURRENT_DATE, 'A Child', '+2348012345678', 'Staff')",
      );
      await expect(
        client.query("UPDATE sessions SET signed_in_at = now()"),
      ).rejects.toThrow();
    });

    it("sanctioned projection apply can UPDATE sessions (sign-out path)", async () => {
      const { rows } = await client.query<{ session_ref: string }>(
        "INSERT INTO sessions (session_ref, day_key, student_name, parent_phone, signed_in_by) VALUES (gen_random_uuid(), CURRENT_DATE, 'A Child', '+2348012345678', 'Staff') RETURNING session_ref",
      );
      const sessionRef = rows[0].session_ref;
      const nowIso = new Date().toISOString();
      await client.query("SELECT sessions_apply_projection($1, $2, $3, $4, $5, $6, $7)", [
        sessionRef,
        new Date().toISOString().slice(0, 10),
        "A Child",
        "+2348012345678",
        "sign_out",
        nowIso,
        "Staff",
      ]);
      const { rows: after } = await client.query<{ signed_out_at: string }>(
        "SELECT signed_out_at FROM sessions WHERE session_ref = $1",
        [sessionRef],
      );
      expect(after[0].signed_out_at).not.toBeNull();
    });

    it("sanctioned correction path updates sessions and writes an append-only audit row", async () => {
      const { rows } = await client.query<{ session_ref: string; server_version: number }>(
        "INSERT INTO sessions (session_ref, day_key, student_name, parent_phone, signed_in_at, signed_in_by, server_version) VALUES (gen_random_uuid(), CURRENT_DATE, 'A Child', '+2348012345678', now(), 'Staff', 1) RETURNING session_ref, server_version",
      );
      const sessionRef = rows[0].session_ref;
      const newValue = new Date().toISOString();
      await client.query("SELECT sessions_apply_correction($1, $2, $3, $4, $5)", [
        sessionRef,
        "signed_in_at",
        newValue,
        rows[0].server_version,
        "Staff",
      ]);
      const { rows: after } = await client.query<{ signed_in_at: string; corrected: boolean }>(
        "SELECT signed_in_at, corrected FROM sessions WHERE session_ref = $1",
        [sessionRef],
      );
      expect(after[0].corrected).toBe(true);
      const { rows: audits } = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM corrections WHERE session_ref = $1",
        [sessionRef],
      );
      expect(Number(audits[0].count)).toBeGreaterThan(0);
    });

    it("PD-D2: exactly one accepted sign-out per session (partial unique index)", async () => {
      const { rows } = await client.query<{ session_ref: string }>(
        "INSERT INTO sessions (session_ref, day_key, student_name, parent_phone) VALUES (gen_random_uuid(), CURRENT_DATE, 'A Child', '+2348012345678') RETURNING session_ref",
      );
      const sessionRef = rows[0].session_ref;
      const insertSignOut = (marker: string) =>
        client.query(
          `INSERT INTO events (event_id, event_type, session_ref, student_name, parent_phone, device_event_at, device_id, device_seq, staff_name, day_key, conflict_marker, ingest_result)
           VALUES (gen_random_uuid(), 'sign_out', $1, 'A Child', '+2348012345678', now(), gen_random_uuid(), 1, 'Staff', CURRENT_DATE, $2, 'accepted')`,
          [sessionRef, marker],
        );

      // First accepted sign-out is allowed.
      await insertSignOut("none");
      // A second accepted sign-out for the same session violates the partial unique index.
      await expect(insertSignOut("none")).rejects.toThrow();
      // A losing sign-out is retained alongside the winner (PD-D3 compatible).
      await insertSignOut("losing");
    });

    it("health_privilege_check returns the current (non-anon) role", async () => {
      const { rows } = await client.query<{ health_privilege_check: string }>(
        "SELECT health_privilege_check() AS health_privilege_check",
      );
      expect(rows[0].health_privilege_check).not.toBe("anon");
      expect(rows[0].health_privilege_check).toBeTruthy();
    });
  },
);
