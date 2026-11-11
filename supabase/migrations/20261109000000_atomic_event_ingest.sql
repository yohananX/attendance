-- Grace House School Attendance Sign-In — Phase 0 D1/D8
-- Atomic event ingestion, conflict preservation (PD-D2) and provisional-session
-- reconciliation for orphaned sign-outs (PD-D3).
--
-- Applied after 20261031000000_initial_schema.sql. Together the migrations form
-- the complete, ordered chain for a fresh installation (supabase db push).
-- This file is forward-only: once applied, future schema changes must be
-- introduced as new timestamped migrations, never by editing applied files.
--
-- Why this migration exists: ingestion used to run as two independent requests
-- (projection apply, then event insert). A failure between them left a changed
-- session projection with no event in the append-only log, and a uniqueness
-- violation discarded a valid competing event. ingest_attendance_event() below
-- commits the event row, the conflict audit row, the projection and the review
-- flags in one PostgreSQL transaction, serialised per session.

-- ============================================================
-- 1. Provisional sessions (PD-D3)
-- ============================================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS provisional boolean NOT NULL DEFAULT false;

-- A sign-out that arrives before its sign-in is retained and tracked in a
-- provisional session. No student identity is known at that point, and none is
-- invented, so the identity columns must be nullable for provisional rows only.
-- The CHECK below keeps the original NOT NULL guarantee for every other session
-- (and for provisional rows once reconciliation has filled the identity in).
ALTER TABLE sessions ALTER COLUMN student_name DROP NOT NULL;
ALTER TABLE sessions ALTER COLUMN parent_phone DROP NOT NULL;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_identity_required_unless_provisional;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_identity_required_unless_provisional
  CHECK (provisional OR (student_name IS NOT NULL AND parent_phone IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_sessions_provisional
  ON sessions(day_key)
  WHERE provisional;

-- ============================================================
-- 2. Projection snapshot helper
-- Returns the canonical session snapshot embedded in ingest acknowledgements
-- (API_CONTRACT_v1.0.md §4.2). One definition so every acknowledgement shape
-- stays identical.
-- ============================================================
CREATE OR REPLACE FUNCTION session_projection_snapshot(p_session_ref uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'session_ref', s.session_ref,
    'day_key', s.day_key,
    'student_name', s.student_name,
    'parent_phone', s.parent_phone,
    'signed_in_at', s.signed_in_at,
    'signed_out_at', s.signed_out_at,
    'signed_in_by', s.signed_in_by,
    'signed_out_by', s.signed_out_by,
    'server_version', s.server_version,
    'corrected', s.corrected,
    'conflict_type', s.conflict_type,
    'late_synced', s.late_synced,
    'needs_review', s.needs_review,
    'provisional', s.provisional,
    'whatsapp_launched_at', s.whatsapp_launched_at
  )
  FROM sessions s
  WHERE s.session_ref = p_session_ref;
$$;

-- ============================================================
-- 3. Atomic ingest (E2)
-- One transaction per event: idempotency check, conflict classification,
-- append-only event insert, conflict audit row, projection update and review
-- flags all commit together or not at all.
-- ============================================================
CREATE OR REPLACE FUNCTION ingest_attendance_event(
  p_event_id           uuid,
  p_event_type         text,
  p_session_ref        uuid,
  p_day_key            date,
  p_student_name       text,
  p_parent_phone       text,
  p_device_event_at    timestamptz,
  p_server_received_at timestamptz,
  p_queued_duration    interval,
  p_captured_offline   boolean,
  p_device_id          uuid,
  p_device_seq         bigint,
  p_staff_name         text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing      events;
  v_session       sessions;
  v_winner        events;
  v_conflict_row  conflicts;
  v_conflict_id   uuid;
  v_marker        text := 'none';
  v_ingest_result text := 'accepted';
  v_result        text := 'accepted';
  v_reason        text := NULL;
  v_conflict      jsonb := NULL;
BEGIN
  IF p_event_type NOT IN ('sign_in', 'sign_out') THEN
    RAISE EXCEPTION 'unsupported ingest event type: %', p_event_type
      USING ERRCODE = '22023';
  END IF;

  -- Serialise every ingest for this session, including the very first event,
  -- when there is no sessions row yet to lock. Two devices racing to become
  -- the accepted winner for one session slot cannot both commit as winner:
  -- the second waits here and then sees the first one's committed slot.
  -- Transaction-scoped, so a failed transaction never leaves the slot locked.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('attendance-ingest:' || p_session_ref::text, 0)
  );

  -- Only a sanctioned path may write sessions rows (sessions_mutability_guard).
  PERFORM sessions_authorize_mutation('projection');

  -- Idempotency: event_id is the idempotency key (FR-13, AC-13.1/13.2). A
  -- repeat returns the original acknowledgement and writes no second row.
  SELECT * INTO v_existing FROM events WHERE event_id = p_event_id;
  IF FOUND THEN
    v_result := 'duplicate';
    IF v_existing.ingest_result = 'conflict' THEN
      -- The original acknowledgement for a retained losing event was a
      -- conflict; repeat it (conflict is acceptance-plus-flag, not an error).
      SELECT * INTO v_conflict_row
      FROM conflicts c
      WHERE p_event_id = ANY (c.losing_event_ids)
      ORDER BY c.created_at
      LIMIT 1;
      v_result := 'conflict';
      v_reason := CASE v_existing.event_type
                    WHEN 'sign_in' THEN 'competing_sign_in'
                    ELSE 'competing_sign_out'
                  END;
      IF FOUND THEN
        v_conflict := jsonb_build_object(
          'conflictId', v_conflict_row.conflict_id,
          'type', v_conflict_row.conflict_type,
          'winningEventId', v_conflict_row.winning_event_id,
          'losingEventIds', to_jsonb(v_conflict_row.losing_event_ids)
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'eventId', p_event_id,
      'result', v_result,
      'reason', v_reason,
      'duplicate', true,
      'serverReceivedAt', v_existing.server_received_at,
      'conflict', v_conflict,
      'projection', session_projection_snapshot(v_existing.session_ref)
    );
  END IF;

  -- Lock the projection row once it exists. The advisory lock above already
  -- serialises ingest; this also orders against the sanctioned correction path.
  SELECT * INTO v_session FROM sessions WHERE session_ref = p_session_ref FOR UPDATE;

  IF p_event_type = 'sign_in' THEN
    IF NOT FOUND THEN
      -- First accepted sign-in for this session.
      INSERT INTO sessions (session_ref, day_key, student_name, parent_phone,
                            signed_in_at, signed_in_by, server_version)
      VALUES (p_session_ref, p_day_key, p_student_name, p_parent_phone,
              p_device_event_at, p_staff_name, 1);
    ELSIF v_session.provisional THEN
      -- PD-D3 reconciliation: the sign-out for this session arrived first.
      -- Fill in the real identity and sign-in details; the original sign-out
      -- timestamp (and its append-only event) is left untouched.
      UPDATE sessions
      SET student_name = p_student_name,
          parent_phone = p_parent_phone,
          signed_in_at = p_device_event_at,
          signed_in_by = p_staff_name,
          provisional = false,
          needs_review = true,
          server_version = server_version + 1
      WHERE session_ref = p_session_ref;
      v_reason := 'provisional_reconciled';
    ELSIF v_session.signed_in_at IS NULL THEN
      -- Session row exists without a sign-in (e.g. created by an audited
      -- correction). Record the sign-in without inventing identity.
      UPDATE sessions
      SET student_name = COALESCE(sessions.student_name, p_student_name),
          parent_phone = COALESCE(sessions.parent_phone, p_parent_phone),
          signed_in_at = p_device_event_at,
          signed_in_by = p_staff_name,
          server_version = server_version + 1
      WHERE session_ref = p_session_ref;
    ELSE
      -- Competing sign-in: first synchronised wins (FR-16). The submitted
      -- event is retained as a losing conflict; the winning projection is
      -- never overwritten (only the review flags change below).
      SELECT * INTO v_winner
      FROM events e
      WHERE e.session_ref = p_session_ref
        AND e.event_type = 'sign_in'
        AND e.conflict_marker = 'none'
      ORDER BY e.server_received_at, e.event_id
      LIMIT 1;

      v_marker := 'losing';
      v_ingest_result := 'conflict';
      v_result := 'conflict';
      v_reason := 'competing_sign_in';
    END IF;
  ELSE
    IF NOT FOUND THEN
      -- PD-D3: the sign-out arrived before its sign-in. Keep the evidence and
      -- track it in a provisional session. Identity stays NULL — no placeholder
      -- name or phone number is ever written.
      INSERT INTO sessions (session_ref, day_key, student_name, parent_phone,
                            signed_out_at, signed_out_by, server_version,
                            provisional, needs_review)
      VALUES (p_session_ref, p_day_key, NULL, NULL,
              p_device_event_at, p_staff_name, 1, true, true);
      v_reason := 'provisional_session';
    ELSIF v_session.signed_out_at IS NULL THEN
      -- Accepted sign-out (first synchronised wins).
      UPDATE sessions
      SET signed_out_at = p_device_event_at,
          signed_out_by = p_staff_name,
          server_version = server_version + 1
      WHERE session_ref = p_session_ref;
    ELSE
      -- Competing sign-out: retain it as a losing conflict.
      SELECT * INTO v_winner
      FROM events e
      WHERE e.session_ref = p_session_ref
        AND e.event_type = 'sign_out'
        AND e.conflict_marker = 'none'
      ORDER BY e.server_received_at, e.event_id
      LIMIT 1;

      v_marker := 'losing';
      v_ingest_result := 'conflict';
      v_result := 'conflict';
      v_reason := 'competing_sign_out';
    END IF;
  END IF;

  -- Append-only log row, in the same transaction as the projection change.
  -- A losing event carries conflict_marker='losing', so it sits outside the
  -- PD-D2 partial unique indexes instead of violating them.
  INSERT INTO events (event_id, event_type, session_ref, student_name, parent_phone,
                      device_event_at, server_received_at, queued_duration,
                      captured_offline, device_id, device_seq, staff_name, day_key,
                      conflict_marker, ingest_result)
  VALUES (p_event_id, p_event_type, p_session_ref, p_student_name, p_parent_phone,
          p_device_event_at, p_server_received_at, p_queued_duration,
          p_captured_offline, p_device_id, p_device_seq, p_staff_name, p_day_key,
          v_marker, v_ingest_result);

  IF v_result = 'conflict' THEN
    -- Audit row linking the winning and losing events (Part 3 of the model).
    INSERT INTO conflicts (session_ref, conflict_type, winning_event_id,
                           losing_event_ids, winner_received_at)
    VALUES (p_session_ref, 'time_conflict', v_winner.event_id,
            ARRAY[p_event_id], v_winner.server_received_at)
    RETURNING conflict_id INTO v_conflict_id;

    -- Flag the session for lead-teacher review. Displayed times are untouched.
    UPDATE sessions
    SET conflict_type = CASE
                          WHEN conflict_type = 'correction_conflict' THEN conflict_type
                          ELSE 'time_conflict'
                        END,
        needs_review = true
    WHERE session_ref = p_session_ref;

    v_conflict := jsonb_build_object(
      'conflictId', v_conflict_id,
      'type', 'time_conflict',
      'winningEventId', v_winner.event_id,
      'losingEventIds', jsonb_build_array(p_event_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'eventId', p_event_id,
    'result', v_result,
    'reason', v_reason,
    'duplicate', false,
    'serverReceivedAt', p_server_received_at,
    'conflict', v_conflict,
    'projection', session_projection_snapshot(p_session_ref)
  );
END;
$$;

-- Server-only execution: the route handler calls this with the service-role key.
REVOKE ALL ON FUNCTION ingest_attendance_event(
  uuid, text, uuid, date, text, text, timestamptz, timestamptz, interval,
  boolean, uuid, bigint, text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION ingest_attendance_event(
      uuid, text, uuid, date, text, text, timestamptz, timestamptz, interval,
      boolean, uuid, bigint, text
    ) TO service_role;
  END IF;
END
$$;
