# Database Contract v1.1
# Grace House School Attendance Sign-In — with permanent student registry (proposed)

| | |
|---|---|
| **Document** | Database Contract v1.1 |
| **Version** | 1.1 — 31 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Proposed technical contract.** Preserves `docs/DATABASE_CONTRACT_v1.0.md` in full; adds the student registry tables and related changes (marked **proposed — pending owner approval**). No SQL, no migrations are written here. |
| **Supersedes** | `docs/DATABASE_CONTRACT_v1.0.md` is preserved unchanged; this document is additive for the registry. |
| **Authoritative sources** | `docs/PRD_v1.2.md` (requirements), `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md` (proposed student model), `docs/SYSTEM_ARCHITECTURE_v1.1.md`, `docs/STAKEHOLDER_DECISION_REGISTER_v1.1.md` |
| **Companion contracts** | `API_CONTRACT_v1.1.md`, `SYNC_CONTRACT_v1.1.md` |

---

## 1. Conventions (carried forward from v1.0, unchanged)

| Convention | Rule |
|---|---|
| Naming | Tables and columns: `snake_case`. Wire/JSON field names: `camelCase`. |
| Timestamps | All instants stored as `timestamptz` (UTC). Never store a local-zone time as the display truth. |
| Day keys | `day_key` is a `date` = the Africa/Lagos (UTC+1, no DST) calendar date of `device_event_at`. Never the sync date. |
| UUIDs | Client-generated UUID v4 for `event_id` and `session_ref` at capture; server-generated UUIDs for audit rows (`student_id`, `correction_id`, `conflict_id`, and — proposed — student audit/identity-correction IDs). |
| Volume | ~120 events/day + audit rows; single-day, single-school scope (D10). Student registry volumes are small (tens to low hundreds of students). |

---

## 2. Tables and responsibilities (three-part model + student registry — proposed)

| # | Table | Part | Responsibility | Mutability | Status |
|---|---|---|---|---|---|
| 1 | `events` | 1 — Append-only event log | One row per captured action (sign_in, sign_out, correction) | **Append-only** | v1.0 (unchanged) |
| 2 | `sessions` | 2 — Session projection | One row per child-session; the only mutable, UI-facing state | Mutable only through sanctioned paths | v1.0 + proposed `student_id` FK |
| 3 | `corrections` | 3 — Audit | Time-correction audit (who/what/base/when) | Append-only | v1.0 (unchanged) |
| 4 | `conflicts` | 3 — Audit | Competing-event evidence | Append-only | v1.0 (unchanged) |
| 5 | `login_attempts` | 3 — Audit / rate limit | Per-identifier attempt history | Append-only | v1.0 (unchanged) |
| 6 | `app_settings` | Config | PD-D1 configurable thresholds | Configuration | v1.0 (unchanged) |
| 7 | `students` | **Student registry (proposed)** | Permanent student identity; name, parent phone, active flag | Mutable only via audited profile edit; `student_id` immutable | **Proposed — new** |
| 8 | `student_audit` | **Student registry audit (proposed)** | Profile-edit history (name/phone/active, who/when/old/new) | Append-only | **Proposed — new** |
| 9 | `attendance_identity_corrections` | **Identity-correction audit (proposed)** | Linking/re-linking a historical session to a student (authorised) | Append-only | **Proposed — new** |

No other tables are authorised. There is still **no** `days`/`day_closures` table: day close remains a device-side purge scoped by `day_key` (PD-D6).

---

## 3. Table: `students` (proposed — new)

Stable student identity, separate from attendance sessions.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `student_id` | uuid | NO | `gen_random_uuid()` | **PK. Stable student identity.** Immutable; never reused after deactivation (SR-2 pending). |
| `student_name` | text | NO | — | Current display name. CHECK length 1…100. Descriptive attribute — not identity (SR-1). |
| `parent_phone` | text | NO | — | E.164 `^\+[0-9]{7,15}$` (FR-06/BR-10). Prospective-only changes (audited). |
| `is_active` | boolean | NO | `true` | Deactivated students are excluded from selection; historical sessions untouched. |
| `created_at` | timestamptz | NO | `now()` | Registration timestamp. |
| `updated_at` | timestamptz | NO | `now()` | Last profile-edit timestamp. |
| `deactivated_at` | timestamptz | YES | NULL | Set when deactivated; cleared on reactivation. |
| `deactivated_by` | text | YES | NULL | Staff name (audit). |
| `deactivated_reason` | text | YES | NULL | Optional reason (audit). |

### 3.1 Constraints and indexes (`students`, proposed)

| Kind | Definition | Purpose |
|---|---|---|
| PK | `student_id` | Stable identity. |
| Partial unique | Canonical normalised `student_name` + `parent_phone` WHERE `is_active = true` | Enforces the canonical student-matching rule at the database layer: no two active students may share the same normalised name + E.164 phone. Normalisation = case-fold + whitespace collapse + accent-stripping for comparison (stored form preserved); phone stored E.164 (`^\+[0-9]{7,15}$`). Deactivated records do not collide. |
| Index | `parent_phone` (E.164-stored form) | Lookup by phone when finding a returning student. |
| Index | `is_active` | Filter active students for selection lists. |

---

## 4. Table: `sessions` — proposed addition

| Column (addition) | Type | Null | Notes |
|---|---|---|---|
| `student_id` | uuid | YES | FK → `students.student_id`. Nullable: manual-entry sessions (unregistered students) have no student record. **Immutable once set.** |

**Student identity correction rule:** A session's `student_id` may change **only** through a sanctioned, authorised and audited identity-correction operation — never through an ordinary profile edit, never through a direct `UPDATE sessions SET student_id = ...`, and never by mutating the original `events` rows.

- **Original attendance events remain immutable:** `events.student_name`, `events.parent_phone`, and `events.student_id` (if present) are never changed after capture (BR-05/BR-07, AC-11.4).
- **Sanctioned protected function:** The database projection update for an identity re-link must go through a protected, server-side sanctioned function (the same pattern as `sessions_apply_projection`/`sessions_apply_correction`, gated by the `app.session_mutation_authorized` GUC), never through direct SQL.
- **Audit retains full history:** The `attendance_identity_corrections` table records `session_ref`, `previous_student_id` (NULL for manual-entry sessions), `new_student_id`, `reason`, `corrected_by` (actor), and `corrected_at` (timestamp).
- **Ordinary profile edits never change historical attendance identity:** Editing `students.student_name` or `students.parent_phone` (via `student_audit`) is prospective only and does not re-point any `sessions.student_id` or alter any `events` row.

Existing `sessions` columns from v1.0 §4 are unchanged (`session_ref`, `day_key`, `student_name`, `parent_phone`, `signed_in_at`, `signed_out_at`, `signed_in_by`, `signed_out_by`, `server_version`, `corrected`, `conflict_type`, `late_synced`, `needs_review`, `whatsapp_launched_at`, `created_at`, `updated_at`).

> **Proposed decision (pending):** whether `events` also carries `student_id` on the sign-in event for full traceability. This is additive to the append-only event contract and does not change idempotency. Recommended: yes, to make student attribution rebuildable from the log.

---

## 5. Table: `student_audit` (proposed — new)

Append-only profile-edit history.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `student_audit_id` | uuid | NO | server-generated | PK. |
| `student_id` | uuid | NO | — | FK → `students.student_id`. |
| `field` | text | NO | — | CHECK `('student_name','parent_phone','is_active')`. |
| `original_value` | text | NO | — | Value before the edit. |
| `new_value` | text | NO | — | Value after the edit. |
| `edited_by` | text | NO | — | Staff name from active session. |
| `edited_at` | timestamptz | NO | `now()` | — |
| `edit_reason` | text | YES | NULL | Optional staff reason. |

Indexes: `student_id`. Append-only triggers (no UPDATE/DELETE) per the v1.0 guardrail pattern.

---

## 6. Table: `attendance_identity_corrections` (proposed — new)

Append-only audit of linking/re-linking a historical session to a student record (distinct from profile edits and from time corrections). This table is the **audit record of the sanctioned identity-correction operation**; the actual `sessions.student_id` projection update must be performed through a protected server-side sanctioned function (gated by the `app.session_mutation_authorized` GUC), never through direct SQL.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `identity_correction_id` | uuid | NO | server-generated | PK. |
| `session_ref` | uuid | NO | — | FK → `sessions.session_ref`. |
| `previous_student_id` | uuid | YES | NULL | FK → `students.student_id`; NULL for manual-entry sessions. |
| `new_student_id` | uuid | NO | — | FK → `students.student_id`. |
| `reason` | text | YES | NULL | Staff reason for the re-link. |
| `corrected_by` | text | NO | — | Staff name from active session (actor). |
| `corrected_at` | timestamptz | NO | `now()` | Timestamp of the correction. |

Indexes: `session_ref`, `new_student_id`. Append-only (no UPDATE/DELETE) per the v1.0 guardrail pattern. This is **not** a mutation of `events`; historical events keep their original values (P3/P4 of the proposal).

---

## 7. Existing tables unchanged from v1.0

`events` (§3 of v1.0), `sessions` (existing columns), `corrections`, `conflicts`, `login_attempts`, `app_settings`, the RLS/no-policies setting, the append-only triggers, the sessions mutability guardrail with sanctioned functions, the PD-D2 partial unique indexes, PD-D1 settings, and `health_privilege_check()` all carry forward unchanged.

**Cross-contract consistency:** the new `student_id` wire field maps to `students.student_id`; API_CONTRACT_v1.1 §4 (events) gains an optional `studentId` on sign-in; API_CONTRACT_v1.1 adds endpoints R1–R7. Any schema change must update all three contracts. The canonical student-matching rule (case-fold + whitespace collapse + accent-stripping for comparison; E.164 phone) is enforced server-side and by the database partial unique index — frontend duplicate checks are advisory only and must never be the sole enforcement.

---

## 8. Proposed decisions (new, pending)

| ID | Question | Proposed decision | Status |
|---|---|---|---|
| PD-D12 | `students` table structure | As in §3 above; `student_id` UUID PK; name+phone unique among active | Proposed (SR-1) |
| PD-D13 | `student_id` FK on `sessions` | Nullable FK; immutable once set; identity re-links go through `attendance_identity_corrections` | Proposed (SR-3/SR-4) |
| PD-D14 | `student_id` on `events` sign-in | Add optional `student_id` to sign-in events for log-rebuildable attribution | Proposed |
| PD-D15 | `student_audit` and `attendance_identity_corrections` append-only | Append-only triggers; no application UPDATE/DELETE | Proposed |
| PD-D16 | Historical backfill | None automatic; staff-confirmed linking only | Proposed (SR-3) |
