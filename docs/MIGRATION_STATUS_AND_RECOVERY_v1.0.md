# Migration chain, reset and future changes (Phase 0 D1/D8)

**Status:** the migration chain is corrected for clean installation from an empty
database. A database reset/rebuild from this chain is **intended and approved** but
**has not yet been executed or verified** against the hosted/production Supabase
environment. It remains an owner-executed action only (see `docs/SUPABASE_SETUP_v1.0.md`).

## Migration chain (ordered)

1. `20261031000000_initial_schema.sql` — authoritative initial schema (tables,
   RLS/no policies, append-only guards, sessions mutability guard and sanctioned
   mutation paths, PD-D1 settings, PD-D2 partial unique indexes, health
   privilege probe, audited correction RPC).
2. `20261109000000_atomic_event_ingest.sql` — D1/D8: provisional sessions and
   reconciliation (PD-D3), projection snapshot, atomic
   `ingest_attendance_event` (advisory locking, idempotency, conflict retention
   and audit, atomic projection/review updates).

Applied in order with `supabase db push`, these produce the complete intended
schema on a genuinely empty database.

## Corrected initial migration

`20261031000000_initial_schema.sql` is the authoritative baseline for fresh
installations. Verified corrections include:

- valid sessions mutability guard: `current_setting(..., true) IS DISTINCT FROM 'true'`;
- `sessions_apply_correction` records a real correction event id in
  `corrections.correction_event_id` (FK to `events`) in both applied and
  version-conflict branches;
- `health_privilege_check()` returns the current database role as `text` (the
  `/api/health` privileged-capability probe requires it to equal exactly
  `service_role`);
- `corrections.correction_event_id` is unique, consistent with the contract.

The migration must be reviewed as a whole against the database contract and
approved Phase 0 decisions when changed; do not patch individual lines in
isolation.

## Database reset (intended/approved, not yet executed)

Reset/reprovision is **intended and approved** but **has not yet been executed or
verified**. It is destructive and **owner-executed only** (never automatic).
**Back up/export any data that must be retained before proceeding.** Procedure:

1. Export/backup any data that must be retained; confirm it.
2. Clear/provision a genuinely empty database (no app tables, no prior
   `supabase_migrations.schema_migrations` history for this app).
3. Apply the chain: `supabase db push` (linked) or
   `supabase db push --db-url <url>`.
4. Confirm history rows for `20261031000000` and `20261109000000`.
5. Verify protections, correction RPC, ingest/conflict reconciliation, and
   `/api/health` (`dbReady: true` with a valid operator secret, using the
   `service_role` server connection).

Do not hand-create schema, disable PostgreSQL validation, or fabricate/bypass
migration history.

## Migration failures

Supabase applies each migration file transactionally: a failure rolls that file
back completely (no partial DDL, no history row). Recovery is to fix the
migration in source control and re-run `supabase db push`; do not mark a failed
migration as applied.

## Future schema changes

- Every change is a new, timestamped, **forward-only** migration. Never edit a
  migration after it has been applied to any environment.
- Preserve append-only guarantees, RLS/no-policy posture, sanctioned mutation
  paths, idempotency, PD-D2/PD-D3 semantics, conflict retention and audit
  integrity.
- Verify new migrations on an empty database (full chain) and on the previous
  applied state before promotion. No production migration without explicit
  approval and a verified backup/export.
