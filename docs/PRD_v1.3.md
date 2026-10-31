# Product Requirements Document
# School Attendance Sign-In (Offline-First) — v1.3 (proposed student-registry baseline)

| | |
|---|---|
| **Document title** | Product Requirements Document — School Attendance Sign-In |
| **Version** | **1.3 — proposed evolution of v1.2** (student registry, student editing, attendance corrections) |
| **Date** | 31 October 2026 |
| **Author** | Lead Software Architect (proposal) |
| **Status** | **Proposed — not approved.** `docs/PRD_v1.2.md` remains the current baseline for stakeholder sign-off. This document adds proposed student-registry and editing requirements; nothing here is an approved stakeholder decision and no requirement is removed from v1.2. |
| **Audience** | Software engineers, UI/UX designers, QA engineers, technical project managers, school stakeholders |
| **Source of truth** | `docs/PRD_v1.2.md` remains authoritative for all existing requirements (FR-01…FR-35, BR, S, AC, E, U, SC, O, P, U-A, R, C, RK, Q, AD). This document is additive. |
| **Companion documents** | `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md` (detailed design analysis), `docs/STAKEHOLDER_DECISION_REGISTER_v1.1.md` (decisions), `docs/DATABASE_CONTRACT_v1.1.md`, `docs/API_CONTRACT_v1.1.md`, `docs/SYNC_CONTRACT_v1.1.md`, `docs/SYSTEM_ARCHITECTURE_v1.1.md`, `docs/CURRENT_STATE_AUDIT_v1.1.md` |

---

## 1. Document control and reading conventions

| Marker | Meaning |
|---|---|
| *(carried forward)* | From `PRD_v1.2.md`, unchanged. |
| *(proposed)* | New in v1.3. **Not approved** — listed for stakeholder deliberation. |
| *(pending)* | Existing open question or decision (Q5, Q13–Q16, SR-1…SR-8) — not approved. |

### 1.1 What is preserved from v1.2

All of `PRD_v1.2.md` §2–§30 is **carried forward unchanged** as the baseline: executive summary, product vision, objectives, success metrics, users and roles, scope, functional requirements FR-01…FR-35, user stories U1–U16, acceptance criteria AC-G1…G10, workflows, business rules BR-01…BR-22, data requirements §16, notifications, security, performance, usability, error handling, reporting, integrations, assumptions, constraints, risks, open questions Q1–Q16, MVP definition, future enhancements, and final acceptance criteria.

No v1.2 requirement is removed, renumbered, or downgraded. Approved stakeholder decisions (PD-A4, PD-D1, PD-D2, PD-D3, PD-A5, PD-A8, PD-A1, PD-S6) remain approved. Pending questions Q5, Q13, Q14, Q15, Q16 remain pending.

### 1.2 What is proposed in v1.3

A new **permanent student registry** capability (students are separate from attendance sessions), plus student profile editing and the remaining attendance-correction administration. These are new product capabilities and are **proposed, not approved**. They are detailed in `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md` and summarised below in §31.

---

## 2–30. (Carried forward from PRD v1.2 — not reproduced here)

Refer to `docs/PRD_v1.2.md` in full. The following v1.2 sections are affected by the proposal and are noted here for awareness only; their full text remains unchanged:

- **§9.1 Scope (in scope):** a student-registry section would be added as proposed (see §31 below).
- **§9.2 Scope (out of scope):** the registry is deliberately **not** a student-information system (no fees, grades, timetables, parent portal).
- **§10 Functional requirements:** new student-management requirements are proposed as FR-36…FR-45 below (marked proposed).
- **§16.1 Data model:** the three-part model gains a `students` table (see `docs/DATABASE_CONTRACT_v1.1.md`).
- **§29 Future enhancements:** "Student list imported once, so staff pick a name instead of typing" is superseded in intent by the proposed student registry (still not a full SIS).

---

## 31. Permanent student registry (proposed — not approved)

### 31.1 Intent

Students are currently entered manually for each attendance session (name + parent phone). When a student returns for a subsequent weekly lesson, staff must be able to identify and select their existing record instead of re-entering all information.

The student registry and attendance sessions are **separate concepts**:

```
students
  ├── attendance session — Week 1
  ├── attendance session — Week 2
  ├── attendance session — Week 3
  └── attendance session — Week 4
```

A student has a **stable identity across multiple attendance dates**. Each lesson attendance remains a **separate session** with its own arrival, departure and event history.

### 31.2 Required student-management capabilities (proposed)

The eventual system must support:

| # | Capability | Priority (proposed) |
|---|---|---|
| FR-36 | Register a new student (name + parent phone, with duplicate detection) | M (for registry) |
| FR-37 | Find an existing student (search by name or parent phone) | M |
| FR-38 | Select a returning student for attendance; automatically retrieve saved name and parent phone | M |
| FR-39 | Manually enter a student who is not yet registered (must always remain available — an unregistered student must never be blocked from attending) | M |
| FR-40 | Edit a student's saved name and parent phone (audited) | M |
| FR-41 | Deactivate a student without deleting historical attendance; reactivate later | M |
| FR-42 | View a student's attendance history | M |
| FR-43 | Handle duplicate or potentially matching student records safely (no automatic merge) | M |
| FR-44 | Reconcile historical attendance records with the registry where matching is reliable and explicitly authorised | M |
| FR-45 | Keep student identity separate from session identity; profile edits must not silently rewrite historical attendance | M (invariant) |

### 31.3 Identity and history rules (proposed invariants)

- **Do not identify students by name alone.** Matching uses normalised name + parent phone, with explicit staff confirmation where needed (SR-1 pending).
- **Do not automatically merge historical records merely because names match.** Reconciliation requires reliable matching and explicit, audited authorisation (SR-3 pending).
- **Preserve existing attendance events and their original values.** Student profile changes never mutate `events` (BR-05/BR-07, AC-11.4).
- **Editing a permanent student profile must not silently rewrite historical attendance.** Edits change the registry row; historical sessions keep the name/phone captured at the time.
- **Attendance identity corrections are separate, authorised and auditable.** Linking/re-linking a historical session to a student record is an identity correction (who, when, why, original link), distinct from a profile edit and from a time correction.
- **Establish a stable student ID with appropriate database constraints.** `student_id` is immutable and never reused (SR-2 pending).
- **Consider parent phone changes and duplicate registrations explicitly.** Phone changes are prospective and audited; duplicates are flagged for review, not auto-merged (SR-8 pending).
- **Preserve existing offline and event-sync semantics.** Manual entry remains fully offline-capable; registry writes are online-only in the pilot (consistent with AD-5/Q13).

### 31.4 Manual entry must remain available (proposed requirement)

Manual entry of a student not yet registered must remain available even after the registry is introduced. A missing or unrecognised student must never be blocked from attending merely because they do not already exist in the registry. Manual-entry sessions carry `student_id = NULL` until optionally linked by an authorised identity correction.

### 31.5 Student profile editing (proposed)

Staff must be able to:

- Correct a student's name.
- Correct a student's parent phone.
- Deactivate or reactivate a student.
- Preserve previous profile values in an audit history (`student_audit`).

Profile edits and attendance corrections are **distinct operations**. A profile edit never alters historical sessions or events.

### 31.6 Attendance record editing (proposed)

Consistent with the existing v1.2 requirements FR-29/FR-30 and the corrected architecture:

- Correct arrival time; correct departure time.
- Correct the student associated with an attendance record, subject to authorisation and audit (identity correction).
- Preserve original values; record who performed the correction and when.
- Reflect authorised corrections in the attendance dashboard and parent-message composition.
- Never silently overwrite original attendance evidence.

### 31.7 Out of scope for v1.3 (proposed)

- The student lookup/selection UI (workflow to be deliberated and approved separately — no UI is built here).
- Automatic merging of duplicate student records.
- Parent logins, a parent portal, QR/barcode scanning, fees, grades, timetables — a full student-information system is not intended at this stage (C7 of v1.2).

---

## 32. Open questions and pending decisions (carried forward + new)

All v1.2 open questions Q1–Q16 remain as in `PRD_v1.2.md` §27; Q5, Q13, Q14, Q15, Q16 are **pending stakeholder approval** and are **not** treated as decided here.

New proposed decisions (SR-1…SR-8) are recorded in `docs/STAKEHOLDER_DECISION_REGISTER_v1.1.md`; all are **proposed — pending**.

---

## 33. Final note

This document proposes the evolution of the product to support a recurring weekly attendance cycle with a permanent student registry. It does not approve any stakeholder decision, does not modify any approved decision, and does not authorise any code change, migration, or production deployment. Approval of the student-registry scope, the SR decisions, and confirmation of Q5/Q13–Q16 are required before implementation begins (see `docs/IMPLEMENTATION_PLAN_v1.1.md`).
