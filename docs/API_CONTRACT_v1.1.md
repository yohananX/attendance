# API Contract v1.1
# Grace House School Attendance Sign-In — with student-registry endpoints (proposed)

| | |
|---|---|
| **Document** | API Contract v1.1 |
| **Version** | 1.1 — 31 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | **Proposed technical contract.** Preserves `docs/API_CONTRACT_v1.0.md` in full (E1–E7 catalogue, conventions, error catalogue, PD-A1…PD-A8); adds student-registry endpoints R1–R7 and an optional `studentId` on sign-in events (marked **proposed — pending owner approval**). No application code is written here. |
| **Supersedes** | `docs/API_CONTRACT_v1.0.md` is preserved unchanged; this document is additive for the registry. |
| **Authoritative sources** | `docs/PRD_v1.2.md`, `docs/STUDENT_REGISTRY_PROPOSAL_v1.0.md`, `docs/DATABASE_CONTRACT_v1.1.md`, `docs/SYSTEM_ARCHITECTURE_v1.1.md`, `docs/STAKEHOLDER_DECISION_REGISTER_v1.1.md` |
| **Companion contracts** | `DATABASE_CONTRACT_v1.1.md`, `SYNC_CONTRACT_v1.1.md` |

---

## 1. Conventions (carried forward from v1.0, unchanged)

All v1.0 §1 conventions apply: `/api/*` base path, HTTPS only, JSON, HTTP-only session cookie required on every endpoint except `POST /api/login`, `serverTime` on every response, ISO-8601 UTC timestamps, `dayKey` = `YYYY-MM-DD` Africa/Lagos date, no pagination, no API versioning, idempotency by `eventId` alone.

Wire/column mapping: camelCase on the wire → `snake_case` in the database (`studentId` → `student_id`, `dayKey` → `day_key`, `sessionRef` → `session_ref`, `eventType` → `event_type`, `deviceEventAt` → `device_event_at`, `serverReceivedAt` → `server_received_at`, `capturedOffline` → `captured_offline`, `deviceId` → `device_id`, `deviceSeq` → `device_seq`, `staffName` → `staff_name`, `whatsappLaunchedAt` → `whatsapp_launched_at`, `baseServerVersion` → `base_server_version`).

---

## 2. Endpoint catalogue (E1–E7 carried forward; R1–R7 proposed)

### 2.1 Approved pilot catalogue (PD-A1 — carried forward unchanged)

| # | Endpoint | Method | Auth | Purpose | Priority | Status in code |
|---|---|---|---|---|---|---|
| E1 | `/api/login` | POST | none (rate-limited) | PIN verification; sets cookie; returns signed descriptor | M | Implemented (no rate limit, no descriptor — see audit) |
| E2 | `/api/events` | POST | cookie | Batch event ingestion with per-event results | M | Implemented (sign_in/sign_out only; `correction` rejected) |
| E3 | `/api/day` | GET | cookie | Day cache sync: sessions, outstanding messages, counts | M | Implemented |
| E4 | `/api/messages/{sessionRef}/launched` | POST | cookie | Server-held WhatsApp launch marker | M | Implemented |
| E5 | `/api/corrections` | POST | cookie | Audited time correction with base-version check | M (online-only, AD-5 pending Q13) | **Not implemented** |
| E6 | `/api/day-close/check` | POST | cookie | Day-close precondition check + purge token | M (block default pending Q14) | **Not implemented** |
| E7 | `/api/time` | GET | cookie | Clock-probe endpoint | M (FR-12a) | **Not implemented** |

Explicitly not endpoints (pilot): CSV export (client-side), search (client-side), duplicate warning (client-side), bulk sign-out (client generates N sign-out events through E2; deferred), identity edit (deferred PD-A6), config (`SCHOOL_NAME` is public build/runtime config), logout (cookie expires; day close clears the descriptor client-side).

### 2.2 Student-registry endpoints (proposed — SR-7)

| # | Endpoint | Method | Auth | Purpose | Priority |
|---|---|---|---|---|---|
| R1 | `/api/students` | POST | cookie | Register a new student (duplicate check) | M (for registry) |
| R2 | `/api/students` | GET | cookie | Search/list students (by name or phone; active filter) | M |
| R3 | `/api/students/{studentId}` | GET | cookie | Get one student's profile + attendance-history summary | M |
| R4 | `/api/students/{studentId}` | PATCH | cookie | Edit name/phone (audited profile edit) | M |
| R5 | `/api/students/{studentId}/deactivate` | POST | cookie | Deactivate or reactivate a student (audited) | M |
| R6 | `/api/attendance-identity-corrections` | POST | cookie | Link/re-link a historical session to a student (authorised, audited) | M (for reconciliation) |
| R7 | `/api/students/{studentId}/attendance` | GET | cookie | A student's attendance history (sessions across days) | M |

All registry endpoints are cookie-authenticated; the browser holds no database key (S2/S3 preserved). Registry mutations (R1, R4, R5, R6) are online-only (consistent with AD-5/Q13 — no offline student-registry writes in the pilot). R2/R3/R7 are read queries.

**Proposed decision (pending):** exact request/response payload shapes for R1–R7 are proposed implementation decisions, not approved stakeholder decisions.

---

## 3. `POST /api/events` — event ingestion (E2 — amended, proposed)

The canonical event structure is defined in `SYNC_CONTRACT_v1.1.md` §3. The sign-in event payload gains an **optional** field:

| Field | Type | Required | Notes |
|---|---|---|---|
| `studentId` | UUID string | **no** (new) | Optional stable student ID. When present, the session's `student_id` is set; when absent, this is a manual-entry session (`student_id = NULL`). Manual entry must always remain available (SR-4). |

All other fields are unchanged from v1.0 §4. `eventType` remains `sign_in` \| `sign_out` \| `correction` at the schema level; the implemented route currently accepts `sign_in`/`sign_out` only — `correction` support is gated behind E5 implementation (FR-30).

### 3.1 Acceptance window (unchanged, pending Q5)

`dayKey` within Lagos day + permitted late-sync window (default 7 days, configurable via `app_settings`, PD-D1); `deviceEventAt` not more than 5 minutes ahead of server receipt (no backwards tolerance). Rejected events enter visible `failed-review`, never silently dropped (FR-15, PD-D1 pending Q5 confirmation).

---

## 4. `POST /api/corrections` — audited time correction (E5 — not implemented)

Carried forward from v1.0 §6 unchanged: online-only for the pilot (AD-5, pending Q13); writes a `correction` event to the append-only log plus a `corrections` audit row; base-version check; `corrected` flag; `server_version` bump; original event timestamps never altered. The migration function `sessions_apply_correction` exists (DATABASE_CONTRACT_v1.0 §5) but is not exposed by any endpoint. **Endpoint not yet implemented.**

---

## 5. `POST /api/day-close/check` — gated day close (E6 — not implemented)

Carried forward from v1.0 §9 unchanged: blocking default pending Q14 (AD-10); two-step check/confirm with an opaque, signed, single-use purge token bound to session + `dayKey` (PD-A3, PD-A4); client may purge only acknowledged local data (AC-35.4 structural guarantee). **Endpoint not yet implemented.**

---

## 6. `GET /api/time` — clock probe (E7 — not implemented)

Carried forward from v1.0 §10 unchanged: `{ "serverTime": "…" }`; used for the advisory clock probe at app open/foreground/sync (AD-3); never gates ingestion; never rewrites a timestamp. **Endpoint not yet implemented.**

---

## 7. Error catalogue (carried forward from v1.0 §11, unchanged)

HTTP-level codes 400/401/404/409/413/429/5xx and per-event rejection/conflict reasons are unchanged. Registry endpoints add the usual `404 unknown_student` / `409 duplicate_student` / `400 validation` outcomes as proposed; exact codes are implementation decisions (SR-7).

---

## 8. Proposed decisions (PD-A1…PD-A8 carried forward; new registry items)

| ID | Question | Proposed decision | Status |
|---|---|---|---|
| PD-A1 | Endpoint catalogue | E1–E7 carried forward; R1–R7 are proposed additions for the registry (not part of PD-A1 approval) | Approved (E1–E7) / Proposed (R1–R7) |
| PD-A17 | `studentId` on sign-in events | Optional `studentId`; manual entry always allowed (`student_id = NULL`) | Proposed (SR-4) |
| PD-A18 | Registry write path | Register/edit/deactivate are online-only, cookie-authenticated, server-side only | Proposed (consistent with AD-5/Q13) |
