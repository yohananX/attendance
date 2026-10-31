# Implementation Plan v1.1
# Grace House School Attendance — Development Rebaseline (weekly attendance + student registry)

| | |
|---|---|
| **Document** | Implementation Plan v1.1 |
| **Version** | 1.1 — 31 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Planning document — not a commitment to dates or scope.** Reflects the actual code on `main` (commit `4de664b`, 2026-10-31). Marks completed work accurately, removes obsolete assumptions, introduces permanent student management, and sequences the remaining work. |
| **Team** | One developer, part-time stakeholder access for device testing |
| **Baseline docs** | `docs/PRD_v1.2.md` (requirements source of truth), `docs/PRD_v1.3.md` (proposed student registry), `docs/SYSTEM_ARCHITECTURE_v1.1.md`, `docs/DATABASE_CONTRACT_v1.1.md`, `docs/API_CONTRACT_v1.1.md`, `docs/SYNC_CONTRACT_v1.1.md`, `docs/STAKEHOLDER_DECISION_REGISTER_v1.1.md`, `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md`, `docs/CURRENT_STATE_AUDIT_v1.1.md` (Deliverable A) |
| **Rules** | No application code, SQL, or migrations are written in this plan. No stakeholder decision (Q5, Q13–Q16, SR-1…SR-8) is assumed approved. Safe defaults are used and flagged. No production database changes, no migrations to production, no student-entry UI before its workflow is approved. |

---

## 0. Schedule reality check (read first)

The build window from the original plan (1–6 Nov 2026) has passed; the controlled pilot and production sign-off dates are now stakeholder decisions to be re-baselined. This plan is **phase-ordered by risk and dependency**, not by calendar dates. Each phase states its acceptance criteria and the tests required before the next phase begins.

**Non-negotiable:** never trade the capture/durable-store/sync/idempotency chain, per-event dual timestamps, conflict-evidence preservation, gated day close, PIN login with no secrets in the browser, "WhatsApp opened" honesty wording, or Lagos display for schedule. Those are the integrity core of the existing application.

---

## 1. Current-state baseline (what exists, verified)

From `docs/CURRENT_STATE_AUDIT_v1.1.md` Deliverable A, verified by `npm run test` (65 passed, 12 DB-integration skipped), `npm run typecheck` (clean), `npm run build` (clean):

### 1.1 Implemented and verified (unit-tested or build-verified)

| Area | What exists | Key files |
|---|---|---|
| Server schema & migration | `events`, `sessions`, `conflicts`, `corrections`, `login_attempts`, `app_settings`; RLS/no policies; append-only triggers; sessions mutability guardrail; sanctioned RPCs; PD-D2 partial unique indexes; PD-D1 `app_settings` (7-day default); `health_privilege_check` | `supabase/migrations/20261031000000_initial_schema.sql` |
| PIN login + 12h HttpOnly cookie | Server PIN verify (constant-time), cookie flags, fail-closed on missing secrets | `src/app/api/login/route.ts`, `src/lib/session.ts` |
| Event ingestion (E2) | `/api/events` batch ingest, idempotent `eventId` acceptance with duplicate-acknowledgement, sign_in/sign_out, acceptance window from `app_settings` | `src/app/api/events/route.ts` |
| Day cache sync (E3) | `/api/day` with sessions, outstanding messages, counts | `src/app/api/day/route.ts` |
| WhatsApp launch marker (E4) | `/api/messages/{sessionRef}/launched`, idempotent (PD-D7) | `src/app/api/messages/[sessionRef]/launched/route.ts` |
| Session name lookup (extra) | `/api/session` | `src/app/api/session/route.ts` |
| Health probe (extra) | `/api/health` operator-authenticated, privileged-capability check | `src/app/api/health/route.ts` |
| Logout (extra) | `/logout` cookie clear | `src/app/logout/route.ts` |
| Frontend attendance screen | Sign-in form, in-school/signed-out lists, counter, search, Lagos display, WhatsApp launch + copy, sync badge, manual retry, day review + CSV, PWA shell + service worker, dataset isolation | `src/app/dashboard/AttendanceDashboard.tsx`, `src/app/review/DayReview.tsx`, `src/lib/attendance-store.ts`, `src/lib/whatsapp.ts`, `src/lib/phone.ts`, `public/sw.js`, `src/app/manifest.ts` |
| Tests | 65 unit tests passing (routes, crypto, config, migration SQL content, CSV, messages) | `tests/` |

### 1.2 Implemented but NOT fully verified (route-level tests only; no real-phone or end-to-end evidence)

- Offline capture → local IndexedDB → sync (no client-side tests, no real-phone airplane-mode test executed by this audit).
- Idempotency under retry/interruption (route-level logic exists; `tests/dataset-sync.test.ts` covers dataset mismatch, not kill-the-network mid-request).
- Production deployment behaviour (user-reported use on 31 Oct 2026; not independently verified).

### 1.3 Partially implemented (happy path works; integrity contract not fully met)

| Area | What works | What is missing |
|---|---|---|
| Sign-out time (FR-07/FR-11) | Dashboard sends device time via `/api/events` | Live `/api/sign-out` route uses **server clock** — divergent; reconcile or remove |
| Conflict evidence (FR-16/BR-12) | PD-D2 partial unique indexes defend against duplicate accepted sign-outs | Ingest route **drops losing events** on index violation (does not persist `conflict_marker='losing'` or write `conflicts` rows); no `needs_review`/`late_synced`/consistency flags set by route |
| Outbox states (SYNC_CONTRACT §5) | Local `pending`/`failed`; auto-sync on reconnect/foreground | No `inflight`/`failed-review`/`acked`; no read-back verify (AD-6); no persistent-storage request; no quota warning; no blocking-error durability state (AC-G3b) |
| Clock & flags (FR-12/E7) | Basic acceptance-window rejection in `/api/events` | No `/api/time` probe; no offset storage; no ahead-of-receipt / sign-out-before-sign-in / day-mismatch / sequence-regression flags |
| WhatsApp honesty (BR-13/Q15) | Launch marker + Copy control | UI chip says **"✓ Sent"** (must be "WhatsApp opened"); message template diverges from FR-25 (missing privacy sentence) |

### 1.4 Not implemented (gaps vs v1.2 requirements)

| Requirement | Status |
|---|---|
| FR-03 Login rate limiting | Not implemented (`login_attempts` table unused) |
| FR-04 Signed offline session descriptor | Not implemented (unsigned `{staffName, expiresAt}` in localStorage) |
| FR-12(a) Clock probe | Not implemented (no `/api/time`) |
| FR-29/FR-30 Audited corrections endpoint + UI (E5) | Not implemented (no `/api/corrections`; migration RPC exists but unreachable) |
| FR-35 Gated day close (E6) | Not implemented (no `/api/day-close/check`, no close-day dialog/purge) |
| FR-34 Bulk sign-out | Not implemented (cut item) |
| FR-23 Duplicate warning | Not implemented (cut item) |
| Permanent student registry | Not implemented (no `students` table; name+phone entered per session) |

### 1.5 Blocked by decision or dependency

| Item | Blocker |
|---|---|
| E5 `/api/corrections` online vs offline | Q13 pending (AD-5 default: online-only) — safe to build online-only now |
| E6 `/api/day-close/check` block vs warn-and-force | Q14 pending (AD-10 default: block) — safe to build block-first now |
| Q5 thresholds (5 min tolerance, 7-day window) | Values are configurable in `app_settings`; behaviour defaults set but not stakeholder-confirmed |
| Q16 residual-risk acknowledgement | Affects wording and acceptance, not code structure |
| Student registry UX (find/select returning student) | Deferred by mandate — UI workflow approved separately |

---

## 2. Data-integrity defects to fix first (prioritised, before new features)

From Deliverable A §8.2. These must be resolved before the student registry or editing work, because they concern the evidence core.

| ID | Defect | Fix location | Acceptance criterion |
|---|---|---|---|
| D1 | Losing conflicting sign-out events dropped on partial-unique-index violation (FR-16/BR-12) | `src/app/api/events/route.ts` + migration sanctioned paths | Second sign-out for a session: losing event persisted with `conflict_marker='losing'`, a `conflicts` row written, session flagged; both events retrievable after resolution |
| D2 | UI chip says "✓ Sent" for WhatsApp (BR-13/Q15) | `src/app/dashboard/AttendanceDashboard.tsx:827` | Chip reads "WhatsApp opened"; nowhere claims "sent"/"delivered" |
| D3 | `/api/sign-out` uses server clock (FR-07/FR-11) | `src/app/api/sign-out/route.ts` — reconcile with `/api/events` device-time path or remove | Sign-out time of record is device-captured; no server-clock sign-out path |
| D4 | Unsigned localStorage session (FR-04/T-C2/S11) | `src/lib/attendance-store.ts`, `src/lib/session.ts`, `/api/login` | Signed descriptor (Ed25519/ES256, `{staffName, iat, exp, keyId, nonce}`) verifiable offline; no PIN material stored |
| D5 | No login rate limiting (FR-03/S4) | `src/app/api/login/route.ts` + `login_attempts` | 5 wrong attempts → 5-minute lockout, counted client and server, visible wait message |
| D6 | Dataset mismatch clears pending unsynchronised records (FR-14/FR-35/BR-17) | `src/lib/attendance-store.ts` `clearAttendanceForDataset` | Unsynchronised events never cleared; clear scoped to acknowledged data or blocked while unacknowledged events exist |
| D7 | Missing contracted endpoints E5/E6/E7 | New routes `/api/corrections`, `/api/day-close/check`, `/api/time` | Endpoints behave per API_CONTRACT_v1.1 |
| D8 | Ingest route lacks conflict/flag engine (needs_review, late_synced, consistency flags, PD-D3 orphaned sign-out) | `src/app/api/events/route.ts` | Orphaned sign-out accepted into log + provisional session + `needs_review`; late events attached to original day + flagged; consistency flags set |
| D9 | Local durability guarantees not met (AC-G3b/BR-21/AD-6) | `src/lib/attendance-store.ts` | Read-back verify before success UI; `navigator.storage.persist()`; low-storage warning; blocking-error state on storage failure |

---

## 3. Deliverable E — Prioritised next-development sequence

The phases below are the recommended sequence. Each phase states: objective, tasks, dependencies, acceptance criteria, tests required, and relevant files/database components. Critical blockers are flagged; improvements that can follow later are separated.

### Phase 0 — Secure the evidence core (data-integrity defect fixes)

**Objective:** Bring the implemented system into compliance with its own integrity contract before adding anything new. Fix D1–D9.

**Tasks:**
- D1: Persist losing conflict events + `conflicts` rows; orphaned-sign-out (PD-D3) provisional session + `needs_review`; consistency flags in `/api/events`.
- D2: Change "✓ Sent" → "WhatsApp opened" across dashboard, day review, CSV; align WhatsApp message template with FR-25 (add privacy sentence FR-28).
- D3: Reconcile or remove `/api/sign-out` server-clock path; sign-out time of record must be device-captured via `/api/events`.
- D4: Implement signed session descriptor (Ed25519 primary, ES256 fallback per AD-1/U1) issued at login, verified offline in-browser, no PIN material stored; session-expired screen rendering no data.
- D5: Add server-side + client login rate limiting (5 attempts → 5-minute lockout, `login_attempts`, `429` + `Retry-After`).
- D6: Scope dataset-mismatch clear to acknowledged data; block clear while unacknowledged events exist.
- D7: Stand up `/api/time` (E7) probe endpoint.
- D9: Add IndexedDB read-back verify, `navigator.storage.persist()`, low-storage warning, blocking-error durability state.

**Dependencies:** None (builds on existing `main`).

**Acceptance criteria:**
- AC-G3b durability drill passes (storage failure → blocking error, no false success).
- Two-phone offline conflict drill (AC-G6): both events preserved, conflict flagged, both retrievable after resolution.
- AC-G5 fast/slow clock behaviour (once E7 probe exists; probe values per Q5 defaults).
- AC-15.x acceptance-window rejection visible, never silent.
- WhatsApp wording audit: zero occurrences of "sent"/"delivered"; "WhatsApp opened" everywhere.
- `npm run test` green (add regression tests for D1–D9); `npm run typecheck` and `npm run build` clean.

**Tests required:** New unit tests for events-route conflict preservation, rate limiting, descriptor sign/verify, dataset-clear scoping, durability failure. DB-integration tests (currently skipped) enabled once a non-production Postgres/Supabase is available (T1.2 review report blocker 1–2).

**Relevant files/components:** `src/app/api/events/route.ts`, `src/app/api/login/route.ts`, `src/app/api/time/route.ts` (new), `src/app/api/sign-out/route.ts`, `src/app/dashboard/AttendanceDashboard.tsx`, `src/lib/session.ts`, `src/lib/attendance-store.ts`, `src/lib/phone.ts`, `src/lib/whatsapp.ts`, `supabase/migrations/...` (no new migration needed for D1–D9 except possibly sanctioned RPC additions — none required; D1 uses existing `sessions_flag_conflict` and `conflicts` table).

**Critical blocker:** None. D1–D9 are safe to implement under any outcome of Q5/Q13–Q16/SR-*.

---

### Phase 1 — Reliability and security completion

**Objective:** Implement the remaining v1.2 reliability/security requirements that are genuinely unfinished: clock probe, corrections endpoint, gated day close, and the local outbox durability contract (carried from Phase 0 where they span both).

**Tasks:**
- Implement `/api/corrections` (E5): online-only (AD-5, Q13 pending), audited time correction via `sessions_apply_correction`, base-version check, `corrected` flag, `server_version` bump, corrected time feeds parent message.
- Implement `/api/day-close/check` (E6): blocking default (AD-10, Q14 pending), two-step check/confirm, purge token (PD-A3, PD-A4), client purges only acknowledged local data.
- Implement corrections + day-close UI (minimal, per FR-30/FR-35): correction mode on a row, close-day dialog with preconditions and counts.
- Complete Phase-0 D9 durability items if not finished (read-back, persistent storage, quota warning, blocking error).
- Add regression tests for E5/E6 version-check, conflict-flag, blocked-close.

**Dependencies:** Phase 0 (D1 conflict engine needed for correction-conflict detection); E7 `/api/time` from Phase 0.

**Acceptance criteria:**
- AC-30.1–30.5: time correction updates displayed time, preserves original in audit, marks corrected, base-version mismatch flagged not applied, corrected time used in message.
- AC-35.1–35.5: close blocked offline; blocked with pending count; succeeds green; unsynchronised event never purged; outstanding-message state reconstructable after close.
- E5 online-only: corrections cannot be captured offline in the pilot (consistent with AD-5).
- Tests: unit tests for corrections route, day-close route; DB-integration tests for `sessions_apply_correction` (currently skipped).

**Relevant files/components:** `src/app/api/corrections/route.ts` (new), `src/app/api/day-close/check/route.ts` (new), `src/app/dashboard/AttendanceDashboard.tsx` (correction mode, close-day dialog), `src/lib/supabase/rpc.ts` (existing sanctioned helpers), migration `sessions_apply_correction`/`sessions_set_launch_marker`/`sessions_flag_conflict` (existing).

**Critical blocker:** Q13/Q14 pending — but block-first/online-only defaults are safe defaults, so implementation can proceed without stakeholder sign-off.

---

### Phase 2 — Permanent student registry (core data model + server APIs)

**Objective:** Introduce the permanent student registry as a separate concept from attendance sessions, per `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md`. No student-entry UI is built in this phase (workflow approved separately).

**Tasks:**
- Add migration: `students` table (SR-1/PD-D12: `student_id` PK, name, parent phone, active flag, timestamps; name+phone unique among active), `student_audit`, `attendance_identity_corrections`; nullable `student_id` FK on `sessions` (PD-D13); optional `student_id` on sign-in `events` (PD-D14 — proposed).
- Add RLS/no policies, append-only guards on the two new audit tables.
- Implement server APIs R1–R7 (register, search/list, get one, edit name/phone, deactivate/reactivate, identity correction, attendance history) — all cookie-authenticated, server-side only, online-only for mutations.
- Add optional `studentId` to `/api/events` sign-in payload (PD-A17 proposed); manual entry always allowed (`student_id = NULL`).
- Migration strategy: **no automatic backfill** of historical sessions; staff-confirmed linking only (SR-3).
- Tests: unit tests for uniqueness, duplicate detection, deactivation, audit rows, identity-correction audit; migration-content tests; DB-integration tests once a live DB is available.

**Dependencies:** Phase 0 (integrity core must be stable); API_CONTRACT_v1.1 / DATABASE_CONTRACT_v1.1. Q5 not required. SR-1…SR-8 are proposed defaults — implementation proceeds under them but they remain pending stakeholder approval.

**Acceptance criteria:**
- A registered student has a stable `student_id`; name/phone edits do not change `student_id` and do not alter historical sessions/events.
- Manual entry (`student_id = NULL`) still works offline and online; an unregistered student is never blocked.
- Duplicate registration (same normalised name+phone active) is detected and not auto-created.
- Deactivation excludes a student from selection but preserves all historical sessions.
- Identity correction (linking a historical session to a student) writes an audit row (who/when/why/original link).
- All registry endpoints require a valid session cookie; browser holds no database key.
- Tests pass; migration applies cleanly on a fresh non-production database.

**Relevant files/components:** New migration file (not to be applied to production), `src/app/api/students/route.ts` (new), `src/app/api/students/[studentId]/route.ts` (new), `src/app/api/students/[studentId]/deactivate/route.ts` (new), `src/app/api/attendance-identity-corrections/route.ts` (new), `src/app/api/students/[studentId]/attendance/route.ts` (new), `src/app/api/events/route.ts` (optional `studentId`), `supabase/migrations/...`.

**Critical blocker:** SR-4 (whether gate sign-in offers student selection at capture) is deferred — Phase 2 builds registry + APIs only; no UI, no offline registry cache.

---

### Phase 3 — Student editing and attendance-correction administration

**Objective:** Wire the student registry into the gate flow and complete attendance administration (editing + corrections + day close) end to end.

**Tasks:**
- (Post UI-approval only) Student selection at sign-in: find/returning-student selection with automatic retrieval of saved name/phone; manual entry fallback always available.
- Student profile edit UI (name/phone, deactivate/reactivate) with audit display — separate from time-correction mode.
- Attendance-correction UI (time corrections) connected to E5, with conflict-flag display and resolution (AD-4: "use first recorded time / use later event's time").
- Day-review screen enhancements: conflict flags, correction status, student identity, late-synced flags, outstanding-message status.
- End-of-day drill: close day (E6) after full sync; outstanding messages = 0; CSV export with honest wording.

**Dependencies:** Phase 2 (registry + APIs); Phase 1 (E5/E6 endpoints); SR-4 approval for selection UI.

**Acceptance criteria:**
- Returning student selected at sign-in auto-fills name/phone; new student can still be entered manually.
- Profile edits are audited; historical attendance unchanged.
- Time corrections audited; corrected time used in parent message; conflicts flagged, not silently merged.
- Day close succeeds only when online + fully synced; unsynchronised events never purged.
- End-to-end weekly cycle: Week 1 → Week 2 with returning student selection works on real phones.

**Relevant files/components:** `src/app/dashboard/AttendanceDashboard.tsx` (selection, edit modes, close-day), `src/app/review/DayReview.tsx` (flags), new registry UI components (post-approval only).

**Critical blocker:** SR-4 (selection UI workflow) — not approved; do not build. Manual entry remains the only gate path until approved.

---

### Phase 4 — Weekly continuity and polish (improvements, can follow later)

**Objective:** Complete remaining convenience features and operationalise for recurring weekly lessons.

**Tasks:**
- Bulk sign-out (FR-34, cut item) — "sign out all remaining" with actual execution time.
- Duplicate sign-in warning (FR-23, cut item) — warn-don't-block, offline best-effort.
- Search already implemented; polish.
- Historical attendance access across weeks (student attendance history query R7 already exists; add UI).
- Operational runbook: PIN change after each day, screen-lock verification, end-of-term export + manual purge (D3/BR-18 extended to registry retention per SR-6).
- Backup and recovery procedure documentation (none exists today).
- KPI measurement (Q8), analytics decision (Q9 — confirmed none).

**Dependencies:** Phase 3 complete.

**Acceptance criteria:** Per-v1.2 ACs for FR-23/FR-34; runbook drill complete; retention procedure documented.

**Relevant files/components:** Dashboard, DayReview, runbook (documentation only).

**Critical blocker:** None — these are improvements, not blockers.

---

### Phase 5 (future — out of scope for this baseline)

**Explicitly NOT part of this plan** (separate school-management features, not intended at this stage):
- Individual staff logins (replacing shared PIN), parent portal, parent logins.
- QR codes / barcode scanning.
- Automatic SMS or WhatsApp Business API messaging (paid API).
- Grades, fees, timetables, multi-school, multi-week termly reporting beyond student attendance history.
- Encrypted local storage / remote wipe (listed as future enhancement in PRD §29; addresses S10 residual risk pending Q16).
- Product analytics / telemetry (R5 — confirmed none, Q9 pending).

---

## 4. Dependencies and acceptance criteria (summary)

| Phase | Depends on | Acceptance criteria (gate to next phase) |
|---|---|---|
| 0 (defect fixes) | `main` (current code) | D1–D9 fixed; AC-G3b/G5/G6; wording audit; tests green; build clean |
| 1 (reliability/security) | Phase 0 | E5/E6 endpoints + UI; AC-30.x / AC-35.x; DB-integration tests enabled on non-production DB |
| 2 (student registry) | Phase 0 | `students`/`student_id` FK + APIs R1–R7; manual entry intact; duplicates detected; deactivation preserves history; migration clean on fresh non-production DB |
| 3 (editing + administration) | Phases 1–2 (+ SR-4 approval for selection UI) | End-to-end weekly cycle on real phones; corrections and day close audited and gated |
| 4 (polish/continuity) | Phase 3 | FR-23/FR-34; runbook drill; retention/backup documented |

---

## 5. Tests required (by phase)

| Phase | Tests |
|---|---|
| 0 | Route tests for conflict preservation (D1), rate limiting (D5), dataset-clear scoping (D6); durability-failure test (D9); descriptor sign/verify (D4); WhatsApp wording audit (D2) — add to `tests/` |
| 1 | Corrections route tests (version check, conflict-flag, audit row); day-close route tests (blocked states, purge token, count mismatch); enable `tests/db-integration.test.ts` against non-production Postgres |
| 2 | `students` uniqueness + duplicate detection; deactivation/reactivation; `student_audit` rows; `attendance_identity_corrections` rows; registry route auth/validation; migration-content tests |
| 3 | End-to-end real-phone drill (login → sign-in → sign-out → message → correction → close day); two-phone conflict drill; offline manual-entry drill |
| 4 | FR-23/FR-34 tests; runbook drill evidence |

---

## 6. Files and database components touched (reference)

**Existing (to modify):**
- `src/app/api/login/route.ts` — rate limiting (D5)
- `src/app/api/events/route.ts` — conflict preservation, orphaned sign-out, flags, optional `studentId` (D1, D8, Phase 2)
- `src/app/api/sign-out/route.ts` — reconcile or remove server-clock path (D3)
- `src/app/dashboard/AttendanceDashboard.tsx` — wording, correction mode, close-day, selection (post-approval)
- `src/app/review/DayReview.tsx` — flags, honest wording
- `src/lib/session.ts` — signed descriptor (D4)
- `src/lib/attendance-store.ts` — read-back, persistent storage, quota warning, blocking error, dataset-clear scoping (D9, D6)
- `src/lib/phone.ts`, `src/lib/whatsapp.ts` — template alignment with FR-25/FR-28 (D2)

**Existing (to add new routes):**
- `src/app/api/corrections/route.ts` (E5)
- `src/app/api/day-close/check/route.ts` (E6)
- `src/app/api/time/route.ts` (E7)
- `src/app/api/students/...` (R1–R7, Phase 2)

**New migration (Phase 2, NOT to be applied to production yet):**
- `students`, `student_audit`, `attendance_identity_corrections` tables; `student_id` FK on `sessions`; optional `student_id` on `events`; RLS/no policies; append-only guards.

**Tests:** `tests/` — add route, crypto, and store tests; enable `db-integration.test.ts` once `DATABASE_URL` points at a reachable non-production Postgres/Supabase (T1.2 review report blocker).

---

## 7. Critical blockers vs deferrable improvements

| Critical blockers (must be resolved before weekly reliance) | Deferrable (improvements, follow later) |
|---|---|
| D1 conflict-evidence preservation | Bulk sign-out (FR-34) |
| D4 signed session descriptor | Duplicate warning (FR-23) |
| D5 login rate limiting | Cross-week history UI |
| D7/D8 missing endpoints + conflict engine | Search polish, CSV polish |
| D9 local durability guarantees (AC-G3b) | Encrypted local storage / remote wipe |
| Phase 1 E5/E6 (corrections, gated close) | Backup/recovery procedure documentation |
| Phase 2 student registry data model + APIs | Student selection UI (SR-4 — workflow approval first) |
| Q5/Q13/Q14/Q15/Q16 stakeholder confirmation (affects defaults, not code structure) | |

---

## 8. Recommended first task

Start with **Phase 0, defect D1** (persist losing conflict events + write `conflicts` rows in `/api/events`, with orphaned-sign-out PD-D3 handling) together with **D7** (stand up `/api/time`). These are the smallest integrity-critical, unblocking pieces: they make the existing conflict model honest and give the clock probe its endpoint, without requiring any stakeholder decision and without touching the student registry or production database. Once D1/D7 are green, proceed through D2–D6/D9 in Phase 0 before beginning Phase 1.
