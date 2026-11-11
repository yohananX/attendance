# Supabase setup — migrations, reset and clean install

This document describes the corrected Grace House database migration chain, the
intentional database reset, and the normal installation procedure.

> **Credentials:** never commit `.env.local` or secrets. Only add secrets to
> Vercel Environment Variables for deployed environments. The browser never
> talks to Supabase directly.

## 1) Migration chain (authoritative, in order)

| Version | File | Purpose |
|---|---|---|
| `20261031000000` | `supabase/migrations/20261031000000_initial_schema.sql` | Authoritative initial schema: sessions/events/conflicts/corrections/login_attempts/app_settings, RLS enabled with **no policies**, append-only guards, sessions mutability guard and sanctioned mutation paths, PD-D1 settings, PD-D2 partial unique indexes, health privilege probe. |
| `20261109000000` | `supabase/migrations/20261109000000_atomic_event_ingest.sql` | Phase 0 D1/D8: provisional sessions + reconciliation (PD-D3), projection snapshot, and atomic `ingest_attendance_event` (transaction advisory lock, idempotency, conflict retention/audit, projection and review flags committed together). |

Apply them **in order** with the normal Supabase workflow. On a genuinely empty
database this produces the complete intended schema.

### Corrected initial migration (20261031000000)

`20261031000000_initial_schema.sql` is the authoritative baseline for future
fresh installations. It corrects defects that existed in earlier revisions of
that file, including:

- the sessions mutability guard now uses the valid null-safe comparison
  `current_setting('app.session_mutation_authorized', true) IS DISTINCT FROM 'true'`
  (the previous `IS NOT 'true'` form is not valid PL/pgSQL and prevented the
  baseline from applying);
- `sessions_apply_correction` inserts the correction event first and records its
  real `event_id` in `corrections.correction_event_id` (a foreign key to
  `events`) in both the applied and version-conflict branches, so correction
  audit rows can be written;
- `health_privilege_check()` returns the current database role as `text` for the
  `/api/health` privileged-capability probe;
- `corrections.correction_event_id` is unique, consistent with the database
  contract.

## 2) Intentional database reset (owner-executed)

**Project decision:** the existing Supabase database is cleared and rebuilt from
the corrected migration chain. This is a destructive operation on attendance
data and must be performed only by the owner, with explicit confirmation.

**Do not run these steps automatically.** Prepare and verify the migrations
first; the owner executes the reset.

### Exact reset procedure (owner)

1. **Export/backup first** if any data must be retained. End-of-term/operational
   exports are an owner responsibility outside the app; confirm the backup before
   proceeding.
2. In the Supabase Dashboard for the target project, reset/clear the database so
   it is genuinely empty (no application tables, no prior
   `supabase_migrations.schema_migrations` history for this app), or provision a
   fresh empty database/project. (Use the Dashboard’s supported reset/provision
   flow for your project; the exact UI action depends on the project plan.)
3. From a linked checkout of this repository, apply the complete chain with the
   normal CLI workflow:

   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push
   ```

   For a non-linked local disposable database, the equivalent is
   `supabase db push --db-url <postgres-connection-string>`.

4. Confirm both migrations are recorded:

   ```sql
   select version, name
   from supabase_migrations.schema_migrations
   order by version;
   -- expect 20261031000000, 20261109000000
   ```

5. Verify the application: `GET /api/health` with a valid `x-health-secret`
   reports `dbReady: true`, and a test sign-in/sign-out/correction behaves as
   expected.

## 3) Clean installation procedure (future / non-production)

1. Create a Supabase project (dev/staging, not production) or start a local
   Supabase/PostgreSQL instance.
2. Configure environment variables (copy `.env.example` to `.env.local`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`,
   `HEALTH_CHECK_SECRET`, `STAFF_PIN`, `SCHOOL_NAME`,
   `ATTENDANCE_DATASET_ID`.
3. Apply the migration chain against the **empty** database:

   ```bash
   supabase db push            # linked project
   # or: supabase db push --db-url <url>
   ```

   Do **not** hand-create tables/functions, do **not** disable PostgreSQL
   validation, and do **not** fabricate or bypass migration history.
4. Verify:

   ```bash
   npm run dev
   # /api/health with x-health-secret: <HEALTH_CHECK_SECRET> -> ok/dbReady true
   npm run typecheck && npm run build
   ```

## 4) Verification checklist (post-install / post-reset)

- Tables: `sessions`, `events`, `conflicts`, `corrections`, `login_attempts`,
  `app_settings` exist; `sessions.provisional` and
  `sessions_identity_required_unless_provisional` exist; ingest objects exist
  (`ingest_attendance_event`, `session_projection_snapshot`).
- RLS enabled on every data table with **no policies**.
- Append-only triggers on `events`, `corrections`, `conflicts`; sessions guarded
  by `sessions_no_direct_update` / `sessions_mutability_guard`.
- PD-D2 partial unique indexes on accepted sign-in/sign-out per session.
- `app_settings` seeded with PD-D1 defaults (`late_sync_window_days=7`,
  `clock_tolerance_minutes=5`, `future_tolerance_minutes=5`).
- `sessions_apply_correction` writes a real correction event and a referencing
  audit row (applied and version-conflict paths).
- `ingest_attendance_event` commits event, conflict audit and projection
  atomically and is idempotent on `event_id`.

## 5) Future schema changes

- Introduce every change as a **new, timestamped, forward-only** migration in
  `supabase/migrations/`. Never edit a migration that has been applied to any
  environment.
- Preserve append-only guarantees, RLS/no-policy posture, sanctioned session
  mutation paths, PD-D2/PD-D3 semantics, idempotency, conflict retention and
  audit integrity.
- Test new migrations against a genuinely empty database (full chain) and
  against a database at the previous applied state before promoting them.
- Do **not** apply migrations to production without explicit approval and a
  verified backup/export.
