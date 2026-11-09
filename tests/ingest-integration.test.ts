import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// Live-PostgreSQL tests for atomic event ingestion (D1/D8): conflict
// preservation (PD-D2), orphaned sign-out reconciliation (PD-D3), idempotency
// and rollback. These are the tests that establish database-level correctness;
// unit tests cannot prove transaction, locking or uniqueness behaviour.

const DATABASE_URL = process.env.DATABASE_URL;

// Shared advisory-lock key: serialises migration DDL across test files that run
// in parallel against the same disposable database.
const MIGRATION_LOCK = 8123456;

const MIGRATIONS = [
  "supabase/migrations/20261031000000_initial_schema.sql",
  "supabase/migrations/20261109000000_atomic_event_ingest.sql",
].map((file) => fs.readFileSync(path.resolve(file), "utf8"));

const INGEST_SQL = `SELECT ingest_attendance_event(
  $1::uuid, $2::text, $3::uuid, $4::date, $5::text, $6::text,
  $7::timestamptz, $8::timestamptz, $9::interval, $10::boolean,
  $11::uuid, $12::bigint, $13::text
) AS ack`;

interface IngestInput {
  eventId: string;
  eventType: "sign_in" | "sign_out";
  sessionRef: string;
  dayKey: string;
  studentName: string | null;
  parentPhone: string | null;
  deviceEventAt: string;
  serverReceivedAt: string;
  queuedDuration: string;
  capturedOffline: boolean;
  deviceId: string;
  deviceSeq: number;
  staffName: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ack = any;

const today = new Date().toISOString().slice(0, 10);

function event(overrides: Partial<IngestInput> = {}): IngestInput {
  const deviceEventAt = new Date().toISOString();
  return {
    eventId: randomUUID(),
    eventType: "sign_in",
    sessionRef: randomUUID(),
    dayKey: today,
    studentName: "Ada Obi",
    parentPhone: "+2348012345678",
    deviceEventAt,
    serverReceivedAt: new Date().toISOString(),
    queuedDuration: "0 milliseconds",
    capturedOffline: false,
    deviceId: randomUUID(),
    deviceSeq: 1,
    staffName: "Grace",
    ...overrides,
  };
}

function params(input: IngestInput): unknown[] {
  return [
    input.eventId,
    input.eventType,
    input.sessionRef,
    input.dayKey,
    input.studentName,
    input.parentPhone,
    input.deviceEventAt,
    input.serverReceivedAt,
    input.queuedDuration,
    input.capturedOffline,
    input.deviceId,
    input.deviceSeq,
    input.staffName,
  ];
}

async function ingest(db: Client, input: IngestInput): Promise<Ack> {
  const { rows } = await db.query(INGEST_SQL, params(input));
  return rows[0].ack;
}

/**
 * Ingest in its own committed transaction. Competing/concurrent cases rely on
 * the transaction ending so the per-session advisory lock is released.
 */
async function ingestAndCommit(db: Client, input: IngestInput): Promise<Ack> {
  await db.query("BEGIN");
  try {
    const ack = await ingest(db, input);
    await db.query("COMMIT");
    return ack;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function iso(value: string): string {
  return new Date(value).toISOString();
}

describe.skipIf(!DATABASE_URL)("atomic event ingestion (live PostgreSQL)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      for (const sql of MIGRATIONS) await client.query(sql);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  }, 120_000);

  afterAll(async () => {
    await client.end().catch(() => undefined);
  });

  async function connect(): Promise<Client> {
    const db = new Client({ connectionString: DATABASE_URL });
    await db.connect();
    return db;
  }

  it("accepts the first sign-in and retains a competing sign-in as a conflict", async () => {
    const sessionRef = randomUUID();
    const winner = event({ eventType: "sign_in", sessionRef, studentName: "Ada Obi" });
    const first = await ingestAndCommit(client, winner);
    expect(first.result).toBe("accepted");
    expect(first.projection.signed_in_at).not.toBeNull();
    expect(first.projection.provisional).toBe(false);

    const loser = event({
      eventType: "sign_in",
      sessionRef,
      studentName: "Different Child",
      parentPhone: "+2348099999999",
      deviceSeq: 2,
      deviceEventAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const second = await ingestAndCommit(client, loser);

    expect(second.result).toBe("conflict");
    expect(second.reason).toBe("competing_sign_in");
    expect(second.conflict.type).toBe("time_conflict");
    expect(second.conflict.winningEventId).toBe(winner.eventId);
    expect(second.conflict.losingEventIds).toEqual([loser.eventId]);

    // The losing event is retained in the append-only log with the conflict
    // marker that keeps it outside the PD-D2 partial unique indexes.
    const { rows: retained } = await client.query(
      "SELECT event_type, conflict_marker, ingest_result FROM events WHERE event_id = $1",
      [loser.eventId],
    );
    expect(retained).toHaveLength(1);
    expect(retained[0].conflict_marker).toBe("losing");
    expect(retained[0].ingest_result).toBe("conflict");
  });

  it("accepts the first sign-out and retains a competing sign-out as a conflict", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef }));

    const winner = event({ eventType: "sign_out", sessionRef, studentName: null, parentPhone: null });
    const first = await ingestAndCommit(client, winner);
    expect(first.result).toBe("accepted");
    expect(iso(first.projection.signed_out_at)).toBe(iso(winner.deviceEventAt));

    const loser = event({
      eventType: "sign_out",
      sessionRef,
      studentName: null,
      parentPhone: null,
      deviceEventAt: new Date(Date.now() + 120_000).toISOString(),
      deviceSeq: 2,
    });
    const second = await ingestAndCommit(client, loser);

    expect(second.result).toBe("conflict");
    expect(second.reason).toBe("competing_sign_out");
    // Displayed sign-out time stays with the first synchronised event.
    expect(iso(second.projection.signed_out_at)).toBe(iso(winner.deviceEventAt));

    const { rows: retained } = await client.query(
      "SELECT conflict_marker FROM events WHERE event_id = $1",
      [loser.eventId],
    );
    expect(retained[0].conflict_marker).toBe("losing");
  });

  it("records a conflict audit row linking the winning and losing event ids", async () => {
    const sessionRef = randomUUID();
    const winner = event({ eventType: "sign_in", sessionRef });
    await ingestAndCommit(client, winner);
    const loser = event({ eventType: "sign_in", sessionRef, deviceSeq: 2 });
    const ack = await ingestAndCommit(client, loser);

    const { rows } = await client.query(
      "SELECT session_ref, conflict_type, winning_event_id, losing_event_ids, winner_received_at " +
        "FROM conflicts WHERE conflict_id = $1",
      [ack.conflict.conflictId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].session_ref).toBe(sessionRef);
    expect(rows[0].conflict_type).toBe("time_conflict");
    expect(rows[0].winning_event_id).toBe(winner.eventId);
    expect(rows[0].losing_event_ids).toEqual([loser.eventId]);
    expect(iso(rows[0].winner_received_at)).toBe(iso(winner.serverReceivedAt));
  });

  it("does not let a losing event alter the winning projection", async () => {
    const sessionRef = randomUUID();
    const winner = event({ eventType: "sign_in", sessionRef, studentName: "Ada Obi" });
    const first = await ingestAndCommit(client, winner);
    await ingestAndCommit(client, event({ eventType: "sign_out", sessionRef, studentName: null, parentPhone: null }));

    const before = (
      await client.query(
        "SELECT student_name, parent_phone, signed_in_at, signed_out_at, server_version " +
          "FROM sessions WHERE session_ref = $1",
        [sessionRef],
      )
    ).rows[0];

    const loser = event({
      eventType: "sign_out",
      sessionRef,
      studentName: null,
      parentPhone: null,
      deviceEventAt: new Date(Date.now() + 300_000).toISOString(),
      deviceSeq: 2,
    });
    const ack = await ingestAndCommit(client, loser);

    const after = (
      await client.query(
        "SELECT student_name, parent_phone, signed_in_at, signed_out_at, server_version " +
          "FROM sessions WHERE session_ref = $1",
        [sessionRef],
      )
    ).rows[0];

    expect(ack.result).toBe("conflict");
    expect(after.student_name).toBe(before.student_name);
    expect(after.parent_phone).toBe(before.parent_phone);
    expect(iso(after.signed_in_at)).toBe(iso(before.signed_in_at));
    expect(iso(after.signed_out_at)).toBe(iso(before.signed_out_at));
    expect(after.server_version).toBe(before.server_version);
    expect(iso(after.signed_in_at)).toBe(iso(first.projection.signed_in_at));
  });

  it("flags a conflict as time_conflict / needs_review and reports it in the acknowledgement", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef }));

    expect(
      (await client.query("SELECT needs_review, conflict_type FROM sessions WHERE session_ref = $1", [sessionRef]))
        .rows[0].needs_review,
    ).toBe(false);

    const ack = await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef, deviceSeq: 2 }));

    expect(ack.result).toBe("conflict");
    expect(ack.conflict).toMatchObject({ type: "time_conflict" });
    expect(ack.projection.needs_review).toBe(true);
    expect(ack.projection.conflict_type).toBe("time_conflict");

    const { rows } = await client.query(
      "SELECT needs_review, conflict_type FROM sessions WHERE session_ref = $1",
      [sessionRef],
    );
    expect(rows[0].needs_review).toBe(true);
    expect(rows[0].conflict_type).toBe("time_conflict");
  });

  it("creates a provisional session for a sign-out that arrives before its sign-in", async () => {
    const sessionRef = randomUUID();
    const signOut = event({
      eventType: "sign_out",
      sessionRef,
      studentName: null,
      parentPhone: null,
    });
    const ack = await ingestAndCommit(client, signOut);

    expect(ack.result).toBe("accepted");
    expect(ack.reason).toBe("provisional_session");
    expect(ack.projection.provisional).toBe(true);
    expect(ack.projection.needs_review).toBe(true);
    // No identity is invented for a provisional session.
    expect(ack.projection.student_name).toBeNull();
    expect(ack.projection.parent_phone).toBeNull();
    expect(ack.projection.signed_in_at).toBeNull();
    expect(iso(ack.projection.signed_out_at)).toBe(iso(signOut.deviceEventAt));

    const { rows: sessionRows } = await client.query(
      "SELECT provisional, student_name, parent_phone FROM sessions WHERE session_ref = $1",
      [sessionRef],
    );
    expect(sessionRows[0].provisional).toBe(true);
    expect(sessionRows[0].student_name).toBeNull();
    expect(sessionRows[0].parent_phone).toBeNull();
  });

  it("reconciles the provisional session when the matching sign-in arrives", async () => {
    const sessionRef = randomUUID();
    const signOut = event({
      eventType: "sign_out",
      sessionRef,
      studentName: null,
      parentPhone: null,
    });
    const provisional = await ingestAndCommit(client, signOut);

    const signIn = event({
      eventType: "sign_in",
      sessionRef,
      studentName: "Ada Obi",
      parentPhone: "+2348033333333",
      deviceSeq: 2,
      deviceEventAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const reconciled = await ingestAndCommit(client, signIn);

    expect(reconciled.result).toBe("accepted");
    expect(reconciled.reason).toBe("provisional_reconciled");
    expect(reconciled.projection.provisional).toBe(false);
    expect(reconciled.projection.student_name).toBe("Ada Obi");
    expect(reconciled.projection.parent_phone).toBe("+2348033333333");
    expect(iso(reconciled.projection.signed_in_at)).toBe(iso(signIn.deviceEventAt));
    // The original sign-out timestamp survives reconciliation.
    expect(iso(reconciled.projection.signed_out_at)).toBe(iso(provisional.projection.signed_out_at));
  });

  it("preserves the original sign-out event through reconciliation", async () => {
    const sessionRef = randomUUID();
    const signOut = event({
      eventType: "sign_out",
      sessionRef,
      studentName: null,
      parentPhone: null,
    });
    await ingestAndCommit(client, signOut);
    await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef, deviceSeq: 2 }));

    const { rows } = await client.query(
      "SELECT event_id, event_type, session_ref, device_event_at, conflict_marker, ingest_result, student_name " +
        "FROM events WHERE event_id = $1",
      [signOut.eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe("sign_out");
    expect(rows[0].session_ref).toBe(sessionRef);
    expect(iso(rows[0].device_event_at)).toBe(iso(signOut.deviceEventAt));
    expect(rows[0].conflict_marker).toBe("none");
    expect(rows[0].ingest_result).toBe("accepted");
    expect(rows[0].student_name).toBeNull();
  });

  it("returns the original acknowledgement for a repeated event id", async () => {
    const input = event({ eventType: "sign_in", sessionRef: randomUUID() });
    const first = await ingestAndCommit(client, input);
    const second = await ingestAndCommit(client, input);

    expect(second.result).toBe("duplicate");
    expect(iso(second.serverReceivedAt)).toBe(iso(first.serverReceivedAt));
    expect(second.projection.session_ref).toBe(first.projection.session_ref);

    const { rows } = await client.query("SELECT count(*)::int AS n FROM events WHERE event_id = $1", [
      input.eventId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("returns the original conflict acknowledgement for a repeated losing event id", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef }));
    const loser = event({ eventType: "sign_in", sessionRef, deviceSeq: 2 });

    const first = await ingestAndCommit(client, loser);
    const second = await ingestAndCommit(client, loser);

    expect(first.result).toBe("conflict");
    expect(second.result).toBe("conflict");
    expect(second.conflict.conflictId).toBe(first.conflict.conflictId);
    expect(second.conflict.winningEventId).toBe(first.conflict.winningEventId);

    const { rows: events } = await client.query("SELECT count(*)::int AS n FROM events WHERE event_id = $1", [
      loser.eventId,
    ]);
    expect(events[0].n).toBe(1);
    const { rows: conflicts } = await client.query(
      "SELECT count(*)::int AS n FROM conflicts WHERE session_ref = $1",
      [sessionRef],
    );
    expect(conflicts[0].n).toBe(1);
  });

  it("keeps concurrent duplicate submissions to one event row", async () => {
    const first = await connect();
    const second = await connect();
    try {
      const input = event({ eventType: "sign_out", sessionRef: randomUUID(), studentName: null, parentPhone: null });
      const results = await Promise.all([
        ingestAndCommit(first, input),
        ingestAndCommit(second, input),
      ]);

      expect(results.map((ack) => ack.result).sort()).toEqual(["accepted", "duplicate"]);
      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM events WHERE event_id = $1",
        [input.eventId],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await first.end().catch(() => undefined);
      await second.end().catch(() => undefined);
    }
  });

  it("resolves concurrent competing events to one winner and one retained loser", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef }));

    const first = await connect();
    const second = await connect();
    try {
      const a = event({ eventType: "sign_out", sessionRef, deviceSeq: 2 });
      const b = event({
        eventType: "sign_out",
        sessionRef,
        deviceSeq: 3,
        deviceEventAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const results = await Promise.all([ingestAndCommit(first, a), ingestAndCommit(second, b)]);

      const byResult = new Map(results.map((ack, index) => [ack.result, index === 0 ? a : b]));
      expect([...byResult.keys()].sort()).toEqual(["accepted", "conflict"]);

      const winner = byResult.get("accepted")!;
      const loser = byResult.get("conflict")!;

      const { rows: winners } = await client.query(
        "SELECT event_id FROM events WHERE session_ref = $1 AND event_type = 'sign_out' AND conflict_marker = 'none'",
        [sessionRef],
      );
      expect(winners).toHaveLength(1);
      expect(winners[0].event_id).toBe(winner.eventId);

      const { rows: losers } = await client.query(
        "SELECT event_id FROM events WHERE session_ref = $1 AND conflict_marker = 'losing'",
        [sessionRef],
      );
      expect(losers).toHaveLength(1);
      expect(losers[0].event_id).toBe(loser.eventId);

      const { rows: conflicts } = await client.query(
        "SELECT winning_event_id, losing_event_ids FROM conflicts WHERE session_ref = $1",
        [sessionRef],
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].winning_event_id).toBe(winner.eventId);
      expect(conflicts[0].losing_event_ids).toEqual([loser.eventId]);

      const { rows: sessions } = await client.query(
        "SELECT signed_out_at FROM sessions WHERE session_ref = $1",
        [sessionRef],
      );
      expect(iso(sessions[0].signed_out_at)).toBe(iso(winner.deviceEventAt));
    } finally {
      await first.end().catch(() => undefined);
      await second.end().catch(() => undefined);
    }
  });

  it("rolls the event insert, conflict audit and projection back together on a database failure", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef }));
    await ingestAndCommit(client, event({ eventType: "sign_out", sessionRef, studentName: null, parentPhone: null }));

    const before = (
      await client.query(
        "SELECT signed_out_at, conflict_type, needs_review, server_version FROM sessions WHERE session_ref = $1",
        [sessionRef],
      )
    ).rows[0];

    const losing = event({
      eventType: "sign_out",
      sessionRef,
      studentName: null,
      parentPhone: null,
      deviceSeq: 2,
      deviceEventAt: new Date(Date.now() + 600_000).toISOString(),
    });

    await client.query("BEGIN");
    await client.query(
      `CREATE OR REPLACE FUNCTION fail_conflict_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'injected conflict audit failure';
       END;
       $$`,
    );
    await client.query(
      "CREATE TRIGGER fail_conflict_audit BEFORE INSERT ON conflicts FOR EACH ROW EXECUTE FUNCTION fail_conflict_audit()",
    );
    await expect(ingest(client, losing)).rejects.toThrow(/injected conflict audit failure/);
    await client.query("ROLLBACK");

    // Nothing from the failed transaction survives: no event, no losing marker,
    // no conflict audit row, and an unchanged projection.
    const { rows: events } = await client.query("SELECT 1 FROM events WHERE event_id = $1", [losing.eventId]);
    expect(events).toHaveLength(0);
    const { rows: losingEvents } = await client.query(
      "SELECT 1 FROM events WHERE session_ref = $1 AND conflict_marker = 'losing'",
      [sessionRef],
    );
    expect(losingEvents).toHaveLength(0);
    const { rows: conflicts } = await client.query("SELECT 1 FROM conflicts WHERE session_ref = $1", [
      sessionRef,
    ]);
    expect(conflicts).toHaveLength(0);

    const after = (
      await client.query(
        "SELECT signed_out_at, conflict_type, needs_review, server_version FROM sessions WHERE session_ref = $1",
        [sessionRef],
      )
    ).rows[0];
    expect(iso(after.signed_out_at)).toBe(iso(before.signed_out_at));
    expect(after.conflict_type).toBe(before.conflict_type);
    expect(after.needs_review).toBe(before.needs_review);
    expect(after.server_version).toBe(before.server_version);

    // The injected trigger was rolled back with the transaction, so the
    // database is left exactly as it was.
    const { rows: triggers } = await client.query(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'fail_conflict_audit'",
    );
    expect(triggers).toHaveLength(0);
  });

  it("leaves previously accepted sessions and events readable and unchanged", async () => {
    const sessionRef = randomUUID();
    const winner = event({ eventType: "sign_in", sessionRef, studentName: "Ada Obi" });
    const accepted = await ingestAndCommit(client, winner);
    await ingestAndCommit(client, event({ eventType: "sign_in", sessionRef, deviceSeq: 2 }));

    const { rows: events } = await client.query(
      "SELECT event_type, session_ref, student_name, device_event_at, ingest_result, conflict_marker " +
        "FROM events WHERE event_id = $1",
      [winner.eventId],
    );
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("sign_in");
    expect(events[0].student_name).toBe("Ada Obi");
    expect(iso(events[0].device_event_at)).toBe(iso(winner.deviceEventAt));
    expect(events[0].ingest_result).toBe("accepted");
    expect(events[0].conflict_marker).toBe("none");

    const { rows: sessions } = await client.query(
      "SELECT student_name, parent_phone, signed_in_at FROM sessions WHERE session_ref = $1",
      [sessionRef],
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].student_name).toBe("Ada Obi");
    expect(sessions[0].parent_phone).toBe("+2348012345678");
    expect(iso(sessions[0].signed_in_at)).toBe(iso(accepted.projection.signed_in_at));
  });
});
