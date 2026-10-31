# Stakeholder Decision Register
# Grace House School Attendance Sign-In — v1.1 (student registry baseline)

| | |
|---|---|
| **Document** | Stakeholder Decision Register v1.1 |
| **Version** | 1.1 — 31 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Proposed defaults — pending stakeholder approval.** This version **preserves** `STAKEHOLDER_DECISION_REGISTER_v1.0.md` in full (all v1.0 rows, approvals, and pending items) and **adds** new decisions introduced by the permanent student registry requirement. Nothing in v1.1 modifies an approved v1.0 decision. |
| **Supersedes** | `docs/STAKEHOLDER_DECISION_REGISTER_v1.0.md` is preserved unchanged; this document is additive. |
| **Related documents** | `docs/PRD_v1.2.md` (and proposed `docs/PRD_v1.3.md`), `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md`, `docs/SYSTEM_ARCHITECTURE_v1.1.md`, `docs/DATABASE_CONTRACT_v1.1.md`, `docs/API_CONTRACT_v1.1.md`, `docs/SYNC_CONTRACT_v1.1.md` |

---

## 1. Decision summary

| Decision | Recommended default | Status | Notes |
|---|---|---|---|
| Q5 — Clock and late-sync thresholds | 5-minute clock tolerance; 5-minute maximum future timestamp; 7-day late-sync window | **Pending** (carried forward unchanged from v1.0) | Confirm all three values. Default 7 days stored as configuration (PD-D1), never hard-coded. |
| Q13 — Offline attendance corrections | Online-only for the first pilot | **Pending** (carried forward unchanged from v1.0) | Model supports offline `correction` events; pilot default online-only (AD-5). |
| Q14 — Closing the attendance day | Block closure until all events are synchronised and acknowledged | **Pending** (carried forward unchanged from v1.0) | Block is the specced default (AD-10); trivially relaxable later. |
| Q15 — WhatsApp status wording | Report only what the application can verify | **Pending** (carried forward unchanged from v1.0) | "WhatsApp opened" only; never "sent"/"delivered". |
| Q16 — Residual-risk acknowledgement | Explicitly acknowledge remaining risks | **Pending** (carried forward unchanged from v1.0) | Device clock, unencrypted local data, storage clearing, descriptor expiry vs untrusted clock. |
| PD-A4 — Day-close enforcement responsibility | Hybrid: client enforces outbox empty; server enforces outstanding count + purge token | **Approved** (User, 2026-10-30) | Carried forward unchanged. |
| PD-D3 — Orphaned sign-out handling | Accept into log + provisional session (needs_review); re-project/merge when sign-in arrives | **Approved** (User, 2026-10-30) | Carried forward unchanged. |
| PD-S6 — Failed-review resolution | Explicit user "Resolve" action clears a failed-review entry only on explicit action | **Approved** (User, 2026-10-30) | Carried forward unchanged. |
| PD-D1 — Configurable late-sync window | Default 7 days; never hard-coded | **Approved** (User, 2026-10-30) | Carried forward unchanged; tied to Q5. |
| PD-D2 — Partial unique indexes | Partial unique indexes on `events(session_ref)` for non-losing sign_in/sign_out rows | **Approved** (User, 2026-10-30) | Carried forward unchanged. |
| PD-A5 — Competing sign-in definition | Normalised studentName + parentPhone + dayKey equality | **Approved** (User, 2026-10-30) | **Applies to sessions only** — not to the student registry. The registry needs its own matching rule (SR-1). |
| PD-A8 — Dedicated corrections endpoint | E5 `/api/corrections`; append-only correction event + corrections audit row; online-only pending Q13 | **Approved** (User, 2026-10-30) | Carried forward unchanged. Endpoint not yet implemented (see CURRENT_STATE_AUDIT_v1.1.md). |
| PD-A1 — Approved API endpoint catalogue | E1–E7 as listed in API_CONTRACT_v1.0 §2 | **Approved** (User, 2026-10-30) | Carried forward unchanged. E5/E6/E7 remain unimplemented. New student-registry endpoints (R1–R7) are proposed additions, not part of PD-A1. |

### 1.1 New decisions introduced by the student registry (all proposed, none approved)

| Decision | Recommended default | Status |
|---|---|---|
| **SR-1** — Student matching / uniqueness surface | Normalised `student_name` + `parent_phone` unique among **active** students; no name-only matching; normalisation (case/spacing/accents) to be documented | **Proposed — pending** |
| **SR-2** — Student ID generation | Server-generated UUID at (online) registration; client-generated UUID deferred | **Proposed — pending** |
| **SR-3** — Historical reconciliation | No automatic linking; link only where normalised name+phone yields exactly one candidate and staff confirm via an audited identity correction | **Proposed — pending** |
| **SR-4** — Gate sign-in selection | Manual entry remains available; student selection at capture deferred until the lookup UI workflow is approved | **Proposed — pending** |
| **SR-5** — Edit/correction authorisation | Process rule only (shared PIN); every edit/correction audit-logged with the active session's name (consistent with D6) | **Proposed — pending** |
| **SR-6** — Registry retention | Student records outlast single-day sessions; retention period and end-of-term handling to be defined by the owner | **Proposed — pending** |
| **SR-7** — Registry endpoint paths/payloads | R1–R7 as proposed in API_CONTRACT_v1.1 | **Proposed implementation decision** |
| **SR-8** — Duplicate merge operation | No automatic merge; explicit audited merge only if later approved by the owner | **Proposed — pending** |

---

## 2. Implementation rule (preserved from v1.0)

Until approval is recorded:

- Treat each recommendation as a proposed safe default, not an approved stakeholder decision.
- Do not represent pending decisions as accepted.
- Implement only features that remain safe under either outcome.
- Keep unresolved thresholds configurable where practical.
- Record the final decision, approver and date in the project documentation.

**Registry approval gate:** SR-1 through SR-8 must receive **explicit owner approval** before any Phase 2 schema migration or student-registry API (R1–R7) implementation begins. Until approval is recorded, no `students` table, no `student_id` foreign key, and no registry endpoints may be implemented. Phase 0 and Phase 1 may proceed independently of this gate; Phase 3 student-selection UI is additionally blocked until SR-4 (capture workflow) is explicitly approved.

---

## 3. Sign-off record

| Decision | Approved by | Date | Final decision |
|---|---|---|---|
| Q5 | Pending | — | — |
| Q13 | Pending | — | — |
| Q14 | Pending | — | — |
| Q15 | Pending | — | — |
| Q16 | Pending | — | — |
| PD-A4 | User | 2026-10-30 | (unchanged from v1.0) |
| PD-D3 | User | 2026-10-30 | (unchanged from v1.0) |
| PD-S6 | User | 2026-10-30 | (unchanged from v1.0) |
| PD-D1 | User | 2026-10-30 | (unchanged from v1.0) |
| PD-D2 | User | 2026-10-30 | (unchanged from v1.0) |
| PD-A5 | User | 2026-10-30 | (unchanged from v1.0; sessions only) |
| PD-A8 | User | 2026-10-30 | (unchanged from v1.0) |
| PD-A1 | User | 2026-10-30 | (unchanged from v1.0) |
| SR-1 … SR-8 | Pending | — | — |
