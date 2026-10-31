# Sync Contract v1.1
# Grace House School Attendance Sign-In — student-registry offline implications (proposed)

| | |
|---|---|
| **Document** | Sync Contract v1.1 |
| **Version** | 1.1 — 31 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Proposed technical contract.** Preserves `docs/SYNC_CONTRACT_v1.0.md` in full; adds the offline implications of the optional `studentId` on sign-in events and student-registry writes (marked **proposed — pending owner approval**). No application code is written here. |
| **Supersedes** | `docs/SYNC_CONTRACT_v1.0.md` is preserved unchanged; this document is additive. |
| **Authoritative sources** | `docs/PRD_v1.2.md`, `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md`, `docs/SYSTEM_ARCHITECTURE_v1.1.md`, `docs/API_CONTRACT_v1.1.md`, `docs/DATABASE_CONTRACT_v1.1.md` |
| **Companion contracts** | `API_CONTRACT_v1.1.md`, `DATABASE_CONTRACT_v1.1.md` |

---

## 1. Principles (carried forward from v1.0 §1, unchanged)

All 11 principles apply, including: durability before success; one path online and offline; the outbox is the queue of record; identity before persistence; never lost, never duplicated, never silently dropped; no silent overwrite.

---

## 2. Event identity (carried forward from v1.0 §2, unchanged)

`eventId`, `sessionRef`, and `deviceId`/`deviceSeq` rules are unchanged. Event IDs and session references remain distinct.

**Addition (proposed):** a sign-in event may optionally carry `studentId`. This is **not** an identity key for sync — `eventId` remains the sole idempotency key — and it does not change the outbox state machine, batching, ordering, or acknowledgement semantics.

---

## 3. Canonical event structure (carried forward from v1.0 §3, amended — proposed)

All v1.0 §3 fields are unchanged and retain their immutability rules. The following field is added (proposed):

| Field | Type | Required | Source of value | Immutability |
|---|---|---|---|---|
| `studentId` | UUID string | **no** | Staff-selected student at sign-in, or absent for manual entry | Immutable on the event |

The dual-timestamp rule (`deviceEventAt` time of record; `serverReceivedAt` provenance; difference labelled queue time, never skew) is unchanged (FR-11/BR-05/BR-22).

---

## 4. Write-ahead capture (carried forward from v1.0 §4, unchanged)

The write-ahead flow (validate → generate identities → capture device time → one IndexedDB transaction → read-back verification → success UI only after durable confirmation → push if online) is unchanged. `studentId` is attached to the sign-in event payload at capture time when a student is selected; manual entry omits it. No change to durability-before-success (BR-21).

---

## 5. Outbox state machine (carried forward from v1.0 §5, unchanged)

`pending → inflight → acked / failed-retryable / failed-review`, with the same UI, exit, and badge semantics. `studentId` does not introduce new states. `failed-review` remains terminal until human action (PD-S6 — approved).

---

## 6. Submission, batching, ordering, retry (carried forward from v1.0 §6, unchanged)

Endpoint `POST /api/events`; ≤ 50 events and ≤ 128 KB per batch; oldest-first; device-seq order; sign-in before sign-out on a device; triggers (capture/online/open/foreground/tick/manual); one sync loop at a time; backoff 2 s → 300 s cap with jitter; manual retry never duplicates. Unchanged.

---

## 7. Acknowledgement format and semantics (carried forward from v1.0 §7, unchanged)

`accepted`/`duplicate` → remove from outbox, merge projection; `rejected` → `failed-review` with reason, no blind retry; `conflict` → accepted but flagged, not an error. Partial batch failure remains per-event, never all-or-nothing. Unchanged.

---

## 8. Duplicates and interrupted sync (carried forward from v1.0 §8, unchanged)

Three layers (identity, server acceptance, client hygiene); convergence guarantee of exactly one server record per `eventId`. Unchanged.

---

## 9. Conflict preservation and resolution (carried forward from v1.0 §9, unchanged)

First-synchronised-wins; losing event retained permanently; conflict record; resolution via audited correction referencing the conflict; correction base-version check; offline duplicate warning is best-effort. Unchanged. The addition of `studentId` does not alter `competing_sign_in`/`competing_sign_out` detection, which remains PD-A5 (name+phone+dayKey for sessions — approved; sessions only, not the student registry).

---

## 10. Local persistence and recovery (carried forward from v1.0 §10, amended — proposed)

All v1.0 §10 stores (`outbox`, `sessions` day cache, `messages` cache, `sessionDescriptor`, `meta`) and recovery rules are unchanged. Proposed addition:

| Store (proposed addition) | Contents | Notes |
|---|---|---|
| `studentRegistry` cache | Active students (id, name, phone) | **Only if** a student-selection UI is approved post-SR-4. Deferred: not part of this baseline. Adds offline staleness and registry-sync considerations that must be designed separately. |

Until SR-4 is approved and built, **no student-registry data is stored locally**, and offline capture requires no registry lookup — manual entry with `student_id = NULL` remains fully offline-capable. This preserves the existing offline and event-sync semantics (P8 of the proposal).

---

## 11. Late sync (carried forward from v1.0 §11, unchanged)

`dayKey` derives from `deviceEventAt` — never sync time. In-window late events accepted and flagged `lateSynced`; beyond the window or future-tolerance-exceeded rejected to visible `failed-review`, never dropped. Day close does not lock the server day. Unchanged; the 7-day default remains pending Q5 (PD-D1 approved as configurable).

---

## 12. Clock probe and consistency flags (carried forward from v1.0 §12, unchanged)

Probe at open/foreground/sync; advisory only; fast-clock ahead-of-receipt flag; slow clock evidenced only by post-reconnect probe estimate; `queuedDuration` labelled queue time; 5-minute thresholds pending Q5. Unchanged.

---

## 13. Gates on pending stakeholder decisions (carried forward from v1.0 §13, unchanged)

Q5/Q13/Q14/Q16 defaults unchanged. No new decision gates the sync contract itself; SR-1…SR-8 (student registry) affect the API and database contracts, and the optional registry cache (deferred).

---

## 14. Proposed decisions (new)

| ID | Question | Proposed decision | Status |
|---|---|---|---|
| PD-S8 | `studentId` in outbox events | Optional payload field; not part of identity/idempotency; does not alter state machine | Proposed |
| PD-S9 | Local student-registry cache | Deferred until SR-4 (gate selection UI) is approved; not built in this baseline | Proposed |
