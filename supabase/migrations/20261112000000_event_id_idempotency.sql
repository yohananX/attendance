-- Grace House School Attendance Sign-In — PR #6 remediation
-- Event-ID idempotency integrity for atomic ingestion.
--
-- Forward-only: this migration replaces only the body of
-- ingest_attendance_event(). It does not alter tables, indexes, triggers or
-- existing event rows.
--
-- Why: an event_id is the ingestion idempotency key, so a repeated id must
-- identify the same logical event. Before this change, a caller could reuse an
-- id from a different event (another type, session, timestamp or identity) and
-- receive the original duplicate acknowledgement as if its request had been
-- stored. The duplicate branch below now compares every caller-supplied
-- immutable field and raises event_id_reuse_mismatch on any difference. The
-- check runs before any write, inside the existing transaction, so the original
-- event and its audit history are never modified.
--
-- Server-derived fields are deliberately not compared: p_server_received_at
-- (receipt clock) and p_queued_duration (derived from receipt minus capture)
-- legitimately differ between retries of the same device event.

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
  -- repeat of the same logical event returns the original acknowledgement and
  -- writes no second row.
  SELECT * INTO v_existing FROM events WHERE event_id = p_event_id;
  IF FOUND THEN
    -- A reused event id must describe the same immutable device event. Without
    -- this check, an id from another type/session/payload would be acked as a
    -- successful duplicate and the caller's event would silently be lost.
    IF v_existing.event_type       IS DISTINCT FROM p_event_type
       OR v_existing.session_ref   IS DISTINCT FROM p_session_ref
       OR v_existing.day_key       IS DISTINCT FROM p_day_key
       OR v_existing.student_name  IS DISTINCT FROM p_student_name
       OR v_existing.parent_phone  IS DISTINCT FROM p_parent_phone
       OR v_existing.device_event_at IS DISTINCT FROM p_device_event_at
       OR v_existing.captured_offline IS DISTINCT FROM p_captured_offline
       OR v_existing.device_id     IS DISTINCT FROM p_device_id
       OR v_existing.device_seq    IS DISTINCT FROM p_device_seq
       OR v_existing.staff_name    IS DISTINCT FROM p_staff_name THEN
      RAISE EXCEPTION
        'event_id_reuse_mismatch: event % already identifies a different logical event',
        p_event_id
        USING ERRCODE = '22023';
    END IF;

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

-- CREATE OR REPLACE preserves the existing function's privileges, but restate
-- the server-only grant so a fresh migration chain is explicit about access.
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
