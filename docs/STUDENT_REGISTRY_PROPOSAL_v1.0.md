# Student Registry Proposal — Grace House School Attendance
# Deliverable D — v1.0 (analysis and safe design only)

| | |
|---|---|
| **Document** | Student Registry Proposal v1.0 |
| **Version** | 1.0 |
| **Date** | 31 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Proposal — not approved.** No stakeholder decision recorded here is approved. All new decisions are proposed defaults pending owner sign-off. |
| **Purpose** | Analyse the database and architecture implications of adding a permanent student registry to the existing attendance application, and propose a safe design. |
| **Scope limits** | **No student-entry UI is specified or built here.** The exact UX for finding and entering a returning student is deliberated and approved separately. **No database migrations are proposed for application yet**, and no migration is to be applied to production as part of this document. |
| **Preserved decisions** | All approved decisions in `STAKEHOLDER_DECISION_REGISTER_v1.0.md` (PD-D1, PD-D2, PD-D3, PD-A4, PD-A5, PD-A8, PD-A1, PD-S6) and pending questions (Q5, Q13–Q16) are preserved unchanged. Nothing here overrides them. |
| **Source baseline** | `docs/CURRENT_STATE_AUDIT_v1.1.md` (Deliverable A), `docs/DATABASE_CONTRACT_v1.0.md`, `docs/SYSTEM_ARCHITECTURE_v1.0.md`, `docs/API_CONTRACT_v1.0.md`, `docs/PRD_v1.2.md` |

---

## 1. Problem and requirement

Today, every attendance session re-enters a student's name and parent phone number by hand. When a student returns for a subsequent weekly Saturday lesson, staff cannot select an existing record; they re-type everything.

The product now wants a **permanent student registry** so that:

1. A student can be registered once.
2. An existing student can be found.
3. A returning student can be selected for attendance.
4. Their saved attendance-relevant details (name, parent phone) are retrieved automatically.
5. A student not yet registered can still be entered manually (manual entry must remain available — an unregistered student must never be blocked from attending).
6. A student's saved name and parent phone can be edited.
7. A student can be deactivated without deleting historical attendance.
8. A student's attendance history can be viewed.
9. Duplicate or potentially matching student records are handled safely.
10. Historical attendance records can be reconciled with the new registry where reliable matching is possible.

**Core rule:** the student registry and attendance sessions are separate concepts.

```
students
  ├── attendance session — Week 1
  ├── attendance session — Week 2
  ├── attendance session — Week 3
  └── attendance session — Week 4
```

A student has a **stable identity across multiple attendance dates**. Each lesson attendance remains a **separate session** with its own arrival, departure and event history.

---

## 2. Design principles (non-negotiable)

| # | Principle | Rationale |
|---|---|---|
| P1 | **Do not identify students by name alone.** Names are not unique and are mistyped. Matching uses the **canonical student-matching rule**: normalised `student_name` + normalised `parent_phone`, compared server-side and enforced by the database uniqueness constraint. Normalisation = Unicode case-fold, collapse internal/leading/trailing whitespace, strip accents/diacritics for comparison only (stored form preserved), and phone normalised to E.164 (`^\+[0-9]{7,15}$` per FR-06/BR-10). Duplicate checks are enforced server-side and at the database layer — never frontend-only. Explicit staff confirmation is required before any match is acted on. | Prevents wrong-student attribution. |
| P2 | **Do not automatically merge historical records merely because names match.** Reconciliation requires reliable matching and explicit, audited authorisation. | Preserves existing attendance evidence. |
| P3 | **Preserve existing attendance events and their original values.** Student profile changes never mutate `events` rows. | The event log is append-only (BR-05/BR-07, AC-11.4). |
| P4 | **Editing a permanent student profile must not silently rewrite historical attendance.** Edits change the registry row; historical sessions keep the name/phone captured at the time. | Separates current contact data from historical evidence. |
| P5 | **Attendance identity corrections are separate, authorised and auditable.** Linking an existing historical session to a (different) student record is an identity correction, not a profile edit; it must be recorded (who, when, why, original link). | Keeps the audit trail intact under the shared-PIN model. |
| P6 | **Establish a stable student ID with database constraints.** `student_id` (UUID PK) is the immutable identity; normalised name + parent phone should be unique among *active* students to prevent accidental duplicates. | Stable cross-week identity; referential integrity. |
| P7 | **Handle parent phone changes and duplicate registrations explicitly.** A phone change updates the registry row (audited) and is prospective only; duplicates are flagged for review, not auto-merged. | Contact data stays current without corrupting history. |
| P8 | **Preserve existing offline and event-sync semantics.** Introducing student identity must not break write-ahead capture, idempotency, conflict preservation, or the outbox state machine. Manual entry (unregistered student) must remain fully offline-capable. | No regression of the working attendance chain. |
| P9 | **Keep data collection minimal.** The registry holds only what attendance operations require: student name, parent phone, active flag, timestamps. No broader student-information system. | Data minimisation per §3 of the audit mandate. |

---

## 3. Proposed student data model

A new table `students` is added to the server schema. It is **separate** from `sessions` and `events`.

### 3.1 Table: `students` (proposed, not yet in any migration)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `student_id` | uuid | NO | `gen_random_uuid()` | **PK. Stable student identity.** Immutable. Never reused, even after deactivation. |
| `student_name` | text | NO | — | Current display name. CHECK length 1…100. Editable via audited profile edit (P4). |
| `parent_phone` | text | NO | — | E.164 `^\+[0-9]{7,15}$` (FR-06/BR-10 normalisation). Editable via audited profile edit; change is prospective (P7). |
| `is_active` | boolean | NO | `true` | Deactivation flag. Deactivated students are excluded from selection but historical sessions are untouched (P3/P7). |
| `created_at` | timestamptz | NO | `now()` | Registration timestamp. |
| `updated_at` | timestamptz | NO | `now()` | Last profile-edit timestamp. |
| `deactivated_at` | timestamptz | YES | NULL | Set when deactivated; cleared on reactivation. |
| `deactivated_by` | text | YES | NULL | Staff name who deactivated (audit). |
| `deactivated_reason` | text | YES | NULL | Optional reason (audit). |

### 3.2 Constraints and indexes (proposed)

| Kind | Definition | Purpose |
|---|---|---|
| PK | `student_id` | Stable identity (P6). |
| Partial unique | Canonical normalised `student_name` + `parent_phone` **where `is_active = true`** | Enforces the canonical student-matching rule (P1) at the database layer: no two active students may share the same normalised name + E.164 phone. Partial index so deactivated/reactivated records do not collide with historical ones. |
| Index | `parent_phone` (E.164-stored form) | Lookup by phone when searching for a returning student. |
| Index | `is_active` | Filter active students for selection lists. |

> **Canonical matching rule (server + database enforced):** normalise `student_name` via Unicode case-fold + whitespace collapse + accent-stripping for comparison (stored form preserved); normalise `parent_phone` to E.164 (`^\+[0-9]{7,15}$` per FR-06/BR-10). The partial unique index enforces this exact rule server-side. Frontend duplicate checks are advisory only and must never be the sole enforcement.
>
> **Proposed decision (new, pending owner approval):** the exact uniqueness surface (name+phone combined vs phone-only) and the accent-handling mechanism for the comparison (e.g. PostgreSQL `unaccent` extension vs plain `LOWER`) must be confirmed. PD-A5 (name+phone+dayKey for competing sign-in) applies to *sessions*, not to the student registry; the registry needs its own matching rule (SR-1). Do not treat PD-A5 as approved for the registry.

### 3.3 Student profile audit table (proposed)

| Column | Type | Null | Notes |
|---|---|---|---|
| `student_audit_id` | uuid | NO | PK, server-generated. |
| `student_id` | uuid | NO | FK → `students.student_id`. |
| `field` | text | NO | CHECK `('student_name','parent_phone','is_active')`. |
| `original_value` | text | NO | Value before the edit. |
| `new_value` | text | NO | Value after the edit. |
| `edited_by` | text | NO | Staff name from active session. |
| `edited_at` | timestamptz | NO | `now()`. |
| `edit_reason` | text | YES | Optional staff reason. |

Append-only (no UPDATE/DELETE) — same guardrail pattern as `corrections`/`conflicts`.

---

## 4. Stable student identity

- `student_id` is a server-generated UUID (or client-generated at registration when online — either way, immutable once created). It is the **only** stable identifier used to relate a student to attendance sessions.
- `student_name` and `parent_phone` are **descriptive, mutable attributes** — not identity. They may change (marriage, new phone, typo fix) without changing `student_id`.
- Historical attendance references the `student_id` that was current at the time of capture; it is never re-pointed by a later profile edit (P3/P4).
- A student who leaves and returns later is **reactivated** (`is_active = true`, cleared `deactivated_at`), not re-registered. This preserves their `student_id` and history (P7).

**Proposed decision (pending):** whether `student_id` is server-generated at registration (simplest, online registration) or client-generated UUID to allow offline registration. Given manual entry must remain offline-capable and registration is an administrative (not gate-critical) task, **server-generated at online registration** is the recommended safe default; offline registration of brand-new students can be deferred.

---

## 5. Relationship to attendance sessions

### 5.1 Sessions reference students

The existing `sessions` projection gains a nullable foreign key:

| Column (proposed addition to `sessions`) | Type | Null | Notes |
|---|---|---|---|
| `student_id` | uuid | YES | FK → `students.student_id`. Nullable because manual-entry sessions (unregistered students) have no student record yet. **Immutable once set.** |

**Student identity correction rule (P5):** A session's student identity may change **only** through a sanctioned, authorised and audited identity-correction operation — never through an ordinary profile edit, never directly on the `sessions` table, and never by mutating the original `events` rows.

- **Original attendance events remain immutable** (BR-05/BR-07, AC-11.4): `events.student_name`, `events.parent_phone`, and `events.student_id` (if present) are never changed after capture.
- **Sanctioned protected function:** The database projection update for an identity re-link must go through a protected, server-side function (the same sanctioned-path pattern as `sessions_apply_projection`/`sessions_apply_correction`), never through a direct `UPDATE sessions SET student_id = ...`.
- **Audit retains full history:** The `attendance_identity_corrections` table records `session_ref`, `previous_student_id` (NULL for manual-entry sessions), `new_student_id`, `reason`, `corrected_by` (actor), and `corrected_at` (timestamp).
- **Ordinary profile edits never change historical attendance identity:** Editing a student's `student_name` or `parent_phone` (via `student_audit`) is prospective only and does not re-point any `sessions.student_id` or alter any `events` row.

The existing `events` table carries `student_name` and `parent_phone` on the sign-in event (already the case) so the projection is rebuildable from the log. Optionally, `events` may also carry `student_id` on the sign-in event for full traceability; this is **proposed** and does not change the append-only contract.

### 5.2 Conceptual model (preserved)

```
students (student_id PK)
    │ 1
    │──┐ 0..*
    ▼    ▼
sessions (session_ref PK, student_id FK nullable)
    │ 1
    │──┐ 0..*
    ▼    ▼
events (event_id PK, session_ref FK)   — append-only, one row per captured action
```

- One student → many sessions (one per lesson week).
- One session → exactly one student (nullable at capture for manual entry; may be backfilled by an authorised identity correction later).
- One session → many events (sign_in, sign_out, correction) — already the case today.

### 5.3 Manual entry remains available

A session created by manual entry (name + phone typed at the gate) has `student_id = NULL` until/unless:
- the student is later registered and the session is linked via an **authorised identity correction** (P5), or
- the gate flow is enhanced (post-approval UI) to select an existing student at sign-in, in which case `student_id` is set at capture.

Manual entry must **never** be blocked by the absence of a registry record (P8/P9).

**Proposed decision (pending):** whether the gate sign-in flow offers student selection at capture (post-UI-approval) or remains manual-entry-only with optional later linking. This is the UX decision deferred by the mandate.

---

## 6. Historical record migration and matching

Existing attendance data (sessions and events captured before the registry) has **no `student_id`** — it carries only `student_name` and `parent_phone` (captured at the gate).

### 6.1 Migration approach (proposed)

Migration is **opt-in and conservative**: historical sessions are **not** automatically linked to students. Linking happens only where matching is reliable and explicitly authorised.

Proposed matching rule for candidate linking (uses the canonical student-matching rule, P1):
- Normalise the historical session's `student_name` and `parent_phone` using the canonical rule (case-fold + whitespace collapse + accent-stripping for comparison; phone E.164).
- Look up active `students` with matching normalised name + phone.
- **Exactly one** candidate → propose a link for staff confirmation (authorised identity correction, audit recorded).
- **Zero** candidates → leave `student_id = NULL` (manual-entry session; no change).
- **Multiple** candidates (possible duplicate) → do **not** link automatically; flag for manual review (P2, P9).

**Proposed decision (pending):** the accent-handling mechanism for the comparison (e.g. PostgreSQL `unaccent` extension vs plain `LOWER`) and any matching tolerance must be confirmed before any migration script is written. Fuzzy matching (e.g. "Chidi" vs "Chidiebere") is **not** recommended for automatic linking — too high a risk of wrong-student attribution under P1/P2.

### 6.2 What migration must not do

- Do not create student records automatically from historical sessions without staff review (bulk auto-registration is rejected — it would invent identity and merge records contrary to P2).
- Do not overwrite historical `student_name`/`parent_phone` on `events` or `sessions` when a profile is edited (P4).
- Do not delete or re-date any historical session/event (BR-07).
- Do not treat name-only equality as a match (P1).

### 6.3 Reconciliation as an authorised operation

Linking a historical session to a student record is an **attendance identity correction**:
- Record: session_ref, previous `student_id` (NULL), new `student_id`, reason, `edited_by`, `edited_at`.
- Stored in a new `attendance_identity_corrections` audit table (proposed) — separate from `students` profile edits (`student_audit`) and from time corrections (`corrections`).
- Requires staff authorisation; under the shared-PIN model, attribution is the active session's name (BR-01/S7/D6 — process rule, audit-logged).

**Proposed decision (pending):** the exact audit-table name and whether identity corrections require a second staff member (dual authorisation) given the shared-PIN limitation.

---

## 7. Duplicate handling

### 7.1 Duplicate registration at creation

When registering a new student (server-side, endpoint R1):
1. Normalise name + parent phone using the canonical student-matching rule (P1).
2. Query active students for an exact normalised match (server-side + database unique constraint enforcement — never frontend-only).
3. Match found → **do not create a duplicate.** Flag as "possible existing student" and offer to select the existing record (warn-don't-block, staff confirms via explicit action).
4. No match → create the `students` row.

### 7.2 Duplicate or potentially matching existing records

If the registry already contains two records that look like the same student (e.g. created before the uniqueness rule, or name variant + same phone):
- **Do not auto-merge** (P2).
- Flag both records for review in an admin view.
- Resolution options: deactivate one (keeping its history), or link sessions from one to the other via authorised identity corrections (P5), then deactivate.
- A merge, if ever approved by the owner, must be an explicit, audited operation that re-points sessions and records the merge in audit — never a silent update.

### 7.3 Parent phone changes

- Phone is stored E.164-normalised (FR-06).
- Changing a parent phone updates `students.parent_phone` (audited in `student_audit`) and is **prospective only**: new sessions use the new phone; historical sessions keep the phone captured at the time.
- After a phone change, the uniqueness check must be re-evaluated (the new name+phone might now collide with another active student) — treat as a duplicate-registration case (7.2).

---

## 8. Profile editing and audit

Student profile editing (name, parent phone, deactivate/reactivate) is distinct from attendance record editing (time corrections). Both are audited.

### 8.1 Profile edit operations (audited, append-only)

| Operation | What changes | Audit record |
|---|---|---|
| Correct student name | `students.student_name` | `student_audit` row (field=`student_name`, original, new, who, when) |
| Correct parent phone | `students.parent_phone` | `student_audit` row (field=`parent_phone`, original, new, who, when) |
| Deactivate student | `students.is_active = false`, `deactivated_at`, `deactivated_by` | `student_audit` row (field=`is_active`) + deactivation timestamp |
| Reactivate student | `students.is_active = true`, clear `deactivated_at` | `student_audit` row |

### 8.2 What profile editing must NOT do

- Must not change `student_id` (P6).
- Must **never** update historical `sessions.student_id`, `sessions.student_name`, `sessions.parent_phone`, or any `events` row (P3/P4). Profile edits are prospective only: they change the current registry row; historical sessions keep the identity and name/phone captured at the time.
- Must not cascade-deactivate or delete sessions (BR-07).
- Must not auto-link or unlink sessions (P5). Any re-link of a historical session to a student is an identity correction (§5.1), not a profile edit.

### 8.3 Authorisation model (shared-PIN constraint)

All staff share one PIN and self-declare a first name at login (BR-01, D6). Role separation is a **process rule**, not a technical control. Every profile edit and identity correction is audit-logged with the active session's name (S13).

**Proposed decision (pending):** whether profile editing and identity corrections are restricted to the "lead teacher" role by process only (consistent with D6), or whether a future technical role split is introduced. For this baseline, editing is open to any authenticated staff member and fully audit-logged — matching the existing corrections model (FR-29/FR-30, D6).

---

## 9. Deactivation

- Deactivating a student sets `is_active = false` and records `deactivated_at`/`deactivated_by`/`deactivated_reason`.
- Deactivated students are **excluded from the student selection list** at the gate so staff do not accidentally sign out/in a student who is no longer attending.
- **Historical sessions and events are untouched** — they keep their `student_id` and the name/phone captured at the time. Reports and history continue to show them (P3/P7).
- Reactivation clears `deactivated_at` and restores the student to the selection list; no new `student_id` is created.
- `student_id` is never reused after deactivation (P6).

---

## 10. Server API requirements (proposed)

New endpoints, all cookie-authenticated like E1–E7, added to the catalogue (the registry is server-side only; the browser holds no database key — S2/S3 preserved).

| # | Endpoint | Method | Purpose | Priority |
|---|---|---|---|---|
| R1 | `/api/students` | POST | Register a new student (validates name + phone, duplicate check) | M (for registry) |
| R2 | `/api/students` | GET | Search/list students (by name or phone; active filter) | M |
| R3 | `/api/students/{student_id}` | GET | Get one student's profile + attendance history summary | M |
| R4 | `/api/students/{student_id}` | PATCH/PUT | Edit name/phone (audited) — profile edit | M |
| R5 | `/api/students/{student_id}/deactivate` | POST | Deactivate or reactivate (audited) | M |
| R6 | `/api/attendance-identity-corrections` | POST | Link/re-link a historical session to a student (authorised, audited) | M (for reconciliation) |
| R7 | `/api/students/{student_id}/attendance` | GET | A student's attendance history (sessions across days) | M |

Corresponding request/response shapes follow the API_CONTRACT_v1.0 conventions (camelCase on the wire, ISO-8601 timestamps, `serverTime` on every response, `studentId` → `student_id` mapping).

**Proposed decision (pending):** exact endpoint paths and payload shapes are proposed implementation decisions (analogous to PD-A1…PD-A8) and must not be treated as approved stakeholder decisions.

### 10.1 Relationship to existing endpoints

- `POST /api/events` (E2) sign-in payload gains an optional `studentId` (maps to `students.student_id`). When present, the session's `student_id` is set; when absent, it's a manual-entry session (`student_id = NULL`). This is additive and does not change the event idempotency contract.
- `GET /api/day` (E3) session snapshots gain `studentId` and, optionally, `studentName`/`parentPhone` from the linked student record for display.
- No existing endpoint behavior changes for sessions created before the registry (they keep `student_id = NULL`).

---

## 11. Offline implications (preserve P8)

- **Manual entry remains fully offline-capable:** sign-in with name + phone writes to the local outbox with `student_id = NULL` and syncs later via `/api/events` — exactly the current flow. No registry lookup is required offline.
- **Student selection (if offered post-approval)** requires the local device to have a cached copy of the active student registry. This is **deferred**: the offline implications of a cached registry (stale phone/name, sync conflicts between devices, registry versioning) are design work for after the UI workflow is approved. Do not build offline student selection now.
- **Offline profile editing is not supported** (consistent with AD-5/Q13: corrections are online-only for the pilot). Student registry mutations (register, edit, deactivate) are online-only operations.
- **Outbox state machine unchanged:** adding `studentId` to the sign-in event does not alter pending/inflight/failed-review/acked semantics or idempotency.
- **No new local-only identity:** a student registered on one device while offline cannot be selected on another until synced — this is an accepted limitation deferred with the selection UI.

---

## 12. Data protection considerations

| Consideration | Position |
|---|---|
| Data minimisation | Registry holds only name + parent phone + active flag + timestamps. No address, no ID number, no medical data, no broader SIS fields. |
| Retention | Student registry records outlast single-day sessions (that is the point). Retention period and end-of-term purge rules for the registry must be defined by the owner (currently only attendance data has a documented end-of-term manual purge, D3/BR-18). |
| Local storage | If a registry cache is ever held on devices (deferred), it is unencrypted PII like today's attendance cache (S10/C13) — screen lock is deterrence, not encryption. For this baseline, no registry data is stored locally. |
| Sharing | No parent portal, no student login, no third-party sharing. Parent contact occurs only via the existing `wa.me` handoff. |
| Access control | Browser has no database key; all registry access is server-side via service-role key with RLS/no policies (S2/S3 preserved). |
| Right to be forgotten | Deactivation preserves history (P3). Full deletion of a student with historical attendance is not supported by the append-only design; owner-level manual intervention outside the app would be required — document as a limitation. |

**Proposed decision (pending):** retention period for student registry records and the end-of-term handling of deactivated students.

---

## 13. Testing and migration strategy

### 13.1 Testing (proposed)

- Unit tests: `students` uniqueness constraint, normalised name+phone matching, duplicate-registration rejection, deactivation/reactivation, profile-edit audit rows, identity-correction audit rows.
- Route tests: R1–R7 (auth enforced, validation, not-found, idempotency where relevant).
- Migration content tests (analogous to `tests/migration.test.ts`): table, constraints, indexes, RLS/no policies, append-only guards on `student_audit` and `attendance_identity_corrections`.
- **No real-phone or production tests** are part of this proposal; the registry is a design artifact at this stage.

### 13.2 Migration strategy (proposed, not to be applied yet)

**Registry approval gate:** SR-1 through SR-8 must receive **explicit owner approval** before any Phase 2 schema migration or registry API implementation begins. Until approval is recorded, no `students` table, no `student_id` FK, and no registry endpoints may be implemented. This gate is independent of Phase 0 and Phase 1, which may proceed without it.

1. Add the `students`, `student_audit`, and `attendance_identity_corrections` tables in a new migration, with RLS/no policies and append-only guards.
2. Add nullable `student_id` FK to `sessions` (and optionally `student_id` to `events` sign-in rows).
3. Do **not** backfill historical sessions automatically (6.1).
4. Provide an admin/operator script (outside the app, per D3 pattern) for the optional, staff-confirmed reconciliation of historical sessions — run only with owner approval.
5. Update the `app_settings` PD-D1 configuration if any new thresholds (matching tolerances) are needed; keep them configurable, never hard-coded.

**Migration gate:** No migration is applied to production without explicit owner approval, a non-production apply-and-verify cycle (mirroring the T1.2 review report's remaining blockers), and a rollback plan.

---

## 14. Decisions this proposal introduces (all proposed, pending owner approval)

| Decision | Question | Status |
|---|---|---|
| SR-1 | Student identity attributes and uniqueness surface (name+phone vs phone-only; normalisation/tolerances) | Proposed |
| SR-2 | Whether `student_id` is server- or client-generated; offline registration support | Proposed (server-generated online registration recommended) |
| SR-3 | Historical reconciliation matching rule and which sessions are candidates | Proposed |
| SR-4 | Whether gate sign-in offers student selection at capture (post-UI-approval) vs manual entry + later linking | Proposed (UX deferred) |
| SR-5 | Profile-edit / identity-correction authorisation under shared PIN (process rule vs technical role split) | Proposed (process rule + audit recommended) |
| SR-6 | Retention period and end-of-term handling for student registry records | Proposed |
| SR-7 | Endpoint paths/payload shapes for R1–R7 | Proposed implementation decision |
| SR-8 | Whether a future "merge duplicates" operation is ever allowed, and its audit form | Proposed |

---

## 15. What this proposal deliberately does NOT do

- Does not specify or build the student lookup/selection UI (deferred, per mandate).
- Does not apply any database migration.
- Does not change any existing attendance event, session, or API behavior for sessions created before the registry.
- Does not approve any stakeholder decision (Q5, Q13–Q16, PD-*, or any SR-*).
- Does not expand into a student-information system (no grades, fees, timetables, parent portal).
