# System Architecture v1.1
# Grace House School Attendance Sign-In — with permanent student registry (proposed)

| | |
|---|---|
| **Document** | System Architecture v1.1 |
| **Version** | 1.1 — 31 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Draft for technical review.** Preserves `docs/SYSTEM_ARCHITECTURE_v1.0.md` in full (architecture decisions AD-1…AD-10, protocol, data model, trust boundaries); adds the student registry as a new component and data store (marked **proposed — pending owner approval**). No application code, no SQL, no migrations are written here. |
| **Supersedes** | `docs/SYSTEM_ARCHITECTURE_v1.0.md` is preserved unchanged; this document is additive. |
| **Product source of truth** | `docs/PRD_v1.2.md`; student-registry requirements per `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md` (proposed). |
| **Honesty rules** | No pending stakeholder decision is treated as approved (Q5, Q13–Q16, SR-1…SR-8 all open). No paid services. No production release promised by 31 October 2026. |

---

## 1. Architecture overview (carried forward, amended)

The system at a glance (v1.0 §1.1) is unchanged: a single Next.js App Router + TypeScript application on Vercel, backed by Supabase PostgreSQL, installed as a PWA; IndexedDB holds the authoritative local copy while offline; Supabase holds the acknowledged record; WhatsApp by `wa.me` deep link only; all times in Africa/Lagos.

**Addition (proposed):** a **student registry** component and store are added on the server side only:

| Component | Technology | Responsibility | Boundary |
|---|---|---|---|
| Student registry API | Next.js route handlers (server-only) | Register, find, edit, deactivate students; student attendance-history queries; authorised identity corrections | Server-only; browser holds no database key; all access via service-role key (S2/S3 preserved) |
| `students` table | Supabase PostgreSQL | Permanent student identity (stable `student_id`, name, parent phone, active flag, audit) | Append-only audit tables; no direct browser access (RLS, no policies) |

The registry is **separate** from the attendance event log and session projection (P1 of `STUDENT_REGISTRY_PROPOSAL_v1.0.md`).

### 1.1 Online vs offline operation (amended)

| Operation | Online path | Offline path |
|---|---|---|
| Student registration / edit / deactivate (R1, R4, R5) | Server-only, cookie-authenticated | **Not available** (consistent with AD-5 — corrections/registry writes are online-only for the pilot) |
| Student search / history (R2, R3, R7) | Server queries | **Not available** (no local registry cache in this baseline) |
| Sign-in with an existing student | Device time + optional `studentId` captured locally; synced via `/api/events` | Device time captured locally; `studentId` set only if a local registry cache existed (deferred — SR-4); otherwise manual entry (`student_id = NULL`) |
| Sign-in without a registered student (manual entry) | Device time, `student_id = NULL`, synced when online | Fully offline-capable — unchanged from current behavior |

Manual entry must remain available offline even after the registry exists (SR-4 / P8).

---

## 2. Attendance event architecture (carried forward from v1.0 §3, amended)

The three-part model (append-only event log, mutable session projection, audit stores) is unchanged. Proposed additive change:

- `sessions` gains a nullable `student_id` FK → `students.student_id` (PD-D13 proposed). Immutable once set; re-linking a historical session is an audited identity correction, not a session update.
- `events` sign-in rows may optionally carry `student_id` (PD-D14 proposed) for log-rebuildable attribution; does not change idempotency (`eventId` remains the key).

Immutability rules (event timestamps immutable; session times changeable only via audited correction) are unchanged. Corrections never touch the `events` log.

---

## 3. Authentication and trust boundaries (carried forward from v1.0 §4, unchanged)

Trust boundaries: browser untrusted → server trusted → Supabase most trusted. Shared-PIN login, HttpOnly cookie, signed session descriptor (AD-1, not yet implemented — see CURRENT_STATE_AUDIT_v1.1.md), RLS/no policies, service-role-only access. All unchanged by the registry: the registry is server-side only and adds no client trust surface.

---

## 4. Synchronisation protocol (carried forward from v1.0 §5, unchanged)

The sync lifecycle, batch limits, validation pipeline, per-event results, conflict responses, and acknowledgement semantics are unchanged. `studentId` on sign-in events is an additive payload field (PD-S8 proposed) and does not alter idempotency, batching, or the outbox state machine.

---

## 5. WhatsApp integration (carried forward from v1.0 §6, unchanged)

Template generation, phone normalisation, URL encoding, launch marker, server-held pending state, honest wording ("WhatsApp opened", never "sent"/"delivered"). All unchanged. The existing wording defect ("✓ Sent" in `AttendanceDashboard.tsx`) must be fixed regardless of the registry work (see CURRENT_STATE_AUDIT_v1.1.md defect D2).

---

## 6. Security, privacy and data recovery (carried forward from v1.0 §7, amended)

All v1.0 §7 controls (PIN handling, session security, local PII exposure, screen-lock runbook, HTTPS, RLS/service-role, audit immutability, quota failure, device loss, browser clearing, day closure) are carried forward.

**Additions for the student registry (proposed):**

| Area | Position |
|---|---|
| Data minimisation | Registry holds only name, parent phone, active flag, timestamps — attendance-relevant data only. No broader student-information fields. |
| Retention | Student records outlast single-day sessions. Retention period and end-of-term handling for the registry (including deactivated students) must be defined by the owner (SR-6 pending). Currently only attendance data has a documented end-of-term manual purge (D3/BR-18). |
| Local storage | No registry data is stored locally in this baseline. If a cache is added later (SR-4/PD-S9), it is unencrypted PII like today's attendance cache — screen lock is deterrence, not encryption (S10/C13). |
| Access control | Browser holds no database key; all registry access server-side via service-role key; RLS enabled with no policies on registry tables (S2/S3 preserved). |
| Deletion | Deactivation preserves history (no cascading deletes). Full deletion of a student with historical attendance is not supported by the append-only design; owner-level manual intervention outside the app would be required — document as a limitation. |

---

## 7. Architecture decisions AD-1…AD-10 (carried forward, unchanged)

All ten decisions from v1.0 §8 are carried forward with the same status (AD-5 and AD-10 gated on Q13/Q14; AD-3 threshold value pending Q5). No AD is modified by the registry proposal.

**New proposed decisions (not ADs; recorded in STAKEHOLDER_DECISION_REGISTER_v1.1.md as SR-1…SR-8):** student identity attributes, ID generation, historical reconciliation, gate selection, authorisation model, retention, endpoint shapes, duplicate-merge policy.

---

## 8. Failure modes and recovery (carried forward from v1.0 §9, unchanged)

F1–F15 are carried forward unchanged. Registry outages do not affect attendance capture: sign-in/sign-out continue via the event log with `student_id = NULL` for manual entry, and the registry is queried server-side only for selection/history (when online).

---

## 9. Traceability (carried forward from v1.0 §11.1, amended)

The v1.0 component→requirement traceability table is unchanged. Proposed additions:

| Architecture component | PRD v1.2 / proposal requirements covered | Key acceptance criteria |
|---|---|---|
| Student registry API (R1–R7) | Student registry capabilities 1–10 (STUDENT_REGISTRY_PROPOSAL_v1.0 §1) | SR-1…SR-8 (pending); duplicate detection; audit rows |
| `students` table + `student_id` FK on `sessions` | Stable student identity; student–session relationship | student_id immutability; FK integrity; active filter |
| `student_audit` + `attendance_identity_corrections` | Profile-edit audit; authorised identity correction | Append-only; who/when/old/new; no mutation of history |

Gaps (v1.0 §11.2) are unchanged, plus: no student-registry UI (SR-4 deferred), no local registry cache (PD-S9 deferred), no historical backfill automation (SR-3 — manual, staff-confirmed only).
