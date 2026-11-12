import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// Live-PostgreSQL tests for the atomic path the legacy /api/sign-out route now
// uses. The route itself is covered by tests/sign-out-route.test.ts; these are
// the tests that prove the database invariants the route relies on: immutable
// event persistence, idempotency, competing-sign-out uniqueness and rollback.

const DATABASE_URL = process.env.DATABASE_URL;

const MIGRATION_LOCK = 8123456;

const MIGRATIONS = [
  "supabase/migrations/20261031000000_initial_schema.sql",
  "supabase/migrations/20261109000000_atomic_event_ingest.sql",
  "supabase/migrations/20261112000000_event_id_idempotency.sql",
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

function signIn(sessionRef: string): IngestInput {
  return {
    eventId: randomUUID(),
    eventType: "sign_in",
    sessionRef,
    dayKey: today,
    studentName: "Ada Obi",
    parentPhone: "+2348012345678",
    deviceEventAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    serverReceivedAt: new Date().toISOString(),
    queuedDuration: "0 milliseconds",
    capturedOffline: false,
    deviceId: randomUUID(),
    deviceSeq: 1,
    staffName: "Grace",
  };
}

/** The payload the legacy route builds: no identity, device/server capture time. */
function legacySignOut(sessionRef: string, overrides: Partial<IngestInput> = {}): IngestInput {
  const deviceEventAt = new Date().toISOString();
  return {
    eventId: randomUUID(),
    eventType: "sign_out",
    sessionRef,
    dayKey: today,
    studentName: null,
    parentPhone: null,
    deviceEventAt,
    serverReceivedAt: deviceEventAt,
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

async function connect(): Promise<Client> {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  return db;
}

function iso(value: string): string {
  return new Date(value).toISOString();
}

describe.skipIf(!DATABASE_URL)("legacy sign-out atomic ingest (live PostgreSQL)", () => {
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

  it("persists the immutable sign-out event and the projection in one commit", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, signIn(sessionRef));

    const signOut = legacySignOut(sessionRef);
    const ack = await ingestAndCommit(client, signOut);

    expect(ack.result).toBe("accepted");
    expect(ack.duplicate).toBe(false);
    expect(iso(ack.projection.signed_out_at)).toBe(iso(signOut.deviceEventAt));
    expect(ack.projection.signed_out_by).toBe("Grace");

    const { rows: events } = await client.query(
      "SELECT event_type, session_ref, device_event_at, staff_name, conflict_marker, ingest_result " +
        "FROM events WHERE event_id = $1",
      [signOut.eventId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "sign_out",
      session_ref: sessionRef,
      staff_name: "Grace",
      conflict_marker: "none",
      ingest_result: "accepted",
    });
    expect(iso(events[0].device_event_at)).toBe(iso(signOut.deviceEventAt));

    const { rows: sessions } = await client.query(
      "SELECT signed_out_at, signed_out_by, server_version FROM sessions WHERE session_ref = $1",
      [sessionRef],
    );
    expect(iso(sessions[0].signed_out_at)).toBe(iso(signOut.deviceEventAt));
    expect(sessions[0].signed_out_by).toBe("Grace");
    expect(sessions[0].server_version).toBe(2);
  });

  it("does not create a second accepted sign-out for a repeated event id", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, signIn(sessionRef));
    const signOut = legacySignOut(sessionRef);

    const first = await ingestAndCommit(client, signOut);
    const afterFirst = (
      await client.query("SELECT server_version FROM sessions WHERE session_ref = $1", [sessionRef])
    ).rows[0].server_version;

    const second = await ingestAndCommit(client, signOut);
    const afterSecond = (
      await client.query("SELECT server_version FROM sessions WHERE session_ref = $1", [sessionRef])
    ).rows[0].server_version;

    expect(first.result).toBe("accepted");
    expect(second.result).toBe("duplicate");
    expect(second.duplicate).toBe(true);
    expect(iso(second.serverReceivedAt)).toBe(iso(first.serverReceivedAt));
    expect(afterSecond).toBe(afterFirst);

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM events WHERE event_id = $1",
      [signOut.eventId],
    );
    expect(rows[0].n).toBe(1);
    const { rows: accepted } = await client.query(
      "SELECT count(*)::int AS n FROM events WHERE session_ref = $1 AND event_type = 'sign_out' " +
        "AND conflict_marker = 'none'",
      [sessionRef],
    );
    expect(accepted[0].n).toBe(1);
  });

  it("rejects reuse of an event id for a different event type", async () => {
    const sessionRef = randomUUID();
    const first = signIn(sessionRef);
    await ingestAndCommit(client, first);

    const conflicting = legacySignOut(sessionRef, { eventId: first.eventId });
    await expect(ingestAndCommit(client, conflicting)).rejects.toThrow(/event_id_reuse_mismatch/);

    const { rows } = await client.query(
      "SELECT event_type, session_ref FROM events WHERE event_id = $1",
      [first.eventId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "sign_in", session_ref: sessionRef });
  });

  it("rejects reuse of an event id for a different session reference", async () => {
    const first = signIn(randomUUID());
    await ingestAndCommit(client, first);

    const otherSession = signIn(randomUUID());
    await expect(
      ingestAndCommit(client, { ...otherSession, eventId: first.eventId }),
    ).rejects.toThrow(/event_id_reuse_mismatch/);

    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM events WHERE event_id = $1",
      [first.eventId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("rejects reuse of an event id with a materially different timestamp", async () => {
    const sessionRef = randomUUID();
    const first = signIn(sessionRef);
    await ingestAndCommit(client, first);

    const conflicting = {
      ...first,
      deviceEventAt: new Date(new Date(first.deviceEventAt).getTime() - 60_000).toISOString(),
    };
    await expect(ingestAndCommit(client, conflicting)).rejects.toThrow(/event_id_reuse_mismatch/);
  });

  it("rejects reuse of an event id with a different immutable payload and preserves the original row", async () => {
    const sessionRef = randomUUID();
    const first = signIn(sessionRef);
    await ingestAndCommit(client, first);

    const before = (
      await client.query(
        "SELECT event_id, event_type, session_ref, student_name, parent_phone, device_event_at, " +
          "captured_offline, device_id, device_seq, staff_name, day_key, conflict_marker, ingest_result " +
          "FROM events WHERE event_id = $1",
        [first.eventId],
      )
    ).rows[0];

    await expect(
      ingestAndCommit(client, { ...first, staffName: "Alice" }),
    ).rejects.toThrow(/event_id_reuse_mismatch/);

    const after = (
      await client.query(
        "SELECT event_id, event_type, session_ref, student_name, parent_phone, device_event_at, " +
          "captured_offline, device_id, device_seq, staff_name, day_key, conflict_marker, ingest_result " +
          "FROM events WHERE event_id = $1",
        [first.eventId],
      )
    ).rows[0];
    expect(after).toEqual(before);

    const { rows: count } = await client.query(
      "SELECT count(*)::int AS n FROM events WHERE session_ref = $1",
      [sessionRef],
    );
    expect(count[0].n).toBe(1);
    const { rows: conflicts } = await client.query(
      "SELECT count(*)::int AS n FROM conflicts WHERE session_ref = $1",
      [sessionRef],
    );
    expect(conflicts[0].n).toBe(0);
  });

  it("keeps concurrent submissions with the same event id to one event row", async () => {
    const first = await connect();
    const second = await connect();
    try {
      const input = legacySignOut(randomUUID());
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

  it("does not let concurrent reuse with a different payload become a second accepted event", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, signIn(sessionRef));

    const first = await connect();
    const second = await connect();
    try {
      const a = legacySignOut(sessionRef);
      const b = {
        ...a,
        deviceEventAt: new Date(Date.now() + 60_000).toISOString(),
        deviceSeq: 2,
      };
      const outcomes = await Promise.allSettled([
        ingestAndCommit(first, a),
        ingestAndCommit(second, b),
      ]);

      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<Ack> => outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value.result).toBe("accepted");
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason)).toMatch(/event_id_reuse_mismatch/);

      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM events WHERE event_id = $1",
        [a.eventId],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await first.end().catch(() => undefined);
      await second.end().catch(() => undefined);
    }
  });

  it("retains a competing sign-out as a conflict without bypassing the uniqueness invariant", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, signIn(sessionRef));

    const winner = legacySignOut(sessionRef);
    const loser = legacySignOut(sessionRef, {
      deviceEventAt: new Date(Date.now() + 60_000).toISOString(),
      deviceSeq: 2,
    });

    const first = await ingestAndCommit(client, winner);
    const second = await ingestAndCommit(client, loser);

    expect(first.result).toBe("accepted");
    expect(second.result).toBe("conflict");
    expect(second.reason).toBe("competing_sign_out");
    expect(iso(second.projection.signed_out_at)).toBe(iso(winner.deviceEventAt));

    const { rows: accepted } = await client.query(
      "SELECT count(*)::int AS n FROM events WHERE session_ref = $1 AND event_type = 'sign_out' " +
        "AND conflict_marker = 'none'",
      [sessionRef],
    );
    expect(accepted[0].n).toBe(1);

    const { rows: loserRows } = await client.query(
      "SELECT conflict_marker, ingest_result FROM events WHERE event_id = $1",
      [loser.eventId],
    );
    expect(loserRows[0]).toMatchObject({ conflict_marker: "losing", ingest_result: "conflict" });

    const { rows: conflicts } = await client.query(
      "SELECT winning_event_id, losing_event_ids FROM conflicts WHERE session_ref = $1",
      [sessionRef],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].winning_event_id).toBe(winner.eventId);
    expect(conflicts[0].losing_event_ids).toEqual([loser.eventId]);
  });

  it("rolls the sign-out event back when the projection update fails", async () => {
    const sessionRef = randomUUID();
    await ingestAndCommit(client, signIn(sessionRef));

    const before = (
      await client.query(
        "SELECT signed_out_at, server_version FROM sessions WHERE session_ref = $1",
        [sessionRef],
      )
    ).rows[0];

    const signOut = legacySignOut(sessionRef);

    await client.query("BEGIN");
    await client.query(
      `CREATE OR REPLACE FUNCTION fail_projection_update() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'injected projection failure';
       END;
       $$`,
    );
    await client.query(
      "CREATE TRIGGER fail_projection_update BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION fail_projection_update()",
    );
    await expect(ingest(client, signOut)).rejects.toThrow(/injected projection failure/);
    await client.query("ROLLBACK");

    const { rows: events } = await client.query(
      "SELECT 1 FROM events WHERE event_id = $1",
      [signOut.eventId],
    );
    expect(events).toHaveLength(0);

    const after = (
      await client.query(
        "SELECT signed_out_at, server_version FROM sessions WHERE session_ref = $1",
        [sessionRef],
      )
    ).rows[0];
    expect(after.signed_out_at).toBeNull();
    expect(after.server_version).toBe(before.server_version);

    const { rows: triggers } = await client.query(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'fail_projection_update'",
    );
    expect(triggers).toHaveLength(0);
  });
});
