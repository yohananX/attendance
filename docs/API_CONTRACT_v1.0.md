# API Contract v1.0
# Grace House School Attendance Sign-In

| | |
|---|---|
| **Document** | API Contract v1.0 |
| **Version** | 1.0 — 30 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | Proposed technical contract — pending review; stakeholder-gated items (Q5, Q13, Q14, Q15, Q16) flagged, not decided |
| **Authoritative sources** | `PRD_v1.2.md` (requirements), `SYSTEM_ARCHITECTURE_v1.0.md` (§4 auth, §5 protocol, §6 WhatsApp, §7 security, §10.7 day close) |
| **Companion contracts** | `DATABASE_CONTRACT_v1.0.md`, `SYNC_CONTRACT_v1.0.md` (canonical event wire schema — §3 there is authoritative for event field names) |
| **Scope limits** | HTTP interface only. **No application code, no SQL** — implementation is `IMPLEMENTATION_PLAN_v1.0.md`. All endpoint *names and payload shapes* are **proposed decisions (PD-A#)** — the architecture specifies the operations, not their URLs; see §10. |
| **Honesty rules applied** | No pending stakeholder decision is treated as approved. The application never claims WhatsApp send/delivery (BR-13). Unverifiable states are labelled unverified (BR-22). |

---

## 1. Conventions

| Topic | Rule | Source |
|---|---|---|
| Base path | All endpoints under `/api/*`, same origin as the app (single Next.js deployable) | Architecture §1.3 |
| Transport | HTTPS only (Vercel TLS, HSTS); plain HTTP never served | S6 |
| Content type | `application/json; charset=utf-8` for all request and response bodies | — |
| Authentication | **HTTP-only session cookie required on every endpoint except `POST /api/login`.** A valid session descriptor is never accepted in place of the cookie (AC-04.4, S11) | Architecture §4.2/§4.7 |
| Clock field | Every JSON response includes `serverTime` (ISO-8601 UTC, millisecond precision) for the advisory clock probe (AD-3) | PD-A2 |
| Time representation | All timestamps on the wire are ISO-8601 UTC with milliseconds (e.g. `2026-11-07T08:47:12.483Z`). Display formatting to Africa/Lagos 12-hour is client-side only (FR-22) | Architecture §1.2, §3.10 |
| Day keys | `dayKey` is `YYYY-MM-DD` — the Africa/Lagos calendar date of `deviceEventAt`; the server recomputes and verifies | PRD §16.4 |
| Pagination | **None.** Volumes are ~120 events/day, 2 (up to 4) phones (D7, PRD §16.3); a full day fits one response | PRD §16.3 |
| API versioning | None for the pilot: one deployable, one client, updated together via the service-worker shell update | Architecture §2.1 |
| Idempotency | Event identity is `eventId` alone; duplicates return the original acknowledgement (FR-13) | Architecture §5.4-4 |

## 2. Endpoint catalogue

| # | Endpoint | Method | Auth | Purpose | Priority |
|---|---|---|---|---|---|
| E1 | `/api/login` | POST | none (rate-limited) | PIN verification; sets cookie; returns signed descriptor | M (FR-01/02/03/04) |
| E2 | `/api/events` | POST | cookie | Batch event ingestion with per-event results | M (FR-09/11/13/15/16) |
| E3 | `/api/day` | GET | cookie | Day cache sync: sessions, outstanding messages, counts | M (FR-17/19/20/26/31, AD-9) |
| E4 | `/api/messages/{sessionRef}/launched` | POST | cookie | Server-held WhatsApp launch marker | M (FR-27, AD-9) |
| E5 | `/api/corrections` | POST | cookie | Audited time correction with base-version check | M (FR-30; **online-only, AD-5 pending Q13**) |
| E6 | `/api/day-close/check` | POST | cookie | Day-close precondition check + purge token | M (FR-35, AD-10 pending Q14) |
| E7 | `/api/time` | GET | cookie | Clock-probe endpoint for app-open/foreground (AD-3) | M (FR-12a) — PD-A2 |

**Explicitly not endpoints (pilot):** CSV export (FR-33, C — client-side generation from E3 data, cut order 1); search (FR-21, client-side); duplicate warning (FR-23, client-side); bulk sign-out (FR-34, C — client generates N sign-out events through E2; deferred, PRD §28); identity edit (FR-29, S — deferred, PD-A6); config (`SCHOOL_NAME` is public build/runtime configuration, not a secret, no endpoint required — architecture §6.1); logout (no endpoint: cookie expires at 12 h; day close clears the descriptor client-side).

## 3. Authentication model

### 3.1 `POST /api/login` (E1)

Request:
```json
{ "staffName": "Grace", "pin": "481920", "deviceId": "b7e2f1c4-…" }
```

| Field | Type | Rules |
|---|---|---|
| `staffName` | string | Required, non-empty; self-declared first name, stamped on every record (BR-01, S7 — *who said they did it*, not cryptographic proof) |
| `pin` | string | Required; ≥ 6 digits (FR-01/BR-02). Verified **server-side** against a server-held verifier, constant-time; never stored, logged or echoed (S5) |
| `deviceId` | string (UUID) | Required; the per-browser rate-limit identifier (AD-8, FR-03). Not a security credential |

Response `200`:
```json
{
  "staffName": "Grace",
  "descriptor": {
    "staffName": "Grace", "iat": "2026-11-07T07:00:00.000Z",
    "expiresAt": "2026-11-07T19:00:00.000Z",
    "keyId": "k1", "alg": "Ed25519", "signature": "<base64>"
  },
  "serverTime": "2026-11-07T07:00:00.012Z"
}
```
- Sets the **HTTP-only, Secure, SameSite=Lax, Path=/** session cookie (12-hour expiry, FR-02/S1). The descriptor is returned in the body for local storage (FR-04): contents are `{staffName, iat, exp, keyId, nonce}` signed with the server's Ed25519 key (AD-1; fallback ES256 per uncertainty U1) — **no PIN, no verifier, no shared secret** (AC-04.3, S11).
- Errors: `400 blank_fields` (AC-01.3); `401 invalid_pin` — generic, never distinguishes wrong-PIN from unknown state; `429 rate_limited` with `Retry-After` seconds after 5 failures in 5 minutes per `deviceId` (FR-03/BR-03; client shows remaining wait, AC-03.2).
- The descriptor unlocks only the **local UI**; every other endpoint requires the cookie (AC-04.4).

### 3.2 Session validity (all endpoints except E1)

- Missing, malformed, expired or invalid cookie → `401 unauthenticated`. The response never leaks whether a descriptor would have sufficed.
- 12-hour expiry from login (FR-02); the shorter of cookie/descriptor expiry governs client-side (FR-02).
- Offline: no endpoint is reachable; the app operates from IndexedDB under a valid descriptor (FR-04). **Login is online-only** ("connect to log in", FR-04).

## 4. `POST /api/events` — event ingestion (E2)

Canonical event field names are defined once in `SYNC_CONTRACT_v1.0.md` §3 (wire schema, camelCase) and map 1:1 to `DATABASE_CONTRACT_v1.0.md` §3 columns. Summary for server implementers:

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventId` | UUID string | yes | Client-generated at capture, before persistence; **idempotency key** (BR-20, FR-13) |
| `eventType` | `sign_in` \| `sign_out` \| `correction` | yes | Immutable |
| `sessionRef` | UUID string | yes | Client-generated at first sign-in capture; server binds, never renumbers (PRD §16.1). New sign-in after accepted sign-out = new `sessionRef` (FR-16 new-session rule) |
| `studentName`, `parentPhone` | string | sign_in only | Submitted identity on the sign-in event (architecture §3.1); `parentPhone` in E.164 `+[7–15]` form |
| `deviceEventAt` | ISO-8601 UTC | yes | Time of record, captured at the tap (FR-07); never typed |
| `capturedOffline` | boolean | yes | FR-12/AC-12.1 |
| `deviceId` | UUID string | yes | Attribution/consistency; not a credential (AD-8) |
| `deviceSeq` | integer | yes | Per-device monotonic capture counter (FR-13 ordering) |
| `dayKey` | `YYYY-MM-DD` | yes | Client-computed Lagos date of `deviceEventAt`; **server recomputes and verifies** (architecture §5.2) |
| `staffName` | string | informational | **Server ignores it and stamps from the cookie** (PD-D4, BR-01) |
| correction payload | object | correction only | `field` (`signed_in_at`\|`signed_out_at`), `newValue` (ISO), `baseValue` (ISO), `baseServerVersion` (integer), `conflictId` (UUID, optional) — see E5 |

Request envelope:
```json
{ "events": [ { …event 1… }, { …event 2… } ], "probe": { "offsetSec": 1.8, "rttMs": 320, "measuredAt": "…" } }
```
- `probe` optional, advisory only (AD-3); never gates ingestion.

Batch rules: **≤ 50 events and ≤ 128 KB per request** (architecture §5.3); oldest-first; a single device's events in `deviceSeq` order; a session's sign-in queued before its sign-out on that device (FR-13 Ordering). Violations → `413 batch_too_large`.

### 4.1 Server validation pipeline (per event, in order — architecture §5.4)

1. **Authentication** — invalid cookie stops the whole request (`401`).
2. **Payload schema** — per-event `rejected`, reason `schema_invalid` / `event_type_invalid` / `phone_unnormalisable` (FR-06 re-validated server-side, BR-10).
3. **Acceptance window** (FR-15, BR-11, S12):
   - `dayKey` must equal the server-recomputed Lagos date of `deviceEventAt` → else `rejected` / `day_key_mismatch`;
   - `deviceEventAt` not more than **5 minutes ahead of server receipt** (**Q5 proposed**; no backwards tolerance) → else `rejected` / `future_tolerance_exceeded`;
   - `dayKey` within Lagos day + permitted late-sync window — **7 days proposed, pending Q5** (configurable, never hard-coded) → else `rejected` / `outside_late_window`. In-window late events are **accepted, attached to their original day, flagged `lateSynced`** (AC-15.5, E23).
4. **Idempotency lookup** on `eventId` → found: return the **original acknowledgement** as result `duplicate` carrying the original `serverReceivedAt` and original result (FR-13, AC-13.2) — not an error, not a second row.
5. **Projection processing** (single transaction): create/update session; first-synchronised-wins conflict detection (§5); correction version check (§6); flags (`lateSynced`, `conflict`, `needs_review`); consistency flags (ahead-of-receipt > threshold **Q5 proposed 5 min**, sign-out < sign-in, day mismatch, sequence regression — FR-12c).
6. **Commit → then acknowledge.** An acknowledgement exists only after the transaction commits (architecture §2.10).

### 4.2 Response — per-event results (always one per submitted event)

```json
{
  "serverTime": "2026-11-07T10:03:22.771Z",
  "results": [
    { "eventId": "…", "result": "accepted", "serverReceivedAt": "…", "projection": { …session snapshot… } },
    { "eventId": "…", "result": "duplicate", "serverReceivedAt": "<original>", "projection": { … } },
    { "eventId": "…", "result": "rejected", "reason": "outside_late_window", "message": "Event is 9 days old; permitted window is 7 days." },
    { "eventId": "…", "result": "conflict", "reason": "competing_sign_out", "serverReceivedAt": "…", "projection": { … }, "conflict": { "conflictId": "…", "type": "time_conflict", "winningEventId": "…", "losingEventIds": ["…"] } }
  ]
}
```

| Result | Meaning | Client action (SYNC_CONTRACT §7) |
|---|---|---|
| `accepted` | Committed; includes canonical session projection snapshot | Remove from outbox; merge projection |
| `duplicate` | Already accepted earlier; carries the **original** acceptance (AC-13.2) | Same as accepted — idempotent no-op |
| `rejected` | Validation/window failure with machine-readable reason | Move to `failed-review`; show reason; **no blind retry** (FR-15, E15); blocks day close |
| `conflict` | **Accepted and recorded**, but a competing event won the slot (or a correction was not applied); includes conflict info | Remove from outbox; flag session; surface to lead teacher (FR-16/32). **Not an error** (architecture §5.7) |

HTTP status is `200` whenever the batch was authenticated and well-formed — **partial failure is per-event, never all-or-nothing** (architecture §5.5). Transport failure or `5xx` fails the whole batch → every entry stays pending/retryable.

Session projection snapshot (embedded in `accepted`/`duplicate`/`conflict` and returned by E3): `{ sessionRef, studentName, parentPhone, dayKey, signedInAt, signedOutAt, signedInBy, signedOutBy, serverVersion, corrected, conflictType, lateSynced, needsReview, whatsappLaunchedAt }` — maps to `sessions` columns (DATABASE_CONTRACT §4). The client overlays its unacknowledged local events for display (FR-17.1; SYNC_CONTRACT §7).

## 5. Conflict rules (server detection — FR-16, BR-06/12, architecture §3.7)

| Situation | Detection | Outcome |
|---|---|---|
| Second `sign_out` for a session that already has an accepted sign-out | Same `sessionRef`, slot occupied | New event **accepted into the log** with `conflictMarker='losing'`; conflict record (`time_conflict`); session flagged; result `conflict` / `competing_sign_out`. Displayed time stays with the first synchronised event |
| `sign_in` whose identity (normalised `studentName` + `parentPhone`, same `dayKey`) matches an existing session **with no accepted sign-out** | Identity match (PD-A5) | Event accepted; its session created but flagged `time_conflict` + `needs_review`; result `conflict` / `competing_sign_in`. The first session's displayed state is **untouched** — nothing overwritten |
| `sign_in` matching a session that **already has an accepted sign-out** | New-session rule (FR-16 v1.2) | **Not a conflict** — a normal `accepted` new session under the new `sessionRef` |
| Second tap / repeat `sign_out` on one device | Client guard — no second event is ever created (FR-18/AC-18.1) | No request; no conflict |

Resolution of any `time_conflict` is the lead teacher's **audited correction** via E5, choosing "use first recorded time" or "use later event's time" (AD-4), referencing `conflictId`. **Both original events remain retrievable afterwards** (AC-16.3, BR-12). No endpoint overwrites or deletes an event (AC-11.3/11.4, BR-07).

## 6. `POST /api/corrections` — audited time correction (E5)

**Online-only for the pilot** (AD-5, **pending Q13** — default per decision register: corrections require an online connection). Same cookie authentication. The correction is written as a `correction` event in the append-only log plus a `corrections` audit row (DATABASE_CONTRACT §5); the data model already supports offline queueing of the same shape without schema change if Q13 later approves it.

Request:
```json
{
  "sessionRef": "…", "field": "signed_in_at",
  "newValue": "2026-11-07T08:40:00.000Z",
  "baseValue": "2026-11-07T08:47:12.483Z",
  "baseServerVersion": 3,
  "conflictId": null
}
```

Validation and outcomes (architecture §3.8, FR-30, AC-30.1–30.5):

| Condition | Result | Behaviour |
|---|---|---|
| `baseServerVersion` == current | `applied` | Displayed time updated; audit row (original, new, editor, when); `corrected=true`; `serverVersion` bumped; corrected time feeds the parent message (FR-30) |
| `baseServerVersion` ≠ current (changed elsewhere meanwhile) | `correction_conflict` | **Not applied.** Correction retained with `applied=false`; session flagged `conflictType='correction_conflict'`; **both values retained**; neither silently wins (AC-30.5) |
| Unknown session / malformed | `404 unknown_session` / `400 schema_invalid` | — |
| Base value mismatch with the session's current displayed value | `400 base_value_mismatch` | Client stale; refresh and retry |

Conflict resolution (AD-4) uses this same endpoint with `conflictId` set and `newValue` = the chosen event's time. Errors: `401`; version-related outcomes are per-request results, not HTTP errors. The original event timestamps are **never** altered (BR-05/08, AC-11.4). Role restriction is a **process rule only** — the shared PIN cannot distinguish gate staff from lead teacher (D6, BR-16); every correction is audit-logged with the session's name (S13).

## 7. `POST /api/messages/{sessionRef}/launched` — launch marker (E4)

Server-held launch state (AD-9) so it survives local purge, device change and day close (AC-26.4, AC-35.5).

- Request body: empty. Server stamps `whatsapp_launched_at = serverReceivedAt` (server clock; this marker is provenance, not an attendance time).
- Path param `sessionRef` must exist and have an accepted sign-out → else `404 unknown_session` / `409 not_signed_out` (a message requires both times — FR-25).
- Response `200`: `{ "sessionRef": "…", "whatsappLaunchedAt": "…" }`. **Idempotent**: a repeat call returns the existing marker unchanged (PD-D7).
- **Set only after the WhatsApp link launch is initiated, online only** (FR-27, N3). Offline, the application does not offer launch (FR-26 wording v1.2: a `wa.me` link could technically open offline, but the marker needs server confirmation). If the app is backgrounded before the ack, the marker write retries on foreground; until it lands the chip reads "Opening WhatsApp…", never "opened" (architecture §6.3, U4).
- **Honesty rule (BR-13, BR-22, Q15 pending):** this marker means *link launch initiated*. No endpoint, field name, message or export ever asserts or implies "sent" or "delivered" (AC-27.3, AC-G8). The application cannot verify that staff pressed Send or that the parent received the message (C5, C11) — that remains a runbook duty (§14.7).

## 8. `GET /api/day` — day cache sync (E3)

- Query: `?dayKey=YYYY-MM-DD` (defaults to the current Lagos day).
- Response:
```json
{
  "dayKey": "2026-11-07",
  "sessions": [ { …session snapshot… } ],
  "outstandingMessages": [ { "sessionRef": "…", "studentName": "…", "whatsappLaunchedAt": null } ],
  "counts": { "inSchool": 12, "signedOut": 41, "outstandingMessages": 7 },
  "serverTime": "…"
}
```
- `sessions` = every session row for that `dayKey` (server-acknowledged state only — the client overlays its unacknowledged events; FR-17.1/AC-31.3).
- `outstandingMessages` = sessions with an accepted sign-out and `whatsapp_launched_at IS NULL` (FR-26, R3) — server-held, so the list survives purge, device change and day close (AC-26.4/35.5). Offline, the client shows the last cached copy marked as possibly incomplete (FR-31 banner).
- CSV export (FR-33, C, cut item) is generated **client-side** from this data; column wording is "WhatsApp opened" (AC-33.2).

## 9. `POST /api/day-close/check` — gated day close (E6)

**Blocking default pending Q14** (AD-10, decision register: block closure until all events synchronised and acknowledged). Two-step flow per architecture §10.7:

1. **Check** — request `{ "dayKey": "…" }`. Response:
```json
{ "dayKey": "2026-11-07", "outstandingCount": 7, "outstanding": [ … ], "purgeToken": null, "serverTime": "…" }
```
   - Preconditions and their owners — stated honestly (PD-A4): the **server cannot observe the device's outbox**; "every outbox entry acknowledged" is a **client-side precondition** the client verifies against IndexedDB before offering the purge (FR-35/BR-17); the server supplies the authoritative outstanding-message count and the purge authorisation. The client must **never purge an unacknowledged event** — this is the structural guarantee behind AC-35.4.
   - If the device is offline, the call cannot complete → the dialog is **blocked** with a clear message (AC-35.1); if the local outbox is non-empty → blocked showing the count, nothing purged (AC-35.2).
2. **Confirm** — staff explicitly confirms the displayed outstanding-message count (no "purge anyway" option exists — FR-35/BR-17). Request `{ "dayKey": "…", "confirmedOutstandingCount": 7 }`. Response `200`:
```json
{ "dayKey": "2026-11-07", "purgeToken": "<opaque>", "expiresAt": "…", "serverTime": "…" }
```
   - The **purge token** is an opaque, signed, single-use authorisation bound to the staff session and `dayKey`, short TTL (proposed: 5 minutes — PD-A3). It authorises the client-side purge of **acknowledged** local data only: day cache, empty outbox, session descriptor, day-scoped `meta` (architecture §10.7, FR-35).
   - Server state is untouched: records, flags and outstanding messages remain and are reconstructable (AC-35.5). A **late event after close** is still accepted into the closed day within the late-sync window (F13, pending Q5) — day close is not a server-side lock.
   - Errors: `401`; `400 count_mismatch` if the confirmed count differs from the server's current count (re-check and re-confirm).

## 10. Clock probe (E7 — PD-A2)

- `GET /api/time` → `{ "serverTime": "…" }`. Used by the probe at **app open and foreground** (AD-3), where no other response is available; sync-time probes piggyback on `serverTime` in E2/E3 responses.
- The client estimates offset to ±½ RTT (AD-3) and stores `offsetSec`, `rttMs`, `measuredAt` locally (FR-12a). The estimate is **advisory**: it never gates ingestion, never rewrites a timestamp, and is never presented as proof of a past event's accuracy (FR-12 verifiability statement, BR-22). A **slow** clock is evidenced only by this post-reconnect estimate — no receipt comparison can flag it (X-2, AC-G5).

## 11. Error catalogue

### 11.1 HTTP-level (whole request)

| Status | `code` | When | Retryable |
|---|---|---|---|
| 400 | `malformed_request` | Non-JSON body, missing `events` array, empty batch | No |
| 400 | `schema_invalid` / `base_value_mismatch` / `count_mismatch` | Request-level validation | No |
| 401 | `unauthenticated` | Missing/invalid/expired cookie (all but E1); wrong PIN on E1 (generic) | No (re-login) |
| 404 | `unknown_session` | Unknown `sessionRef` on E4/E5 | No |
| 409 | `not_signed_out` | Launch marker before accepted sign-out | No |
| 413 | `batch_too_large` | > 50 events or > 128 KB | Split and retry |
| 429 | `rate_limited` | Login lockout (5 failures / 5 min per `deviceId`) | After `Retry-After` |
| 5xx | `server_error` | Server/infrastructure failure | **Yes** — backoff (SYNC_CONTRACT §6) |

### 11.2 Per-event rejection reasons (E2, `result: "rejected"`)

| Reason | Rule violated |
|---|---|
| `schema_invalid` | Missing/mistyped fields, bad UUID, bad ISO timestamp |
| `event_type_invalid` | Unknown `eventType` |
| `phone_unnormalisable` | `parentPhone` fails E.164 check (FR-06/BR-10) |
| `day_key_mismatch` | Submitted `dayKey` ≠ server-recomputed Lagos date of `deviceEventAt` (§16.4) |
| `future_tolerance_exceeded` | `deviceEventAt` > 5 min ahead of receipt (**Q5 proposed**) |
| `outside_late_window` | `dayKey` older than the permitted late-sync window (**Q5 proposed 7 days**) |
| `correction_payload_invalid` | Correction event missing field/newValue/baseValue/baseServerVersion |

### 11.3 Per-event conflict reasons (E2, `result: "conflict"` — accepted, flagged)

`competing_sign_out` · `competing_sign_in` · `correction_version_mismatch` (correction retained, not applied, session flagged — AC-30.5).

**Rejected ≠ dropped:** a rejected event stays on the device in `failed-review` with its reason until a human resolves it via the correction/re-entry path; it never disappears (AC-15.4) and it blocks day close (architecture §2.12).

## 12. Rate limiting and security requirements

| Requirement | Specification | Source |
|---|---|---|
| Login rate limit | 5 wrong attempts → 5-minute lockout, keyed to `deviceId`, counted **server-side and client-side** independently; `429` + `Retry-After`; correct PIN also refused during the wait (AC-03.2). Clearing browser storage resets the identifier — documented limitation; IP counting deliberately not used (FR-03, AD-8) | FR-03, S4 |
| Cookie | HttpOnly, Secure, SameSite=Lax, Path=/, 12 h; required on every data endpoint; descriptor never accepted server-side | S1, AC-04.4 |
| Secrets | No service-role key, database URL, PIN, PIN verifier or `SESSION_SECRET` in any response, page source or client bundle | S2, AC-G1 |
| Database | The browser never talks to Supabase; all access is server-side via the service-role key; RLS on with no policies | S2, S3 |
| Input validation | Every field validated server-side per §4/§6; phone re-normalised/verified; size caps on body and batch | FR-06, §5.4 |
| Attribution | Server stamps `staffName` from the cookie on every event/correction; client-supplied names ignored (PD-D4) | BR-01, S7 |
| Transport security | HTTPS only; no analytics/telemetry of any kind (R5, Q9 pending — treated as none) | S6, R5 |
| Data minimisation | Responses carry only the requested day's data; the descriptor carries no PII beyond the staff first name | S10/S11 posture |
| Residual risks | Device-clock manipulation, unencrypted local storage, storage clearing, descriptor-expiry-vs-untrusted-clock are **documented, pending Q16 acknowledgement** — no endpoint claims to prevent them (S10, S11, S14, C12) | Q16 pending |

## 13. Proposed decisions (PD-A#) — unresolved in the architecture, proposed here

| ID | Question | Proposed decision | Status |
|---|---|---|---|
| **PD-A1** | Endpoint names/paths and response envelopes (architecture names only `/api/login`, `/api/events`, `/api/messages/{sessionRef}/launched`) | The catalogue in §2 (`/api/day`, `/api/corrections`, `/api/day-close/check`, `/api/time`) | Proposed |
| **PD-A2** | Probe transport | `serverTime` on every response + dedicated `GET /api/time` for open/foreground probes (architecture says probes occur at open/foreground/sync but names no mechanism) | Proposed |
| **PD-A3** | Purge-token format | Opaque, server-signed, single-use, bound to session + `dayKey`, ~5-minute TTL | Proposed (architecture §10.7 shows a token without format) |
| **PD-A4** | Who enforces "outbox fully acknowledged" at day close | **Client-side** (server cannot observe a device outbox); server supplies outstanding count + purge authorisation; client may only purge acknowledged data — the AC-35.4 guarantee is structural on the client | Proposed |
| **PD-A5** | Mechanical definition of "same child" for `competing_sign_in` | Normalised `studentName` + `parentPhone` + `dayKey` equality (the only identity available — no student registry exists in v1.0) | Proposed |
| **PD-A6** | FR-29 identity-edit endpoint | Deferred (S, cut item); proposed shape `POST /api/sessions/{sessionRef}/identity` with the same audit-row discipline | Proposed (deferred) |
| **PD-A7** | Launch-marker timestamp source | Server-stamped `serverReceivedAt` (client clock untrusted; marker provenance only) | Proposed |
| **PD-A8** | Correction submission path | Dedicated E5 endpoint that writes a `correction` event through the same ingest discipline (keeps the log append-only and keeps the Q13 offline option schema-compatible) | Proposed |

## 14. Requirement traceability (endpoints ↔ PRD)

| Endpoint | PRD v1.2 requirements | Key ACs |
|---|---|---|
| E1 login | FR-01, FR-02, FR-03, FR-04, S1, S4, S5 | AC-01.x, AC-02.x, AC-03.x, AC-04.x |
| E2 events | FR-07, FR-09, FR-11, FR-12, FR-13, FR-15, FR-16, FR-18 (ordering), FR-30 (correction events), BR-05/06/11/12/20, S12 | AC-09.x, AC-11.x, AC-12.x, AC-13.x, AC-15.x, AC-16.x, AC-G4, AC-G5, AC-G6 |
| E3 day | FR-17, FR-19, FR-20, FR-26, FR-31, FR-33 (data), R1–R4 | AC-17.x, AC-19.1, AC-20.x, AC-26.x, AC-31.x |
| E4 launched | FR-27, BR-13, N3/N4, AD-9 | AC-27.1–27.3, AC-20.3, AC-G8 |
| E5 corrections | FR-30, BR-08, S13, K3 | AC-30.1–30.5, AC-G9 |
| E6 day close | FR-35, BR-17, K7a | AC-35.1–35.5, AC-G10 |
| E7 time | FR-12(a), AD-3 | AC-12.2 (probe estimates), AC-G5 |

## 15. Cross-contract consistency

- **Event schema:** §4 mirrors `SYNC_CONTRACT_v1.0.md` §3 (authoritative wire schema) and maps 1:1 to `DATABASE_CONTRACT_v1.0.md` §3. Any field change must update all three documents.
- **Results ↔ outbox states:** `accepted`/`duplicate` → `acked`; `rejected` → `failed-review`; `conflict` → `acked` + session flagged; transport/5xx → `failed-retryable` (SYNC_CONTRACT §5/§7).
- **Idempotency:** E2 `duplicate` semantics rely on the `events` PK and `ingest_result` (DATABASE_CONTRACT §3).
- **Day close:** E6 issues authorisation only; the purge is client-side and acknowledged-only (SYNC_CONTRACT §10); server data is untouched (AC-35.5).
- **No contradiction with pending decisions:** Q5 (thresholds, configurable), Q13 (E5 online-only), Q14 (E6 blocking), Q15 (wording), Q16 (§12 residual risks) are implemented to the safe default and labelled pending throughout.

*End of API Contract v1.0. No application code or SQL is contained here. PRD v1.2 and SYSTEM_ARCHITECTURE_v1.0 remain authoritative; endpoint names and payload shapes are proposed implementation decisions (PD-A1…PD-A8) and take no stakeholder decision.*
