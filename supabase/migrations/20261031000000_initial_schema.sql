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
  queued_duration    interval NOT NULL,
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
-- PD-D2: one accepted sign-in binds a session
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_one_sign_in_per_session
  ON events(session_ref)
  WHERE event_type = 'sign_in' AND conflict_marker = 'none';
-- PD-D2: exactly one accepted sign-out per session (BR-06)
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_one_sign_out_per_session
  ON events(session_ref)
  WHERE event_type = 'sign_out' AND conflict_marker = 'none';

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
  losing_event_ids            uuid[] NOT NULL DEFAULT '{}',
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
  correction_event_id    uuid NOT NULL UNIQUE REFERENCES events(event_id),
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
  outcome       text NOT NULL CHECK (outcome IN ('success','failure'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_device_time
  ON login_attempts(device_id, attempted_at);

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
-- ============================================================
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

-- Retention note: no in-app delete of attendance data exists anywhere
-- (BR-07/18, C8, D3). End-of-term purge is an owner-level manual operation
-- outside the application and bypasses these guardrails deliberately.
