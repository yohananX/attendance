-- Grace House School Attendance Sign-In — initial database schema
-- Implements docs/DATABASE_CONTRACT_v1.0.md (three-part model) and the
-- T1.2 deliverable: empty database ready for the three-part model, RLS
-- enabled with NO policies on every table (S3), service-role-key-only access.
--
-- Applied once to a fresh Supabase project. Re-run is not supported; each
-- statement is idempotent where practical (IF NOT EXISTS / IF EXISTS).
--
-- Trust boundary: the browser holds NO database key. All access is through
-- server route handlers using SUPABASE_SERVICE_ROLE_KEY. RLS with no policies
-- means even the anon/public key reads and writes nothing.

-- ============================================================
-- Table: sessions (Part 2 — session projection, created first for the FK)
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  session_ref        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_key            date NOT NULL,
  student_name       text NOT NULL,
  parent_phone       text NOT NULL CHECK (parent_phone ~ '^\+[0-9]{7,15}$'),
  signed_in_at       timestamptz NULL,
  signed_out_at      timestamptz NULL,
  signed_in_by       text NULL,
  signed_out_by      text NULL,
  server_version     integer NOT NULL DEFAULT 1 CHECK (server_version >= 1),
  corrected          boolean NOT NULL DEFAULT false,
  conflict_type      text NULL CHECK (conflict_type IN ('time_conflict','correction_conflict')),
  late_synced        boolean NOT NULL DEFAULT false,
  needs_review       boolean NOT NULL DEFAULT false,
  whatsapp_launched_at timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Keep sessions.updated_at current on updates
CREATE OR REPLACE FUNCTION set_sessions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_set_updated_at ON sessions;
CREATE TRIGGER sessions_set_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_sessions_updated_at();

-- Sessions mutability guardrail (AC-30.4): direct updates are blocked by default.
-- Sanctioned paths must use dedicated security-definer functions.
CREATE OR REPLACE FUNCTION sessions_mutability_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Direct updates are blocked unless a sanctioned path has authorised the
  -- mutation for this transaction (see sessions_authorize_mutation). This is
  -- the AC-30.4 guardrail: only projection apply, audited correction, launch
  -- marker and conflict flagging may change displayed session state.
  IF current_setting('app.session_mutation_authorized', true) IS NOT 'true' THEN
    RAISE EXCEPTION 'sessions is not directly updatable: use sanctioned projection/correction/marker paths';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_no_direct_update ON sessions;
CREATE TRIGGER sessions_no_direct_update
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION sessions_mutability_guard();

CREATE INDEX IF NOT EXISTS idx_sessions_day_key ON sessions(day_key);
CREATE INDEX IF NOT EXISTS idx_sessions_outstanding_messages
  ON sessions(day_key)
  WHERE whatsapp_launched_at IS NULL AND signed_out_at IS NOT NULL;

-- ============================================================
-- Table: events (Part 1 — append-only event log)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  event_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type         text NOT NULL CHECK (event_type IN ('sign_in','sign_out','correction')),
  session_ref        uuid NOT NULL REFERENCES sessions(session_ref),
  student_name       text NULL CHECK (char_length(student_name) BETWEEN 1 AND 100),
  parent_phone       text NULL CHECK (parent_phone ~ '^\+[0-9]{7,15}$'),
  device_event_at    timestamptz NOT NULL,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  queued_duration    interval NOT NULL CHECK (queued_duration >= interval '0'),
  captured_offline   boolean NOT NULL DEFAULT false,
  device_id          uuid NOT NULL,
  device_seq         bigint NOT NULL,
  staff_name         text NOT NULL,
  day_key            date NOT NULL,
  conflict_marker    text NOT NULL DEFAULT 'none' CHECK (conflict_marker IN ('none','losing','rejected')),
  ingest_result      text NOT NULL DEFAULT 'accepted' CHECK (ingest_result IN ('accepted','conflict')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_device_day_seq
  ON events(device_id, day_key, device_seq);
-- PD-D2 (approved — Stakeholder Decision Register): partial unique indexes
-- enforcing exactly one accepted sign-in and exactly one accepted sign-out
-- per session, as defence-in-depth behind the ingest logic. Compatible with
-- PD-D3 provisional sessions because losing events carry conflict_marker =
-- 'losing' and therefore fall outside these indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_one_sign_in_per_session
  ON events(session_ref) WHERE event_type = 'sign_in' AND conflict_marker = 'none';
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_one_sign_out_per_session
  ON events(session_ref) WHERE event_type = 'sign_out' AND conflict_marker = 'none';

CREATE INDEX IF NOT EXISTS idx_events_day_key ON events(day_key);
CREATE INDEX IF NOT EXISTS idx_events_session_ref ON events(session_ref);
CREATE INDEX IF NOT EXISTS idx_events_device_day ON events(device_id, day_key);
CREATE INDEX IF NOT EXISTS idx_events_server_received_at ON events(server_received_at);

-- ============================================================
-- Table: conflicts (Part 3 — audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS conflicts (
  conflict_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_ref                 uuid NOT NULL REFERENCES sessions(session_ref),
  conflict_type               text NOT NULL CHECK (conflict_type IN ('time_conflict','correction_conflict')),
  winning_event_id            uuid NULL REFERENCES events(event_id),
  losing_event_ids            uuid[] NOT NULL DEFAULT '{}' CHECK (array_length(losing_event_ids, 1) IS NOT NULL AND array_length(losing_event_ids, 1) > 0),
  winner_received_at          timestamptz NULL,
  resolution                  text NULL CHECK (resolution IN ('first_recorded_time','later_event_time')),
  resolution_correction_id    uuid NULL,
  resolved_by                 text NULL,
  resolved_at                 timestamptz NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflicts_session_ref ON conflicts(session_ref);
CREATE INDEX IF NOT EXISTS idx_conflicts_resolution_correction ON conflicts(resolution_correction_id);

-- ============================================================
-- Table: corrections (Part 3 — audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS corrections (
  correction_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_event_id    uuid NOT NULL REFERENCES events(event_id),
  session_ref            uuid NOT NULL REFERENCES sessions(session_ref),
  field                  text NOT NULL CHECK (field IN ('signed_in_at','signed_out_at')),
  original_value         text NOT NULL,
  new_value              text NOT NULL,
  base_value             text NOT NULL,
  base_server_version    integer NOT NULL,
  applied                boolean NOT NULL,
  conflict_id            uuid NULL REFERENCES conflicts(conflict_id),
  edited_by              text NOT NULL,
  edited_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_session_ref ON corrections(session_ref);
CREATE INDEX IF NOT EXISTS idx_corrections_conflict_id ON corrections(conflict_id);

-- Circular back-reference (resolution_correction_id) added after corrections exists.
ALTER TABLE conflicts
  DROP CONSTRAINT IF EXISTS conflicts_resolution_correction_id_fkey,
  ADD CONSTRAINT conflicts_resolution_correction_id_fkey
  FOREIGN KEY (resolution_correction_id) REFERENCES corrections(correction_id);

-- ============================================================
-- Table: login_attempts (Part 3 — audit / rate limit)
-- ============================================================
CREATE TABLE IF NOT EXISTS login_attempts (
  id            bigserial PRIMARY KEY,
  device_id     uuid NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  outcome       text NOT NULL CHECK (outcome IN ('success','failure')),
  ip            text NULL,
  user_agent    text NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_device_time
  ON login_attempts(device_id, attempted_at);

-- ============================================================
-- PD-D1 / Q5: configurable late-sync and clock thresholds.
-- Stored as configuration, never hard-coded. Defaults are proposed values
-- pending Q5 confirmation; operators adjust via configuration, not schema
-- change. The ingest pipeline (T2.2) reads these at runtime.
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   text PRIMARY KEY,
  setting_value text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('late_sync_window_days', '7'),
  ('clock_tolerance_minutes', '5'),
  ('future_tolerance_minutes', '5')
ON CONFLICT (setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key);

-- ============================================================
-- Health endpoint privilege probe (H2).
-- Returns the current database role so /api/health can prove it is operating
-- through the privileged service role (current_user <> 'anon') rather than
-- merely through an anon-key connectivity probe that RLS with no policies
-- would let succeed with an empty result set.
-- ============================================================
CREATE OR REPLACE FUNCTION health_privilege_check()
RETURNS text
LANGUAGE sql
AS $$
  SELECT current_user;
$$;

-- ============================================================
-- H3: sanctioned session mutation paths (DATABASE_CONTRACT §4.2).
-- sessions_authorize_mutation() sets a transaction-local authorisation token
-- that sessions_mutability_guard() requires before allowing any UPDATE on
-- sessions. Direct updates always fail. Each sanctioned function performs its
-- own audit where required (corrections table is append-only).
-- ============================================================
CREATE OR REPLACE FUNCTION sessions_authorize_mutation(p_path text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_path NOT IN ('projection', 'correction', 'launch_marker', 'conflict_flag') THEN
    RAISE EXCEPTION 'unsupported session mutation path: %', p_path;
  END IF;
  SET LOCAL app.session_mutation_authorized = 'true';
  SET LOCAL app.session_mutation_path = p_path;
END;
$$;

-- Ingest projection apply: create a session from an accepted sign-in, or
-- record an accepted sign-out. Idempotent on the sign-in path (first write
-- wins for the session row); sign-out sets the displayed sign-out time once.
CREATE OR REPLACE FUNCTION sessions_apply_projection(
  p_session_ref   uuid,
  p_day_key       date,
  p_student_name  text,
  p_parent_phone  text,
  p_event_type    text,
  p_event_at      timestamptz,
  p_staff_name    text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM sessions_authorize_mutation('projection');
  IF p_event_type = 'sign_in' THEN
    INSERT INTO sessions (session_ref, day_key, student_name, parent_phone,
                          signed_in_at, signed_in_by, server_version)
    VALUES (p_session_ref, p_day_key, p_student_name, p_parent_phone,
            p_event_at, p_staff_name, 1)
    ON CONFLICT (session_ref) DO NOTHING;
  ELSIF p_event_type = 'sign_out' THEN
    UPDATE sessions
    SET signed_out_at = p_event_at, signed_out_by = p_staff_name
    WHERE session_ref = p_session_ref AND signed_out_at IS NULL;
  END IF;
END;
$$;

-- Audited time correction (FR-30). Applies only when the submitted base
-- server_version matches the current version; otherwise flags a correction
-- conflict and does not apply. Writes an append-only corrections audit row.
CREATE OR REPLACE FUNCTION sessions_apply_correction(
  p_session_ref         uuid,
  p_field               text,
  p_new_value           timestamptz,
  p_base_server_version integer,
  p_edited_by           text,
  p_conflict_id         uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_version integer;
  v_old_value       timestamptz;
BEGIN
  PERFORM sessions_authorize_mutation('correction');

  SELECT server_version,
         CASE WHEN p_field = 'signed_in_at' THEN signed_in_at ELSE signed_out_at END
  INTO v_current_version, v_old_value
  FROM sessions
  WHERE session_ref = p_session_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown session: %', p_session_ref;
  END IF;

  IF v_current_version <> p_base_server_version THEN
    -- Version mismatch: do not apply; flag for review, retain both values.
    UPDATE sessions SET conflict_type = 'correction_conflict'
    WHERE session_ref = p_session_ref;
    RETURN v_current_version;
  END IF;

  IF p_field = 'signed_in_at' THEN
    UPDATE sessions SET signed_in_at = p_new_value, server_version = server_version + 1
    WHERE session_ref = p_session_ref;
  ELSE
    UPDATE sessions SET signed_out_at = p_new_value, server_version = server_version + 1
    WHERE session_ref = p_session_ref;
  END IF;

  INSERT INTO corrections (correction_event_id, session_ref, field, original_value,
                           new_value, base_value, base_server_version, applied,
                           conflict_id, edited_by)
  VALUES (gen_random_uuid(), p_session_ref, p_field,
          to_char(v_old_value, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          to_char(p_new_value, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          to_char(v_old_value, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          p_base_server_version, true, p_conflict_id, p_edited_by);

  RETURN v_current_version + 1;
END;
$$;

-- Launch marker (FR-27, PD-D7): first write wins; idempotent.
CREATE OR REPLACE FUNCTION sessions_set_launch_marker(
  p_session_ref uuid,
  p_launched_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM sessions_authorize_mutation('launch_marker');
  UPDATE sessions
  SET whatsapp_launched_at = p_launched_at
  WHERE session_ref = p_session_ref AND whatsapp_launched_at IS NULL;
END;
$$;

-- Conflict flagging (FR-16): set the session conflict type.
CREATE OR REPLACE FUNCTION sessions_flag_conflict(
  p_session_ref  uuid,
  p_conflict_type text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM sessions_authorize_mutation('conflict_flag');
  UPDATE sessions SET conflict_type = p_conflict_type
  WHERE session_ref = p_session_ref;
END;
$$;

-- ============================================================
-- Row-level security: enabled on every table, NO policies.
-- Result: the public/anon key reads and writes nothing; only the service-role
-- key (server-only) can access data. (DATABASE_CONTRACT §9, S2/S3)
-- ============================================================
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

-- Deliberately no CREATE POLICY statements: with RLS enabled and no policies,
-- all non-service-role roles are denied by default.

-- ============================================================
-- Guardrails on events: append-only — UPDATE and DELETE are prohibited at the
-- data layer, with no exception for any role or path. Corrections never touch
-- the log; stored events remain byte-identical (BR-05/07, AC-11.4).
CREATE OR REPLACE FUNCTION events_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only: UPDATE and DELETE are prohibited';
END;
$$;

DROP TRIGGER IF EXISTS events_no_update ON events;
DROP TRIGGER IF EXISTS events_no_delete ON events;

CREATE TRIGGER events_no_update
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_immutable_guard();

CREATE TRIGGER events_no_delete
  BEFORE DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_immutable_guard();

-- Guardrails on corrections: append-only (audit table)
CREATE OR REPLACE FUNCTION corrections_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'corrections is append-only: UPDATE and DELETE are prohibited';
END;
$$;

DROP TRIGGER IF EXISTS corrections_no_update ON corrections;
DROP TRIGGER IF EXISTS corrections_no_delete ON corrections;

CREATE TRIGGER corrections_no_update
  BEFORE UPDATE ON corrections
  FOR EACH ROW
  EXECUTE FUNCTION corrections_immutable_guard();

CREATE TRIGGER corrections_no_delete
  BEFORE DELETE ON corrections
  FOR EACH ROW
  EXECUTE FUNCTION corrections_immutable_guard();

-- Guardrails on conflicts: append-only (audit table)
CREATE OR REPLACE FUNCTION conflicts_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'conflicts is append-only: UPDATE and DELETE are prohibited';
END;
$$;

DROP TRIGGER IF EXISTS conflicts_no_update ON conflicts;
DROP TRIGGER IF EXISTS conflicts_no_delete ON conflicts;

CREATE TRIGGER conflicts_no_update
  BEFORE UPDATE ON conflicts
  FOR EACH ROW
  EXECUTE FUNCTION conflicts_immutable_guard();

CREATE TRIGGER conflicts_no_delete
  BEFORE DELETE ON conflicts
  FOR EACH ROW
  EXECUTE FUNCTION conflicts_immutable_guard();

-- Retention note: no in-app delete of attendance data exists anywhere
-- (BR-07/18, C8, D3). End-of-term purge is an owner-level manual operation
-- outside the application and bypasses these guardrails deliberately.
