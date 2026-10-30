# Database Contract v1.0
# Grace House School Attendance Sign-In

| | |
|---|---|
| **Document** | Database Contract v1.0 |
| **Version** | 1.0 — 30 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | Proposed technical contract — pending review; stakeholder-gated items (Q5, Q13, Q14, Q16) flagged, not decided |
| **Authoritative sources** | `PRD_v1.2.md` (requirements), `SYSTEM_ARCHITECTURE_v1.0.md` (three-part model §3, security §7, decisions AD-1…AD-10) |
| **Companion contracts** | `API_CONTRACT_v1.0.md`, `SYNC_CONTRACT_v1.0.md` |
| **Scope limits** | Logical schema contract: tables, columns, types, constraints, indexes, protections, conventions. **No SQL, no migrations, no application code** — those belong to implementation (`IMPLEMENTATION_PLAN_v1.0.md` T2.1). |
| **Honesty rules applied** | No pending stakeholder decision is treated as approved. Proposed values (late-sync window, thresholds) are labelled and remain configurable. Where the architecture leaves a detail unresolved, a **proposed decision (PD-D#)** is recorded in §11. |

---

## 1. Conventions

| Convention | Rule | Source |
|---|---|---|
| Naming | Tables and columns: `snake_case`. Wire/JSON field names: `camelCase` (mapping stated per column where it differs) | Architecture §5.2 uses camelCase on the wire |
| Timestamps | All instants stored as `timestamptz` (UTC). Never store a local-zone time as the display truth | Architecture §1.2 (time handling) |
| Day keys | `day_key` is a `date` = the **Africa/Lagos** (UTC+1, no DST) calendar date of `device_event_at`. Never the sync date | PRD §16.4, architecture §3.10 |
| UUIDs | Client-generated UUID v4 for `event_id` and `session_ref` at capture, before persistence; server generates UUIDs only for audit rows (`conflict_id`, `correction_id`) | BR-20, PRD §16.1 (session-ref generation) |
| Booleans/flags | Flags are non-null with safe defaults; nullable columns are nullable for a stated reason | — |
| Volume | ~120 events/day + audit rows; single-day, single-school scope (D10). No sharding, partitioning or archival is required for the pilot | PRD §16.3 |

## 2. Tables and responsibilities (three-part model + audit)

| # | Table | Part | Responsibility | Mutability |
|---|---|---|---|---|
| 1 | `events` | 1 — Append-only event log | One row per captured action (sign_in, sign_out, correction). The immutability guarantee lives here | **Append-only** — no application UPDATE or DELETE path exists |
| 2 | `sessions` | 2 — Session projection | One row per child-session; the only mutable, UI-facing state | Mutable **only** through defined server paths (projection apply, audited correction, launch marker) |
| 3 | `corrections` | 3 — Audit | Who changed a displayed value, what changed, what it was based on | Append-only |
| 4 | `conflicts` | 3 — Audit | Competing-event evidence: winner, losers, resolution | Append-only rows; `resolution` fields may be filled once on resolution |
| 5 | `login_attempts` | 3 — Audit / rate limit | Per-identifier attempt history for server-side rate limiting | Append-only; short retention (§10) |

No other tables are authorised for the pilot. There is **no** `days`/`day_closures` table: day close is a *device-side purge*, and all server state is scoped by `day_key` (see PD-D6, §11).

## 3. Table: `events` (append-only event log)

Source: architecture §3.1, PRD §16.1 Part 1, FR-11/13/15/16, BR-05/20.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `event_id` | uuid | NO | — | **PK.** Client-generated UUID v4 at capture, before persistence. Idempotency key. Immutable, never regenerated (BR-20, FR-13) |
| `event_type` | text | NO | — | CHECK `('sign_in','sign_out','correction')`. Immutable |
| `session_ref` | uuid | NO | — | FK → `sessions.session_ref`. Client-generated at first sign-in; never renumbered (PRD §16.1 note). Immutable |
| `student_name` | text | NO for `sign_in`; NULL otherwise | NULL | Submitted identity carried on the sign-in event so the projection is rebuildable from the log (architecture §3.1). CHECK length 1…100 |
| `parent_phone` | text | NO for `sign_in`; NULL otherwise | NULL | E.164 form `+[7–15 digits]` (FR-06/BR-10); re-validated at ingestion. CHECK `^\+[0-9]{7,15}$` |
| `device_event_at` | timestamptz | NO | — | **Time of record**, captured at the tap (FR-07). **Immutable** (BR-05) |
| `server_received_at` | timestamptz | NO | `now()` at insert | Provenance stamp, set at ingestion. **Immutable** (BR-05) |
| `queued_duration` | interval | NO | derived at insert | `server_received_at − device_event_at`, **labelled queue time, never skew** (FR-12b, AC-12.3). Derived once, stored as evidence, immutable |
| `captured_offline` | boolean | NO | — | Offline-origin flag (FR-12/AC-12.1). Immutable |
| `device_id` | uuid | NO | — | Device attribution; rate-limit key (AD-8). Not a security credential. Immutable |
| `device_seq` | bigint | NO | — | Per-device monotonic capture counter; ordering/regression checks (FR-12c/13). Immutable |
| `staff_name` | text | NO | — | **Server-stamped from the session cookie** — *who said they did it* (BR-01, S7, D6). A client-supplied name is never trusted (PD-D4, §11). Immutable |
| `day_key` | date | NO | — | Lagos calendar date of `device_event_at`; server recomputes and verifies the client's value (architecture §5.2). Immutable |
| `conflict_marker` | text | NO | `'none'` | CHECK `('none','losing','rejected')`. Set at ingest, **never removed** (FR-16 evidence) |
| `ingest_result` | text | NO | `'accepted'` | CHECK `('accepted','conflict')`. What the ingest pipeline returned for this event (`conflict` = accepted-but-flagged, architecture §5.5). Feeds idempotent duplicate responses (§7) |

### 3.1 Constraints and indexes (`events`)

| Kind | Definition | Purpose |
|---|---|---|
| PK | `event_id` | Identity/idempotency (FR-13) |
| Unique | `(device_id, day_key, device_seq)` | One capture cannot occupy one device slot twice; detects sequence anomalies (proposed — PD-D5, §11) |
| Partial unique | `(session_ref)` where `event_type='sign_in'` and `conflict_marker='none'` | One accepted sign-in binds a session (BR-06 analog for sign-in; PD-D2) |
| Partial unique | `(session_ref)` where `event_type='sign_out'` and `conflict_marker='none'` | **Exactly one accepted sign-out per session** — BR-06 enforced at the data layer (PD-D2) |
| FK | `session_ref` → `sessions.session_ref` | Event ↔ session integrity (created in the same ingest transaction) |
| Index | `day_key` | Day review, CSV, outstanding-message scoping (FR-31/33) |
| Index | `session_ref` | Rebuild projection from log; conflict evidence retrieval |
| Index | `(device_id, day_key)` | Ordering/consistency checks (FR-12c) |
| Index | `server_received_at` | First-synchronised-wins ordering (FR-16) |

### 3.2 Immutability requirements (database-enforced)

- **No application path updates or deletes an event.** Corrections never touch the log; stored events remain byte-identical (AC-11.4, BR-07, architecture §7.7).
- Database guardrails (specified conceptually; SQL belongs to T2.1): a **no-delete trigger** and an **update lock** on `events` — no exception is granted to any table or path. (The architecture's "correction-only exception" applies to `sessions` displayed times, not to `events` — §5 below.)
- Retention purge is an **owner-level manual operation outside the app** (BR-18, D3); it bypasses application guardrails deliberately and is out of contract scope.

## 4. Table: `sessions` (session projection)

Source: architecture §3.2, PRD §16.1 Part 2.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `session_ref` | uuid | NO | — | **PK.** Client-generated at first sign-in capture, before persistence; server binds and never renumbers (PRD §16.1) |
| `day_key` | date | NO | — | Lagos date of the accepted sign-in event; scoping key for lists, review, CSV (§16.4). A late event **never re-dates** a session (architecture §3.9) |
| `student_name` | text | NO | — | Current identity; editable only via audited identity edit (FR-29, cut for pilot) |
| `parent_phone` | text | NO | — | E.164 CHECK as `events` |
| `signed_in_at` | timestamptz | YES | NULL | **Displayed** sign-in time, derived from the accepted sign-in event's `device_event_at`; changes **only** via the audited correction path (FR-30, BR-08) |
| `signed_out_at` | timestamptz | YES | NULL | Same rules as `signed_in_at` |
| `signed_in_by` | text | YES | NULL | Attribution (BR-01) |
| `signed_out_by` | text | YES | NULL | Attribution |
| `server_version` | integer | NO | `1` | Monotonic counter; incremented on every accepted change; the **base for correction version checks** (FR-30, architecture §3.8) |
| `corrected` | boolean | NO | `false` | Visible "corrected" flag (icon + text in UI) |
| `conflict_type` | text | YES | NULL | CHECK `('time_conflict','correction_conflict')`; NULL = no open conflict (FR-32/AC-32.2) |
| `late_synced` | boolean | NO | `false` | Set when any attached event was synchronised inside the late-sync window (E23, AC-15.5) |
| `needs_review` | boolean | NO | `false` | Umbrella flag for lead-teacher review (consistency flags, orphaned events — PD-D3) |
| `whatsapp_launched_at` | timestamptz | YES | NULL | **Server-held launch marker** (AD-9, FR-27). Written only through the authenticated launch call. **Never named or rendered as "sent"/"delivered"** (BR-13, Q15 pending) |
| `created_at` | timestamptz | NO | `now()` | — |
| `updated_at` | timestamptz | NO | `now()` | — |

### 4.1 Constraints and indexes (`sessions`)

| Kind | Definition | Purpose |
|---|---|---|
| PK | `session_ref` | Client-generated reference is the key (no server renumbering) |
| Index | `day_key` | Day-scoped read models (FR-17/19/20/31/33) |
| Partial index | `day_key` where `whatsapp_launched_at IS NULL` and `signed_out_at IS NOT NULL` | Outstanding-messages list (FR-26, AC-26.4/35.5) |
| CHECK | `server_version >= 1` | Version sanity for correction checks |

### 4.2 Mutability rules (`sessions`)

1. **Projection apply** (ingest): create row from an accepted `sign_in`; update displayed times/attribution from the first accepted `sign_out`; bump `server_version`.
2. **Audited correction** (FR-30): change `signed_in_at`/`signed_out_at` only when the correction's base `server_version` equals current → apply, set `corrected`, bump `server_version`. On mismatch → **do not apply**; flag `conflict_type='correction_conflict'`, retain both values (AC-30.5).
3. **Launch marker** (FR-27): set `whatsapp_launched_at` once (idempotent; first write wins — PD-D7).
4. **Conflict flagging** (FR-16): set `conflict_type='time_conflict'` when a competing event loses; never changes displayed times.
5. **No delete path** exists in the application (BR-07). All other updates fail (AC-30.4).

## 5. Table: `corrections` (audit — append-only)

Source: architecture §3.3, PRD §16.1 Part 3, FR-29/30, S13.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `correction_id` | uuid | NO | server-generated | **PK.** Audit rows need no client idempotency (written inside the ingest transaction of the correction event) |
| `correction_event_id` | uuid | NO | — | UNIQUE, FK → `events.event_id`. The append-only log entry for this correction |
| `session_ref` | uuid | NO | — | FK → `sessions.session_ref` |
| `field` | text | NO | — | CHECK `('signed_in_at','signed_out_at')`; values `'student_name'`,`'parent_phone'` **reserved** for FR-29 identity edits (cut for pilot — PD-D8) |
| `original_value` | text | NO | — | Displayed value before the change (ISO-8601 for times) |
| `new_value` | text | NO | — | Proposed/displayed value after the change |
| `base_value` | text | NO | — | The value the editor saw (conflict evidence — FR-30) |
| `base_server_version` | integer | NO | — | Version the correction was based on (FR-30 conflict-safe design) |
| `applied` | boolean | NO | — | `false` when the version check failed and the correction was flagged instead of applied (AC-30.5) |
| `conflict_id` | uuid | YES | NULL | FK → `conflicts.conflict_id` — links a conflict-resolution correction (AD-4, AC-16.3) |
| `edited_by` | text | NO | — | Staff name from the active session (BR-01/09, S13) |
| `edited_at` | timestamptz | NO | `now()` | — |

Indexes: `session_ref`, `correction_event_id` (unique), `conflict_id`.

## 6. Table: `conflicts` (audit — append-only)

Source: architecture §3.3/§3.7, FR-16/32, BR-12.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `conflict_id` | uuid | NO | server-generated | **PK** |
| `session_ref` | uuid | NO | — | FK → `sessions.session_ref` |
| `conflict_type` | text | NO | — | CHECK `('time_conflict','correction_conflict')` |
| `winning_event_id` | uuid | YES | NULL | FK → `events.event_id`. NULL for `correction_conflict` (no winning event) |
| `losing_event_ids` | uuid[] | NO | — | One or more retained losing events (PD-D9: array vs child table) |
| `winner_received_at` | timestamptz | YES | NULL | The winning event's `server_received_at` — the first-synchronised-wins evidence (FR-16) |
| `resolution` | text | YES | NULL | CHECK `('first_recorded_time','later_event_time')`; NULL while unresolved (AD-4 choices) |
| `resolution_correction_id` | uuid | YES | NULL | FK → `corrections.correction_id` — resolution is always an audited correction (AC-16.3) |
| `resolved_by` | text | YES | NULL | — |
| `resolved_at` | timestamptz | YES | NULL | — |
| `created_at` | timestamptz | NO | `now()` | — |

**Both original events remain retrievable afterwards** — the conflict row links them; neither is ever deleted (AC-16.3, BR-12).

## 7. Table: `login_attempts` (audit / rate limit)

Source: architecture §3.3/§4.6, FR-03, S4.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | NO | generated | **PK** |
| `device_id` | uuid | NO | — | Per-browser identifier (AD-8). Reset-on-storage-clear limitation documented in FR-03 |
| `attempted_at` | timestamptz | NO | `now()` | — |
| `outcome` | text | NO | — | CHECK `('success','failure')`. Lockout state is *derived* from failure counts in the last 5 minutes — no row written for "locked" (PD-D10) |

Index: `(device_id, attempted_at)`. Policy: **5 failures in 5 minutes → 5-minute lockout** (FR-03/BR-03), enforced server-side; the client counts the same identifier independently. PINs and verifiers are **never** stored or logged (S5, FR-01).

## 8. Session projection and audit relationships

```
events (append-only)  ──session_ref──►  sessions (projection)
   ▲                                        │
   │ correction_event_id                    │ session_ref
   │                                        ▼
corrections ──conflict_id──► conflicts ──session_ref──► sessions
   (resolution_correction_id back-reference)

login_attempts — standalone (keyed by device_id, no FK to sessions/events)
```

- The projection is **derived state**: rebuildable from the log (`events` ordered by `server_received_at`, first-synchronised-wins) plus the correction chain (architecture §3.2, §5.4 step 5).
- Audit rows (`corrections`, `conflicts`) are **evidence**: append-only, never updated except one-time resolution fields on `conflicts`.
- The outstanding-message list derives from `sessions` (server-held — AD-9), which is why it survives device purge, device change and day close (AC-26.4, AC-35.5).

## 9. Row-level security and server-only privileged operations

| Requirement | Rule | Source |
|---|---|---|
| RLS | **RLS enabled on every table with no policies.** The public/anon key reads and writes nothing | S3, architecture §4.7/§7.6 |
| Browser access | The browser holds **no database key at all**; there is no direct Supabase access path from the client | S2, AC-G1 |
| Service role | All reads/writes flow through server route handlers using `SUPABASE_SERVICE_ROLE_KEY` from Vercel environment variables only | S2, architecture §1.2 |
| Privileged operations | Ingestion, projection, corrections, conflicts, launch marker, queries, rate-limit reads/writes — **server-only**; each behind a valid session cookie | AC-04.4 |
| Secrets | No service-role key, database URL or PIN material in page source, client bundles or network responses | AC-G1 |
| Retention purge | End-of-term export + manual purge by the owner **outside the application** — no in-app delete of attendance data exists anywhere (BR-07/18, C8, D3) | §10 |

## 10. Timestamp, timezone and retention conventions

| Topic | Rule |
|---|---|
| Storage | All instants `timestamptz`, stored UTC |
| Display | Always `Intl.DateTimeFormat` with `timeZone: 'Africa/Lagos'`, 12-hour, with date (FR-22, BR-15) |
| `day_key` | Lagos calendar date of `device_event_at` — computed server-side at ingest and verified against the client's value (§16.4) |
| Future tolerance | `device_event_at` not more than **5 minutes** ahead of `server_received_at` (**proposed, Q5 pending**); **no backwards tolerance** (S12, X-3) |
| Late-sync window | `day_key` accepted within Lagos day + **7 days** (**proposed, Q5 pending** — keep configurable, PD-D1); later → rejected to device `failed-review`, never dropped (AC-15.5) |
| Skew flag threshold | Ahead-of-receipt consistency flag at **5 minutes** (**proposed, Q5 pending**, AD-3). Flags surface on the projection via `needs_review`; probes are advisory, never a gate |
| Immutability | `device_event_at`, `server_received_at`, `queued_duration` immutable on `events` (BR-05) |
| Attendance retention | No in-app delete; owner exports CSV then purges manually at end of term (BR-18, S8, D3) |
| `login_attempts` retention | Purge rows older than **24 hours** (proposed — PD-D11); lockout needs only a 5-minute window |
| Device retention | Device-side data is purged at gated day close (FR-35) — a client-side operation; the server copy is intentionally untouched |

## 11. Proposed decisions (PD-D#) — unresolved in the architecture, proposed here

| ID | Question | Proposed decision | Status |
|---|---|---|---|
| **PD-D1** | Late-sync window value | Store as **configuration**, default **7 days**; never hard-code. Changes require only configuration, not schema change | Awaiting **Q5** |
| **PD-D2** | Enforcing "exactly one accepted sign-out" at the data layer | Partial unique indexes on `events(session_ref)` for non-`losing` sign_in/sign_out rows (§3.1). Defence-in-depth behind the ingest logic | Proposed |
| **PD-D3** | Sign-out event arriving for a session whose sign-in has not yet synchronised (cross-device, offline) | **Accept into the log** (never drop evidence), create a **provisional session** with `needs_review`, flag the event; re-project when the sign-in arrives. Alternative rejected: reject-to-review strands a legitimate event | Proposed — not addressed in architecture §5.4 |
| **PD-D4** | `staff_name` on the wire vs cookie | Server **ignores** any client-supplied staff name and stamps from the cookie (BR-01, S7); the wire field is informational only | Proposed |
| **PD-D5** | Uniqueness of `(device_id, day_key, device_seq)` | Enforce with a unique constraint; a violation is a consistency flag, not a rejection of the primary `event_id` path | Proposed |
| **PD-D6** | Server-side day-close record | **None.** Day close is a device purge; server state is scoped by `day_key`. An optional `day_closures` audit row may be added later; not required by PRD/architecture and not in this contract | Proposed |
| **PD-D7** | Launch-marker idempotency | First write wins: a second `launched` call for the same session returns the existing `whatsapp_launched_at` unchanged | Proposed |
| **PD-D8** | FR-29 identity-edit audit storage | Reserve `'student_name'`/`'parent_phone'` values in `corrections.field`; the feature is a cut item for the pilot (PRD §28) | Proposed (deferred) |
| **PD-D9** | `conflicts.losing_event_ids` as array vs child table | Array (`uuid[]`) — volumes are ~120 events/day; a child table adds no pilot value | Proposed |
| **PD-D10** | Lockout representation | Derived from recent failure counts; no "locked" row written | Proposed |
| **PD-D11** | `login_attempts` retention | 24 hours, purged server-side (cron/on-read pruning) | Proposed |

## 12. Cross-contract consistency

- **Wire ↔ column mapping:** `API_CONTRACT_v1.0.md` §4 and `SYNC_CONTRACT_v1.0.md` §3 define the camelCase wire schema; every field maps 1:1 to a column above (`deviceEventAt` → `device_event_at`, etc.). The client never learns column names — the mapping is for server code only.
- **Idempotency:** `event_id` PK + `ingest_result` support the duplicate-returns-original-acknowledgement rule (§7 of the API contract).
- **Day close:** no server table changes at close; outstanding messages survive because they live on `sessions` (AC-35.5).
- **Immutable events:** no contract endpoint or client state assumes an update or delete of `events` (sync contract §9).

*End of Database Contract v1.0. No SQL, no migrations, no application code. PRD v1.2 and SYSTEM_ARCHITECTURE_v1.0 remain authoritative; this contract resolves implementation detail only and takes no stakeholder decision.*
