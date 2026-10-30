# Sync Contract v1.0
# Grace House School Attendance Sign-In

| | |
|---|---|
| **Document** | Sync Contract v1.0 |
| **Version** | 1.0 — 30 October 2026 |
| **Author** | Lead Software Architect |
| **Status** | Proposed technical contract — pending review; stakeholder-gated items (Q5, Q13, Q14, Q16) flagged, not decided |
| **Authoritative sources** | `PRD_v1.2.md` (FR-08…FR-16, FR-35, BR-05/11/12/20/21, §16.2/§16.4), `SYSTEM_ARCHITECTURE_v1.0.md` (§2 offline-first, §5 protocol, AD-2/AD-3/AD-6/AD-7) |
| **Companion contracts** | `API_CONTRACT_v1.0.md` (HTTP semantics), `DATABASE_CONTRACT_v1.0.md` (server storage) |
| **Scope limits** | The **client-side** synchronisation contract: canonical event structure, identity, ordering, batching, retry, acknowledgement, state machine, persistence and late-sync behaviour. Server behaviour is specified in the API contract; both sides implement **one shared event schema** (§3). **No application code** — implementation is `IMPLEMENTATION_PLAN_v1.0.md` T4.x/T6.x. |
| **Honesty rules applied** | Pending decisions (Q5, Q13, Q14, Q16) are implemented to safe defaults and labelled. Queue duration is never presented as clock skew (FR-12b). No state is claimed that the client cannot verify (BR-22). |

---

## 1. Principles

1. **Durability before success:** a record is never shown as saved until the local write is confirmed by transaction completion **plus read-back** (FR-08, BR-21, AD-6). Storage failure is a blocking error, never a success state (AC-G3b).
2. **One path online and offline:** the same write-ahead flow runs in both cases; only the immediate push differs (FR-09/AC-09.3).
3. **The outbox is the queue of record:** nothing else decides what still needs sending; an event leaves the outbox only after a per-event acknowledgement (FR-13, architecture §2.2).
4. **Identity before persistence:** `eventId` (and `sessionRef` on first sign-in) are generated before the write and never regenerated (BR-20, PRD §16.1).
5. **Never lost, never duplicated, never silently dropped:** retries are idempotent; rejections become visible `failed-review`; day close cannot purge unacknowledged data (FR-13/15/35).
6. **No silent overwrite:** conflicts preserve both events; resolution is a deliberate audited correction (FR-16, AD-4).

## 2. Event identity

| Identity | Generation rule | Lifetime | Source |
|---|---|---|---|
| `eventId` | UUID v4, generated **at the moment of capture, before persistence**; immutable thereafter; retries re-send the same identity | Permanent — the idempotency key (server accepts each exactly once, FR-13/BR-20) | PRD §16.1, architecture §3.1 |
| `sessionRef` | UUID v4, generated on the client **at the first sign-in capture, before persistence** (no server round-trip is possible offline). Server binds it to the accepted sign-in and never renumbers it. **A new sign-in after an accepted sign-out generates a new `sessionRef`** (new session, never a conflict) | Permanent per child-session; shared by that session's sign-out, corrections and conflict evidence | PRD §16.1 note (v1.2), architecture §3.4 |
| `deviceId` | Random UUID created **once per browser install**, stored in `meta`; sent with login and every event | Survives day close; **not** a security credential; rate-limit/attribution key only (reset-on-storage-clear documented, AD-8) | FR-03, architecture §3.5 |
| `deviceSeq` | Monotonically increasing integer, incremented per capture on that device; starts at 1 after install or day-close reset | Per-device ordering evidence; a decrease for the same device+day is a consistency flag (FR-12c) and cannot occur by construction | FR-13 Ordering, architecture §3.5 |

Event IDs and session references are distinct: event IDs are per-action idempotency keys; the session reference groups actions into one child-session (PRD §16.1).

## 3. Canonical event structure (wire schema — shared by client and server)

This is the single event schema both sides implement; it maps 1:1 to `DATABASE_CONTRACT_v1.0.md` §3 and is carried in `POST /api/events` batches (API_CONTRACT §4).

| Field | Type | Required | Source of value | Immutability |
|---|---|---|---|---|
| `eventId` | UUID string | yes | Client, at capture | Immutable |
| `eventType` | `sign_in` \| `sign_out` \| `correction` | yes | Client | Immutable |
| `sessionRef` | UUID string | yes | Client (new at first sign-in) | Immutable |
| `studentName` | string | sign_in | Staff input (typed at gate) | Immutable on the event (identity edits are projection-level, FR-29) |
| `parentPhone` | E.164 string | sign_in | Staff input, normalised per FR-06 (`0…` → `+234…`; other `+` with 7–15 digits as-is) | Immutable on the event |
| `deviceEventAt` | ISO-8601 UTC (ms) | yes | **Device clock at the tap** — the time of record; never typed (FR-07) | **Immutable** (BR-05) |
| `capturedOffline` | boolean | yes | `!navigator.onLine` at capture | Immutable |
| `deviceId` | UUID string | yes | `meta` store | Immutable |
| `deviceSeq` | integer | yes | `meta` counter + 1 | Immutable |
| `dayKey` | `YYYY-MM-DD` | yes | Client: Africa/Lagos date of `deviceEventAt`; **server recomputes and verifies** | Immutable |
| `staffName` | string | informational | Active session name (BR-01); **server stamps from cookie** (PD-D4) | Immutable |
| correction payload | object | correction only | `field`, `newValue`, `baseValue`, `baseServerVersion`, `conflictId?` (API_CONTRACT §6) | Immutable |

**Dual timestamps:** `deviceEventAt` (time of record) and `serverReceivedAt` (provenance, stamped by the server at ingestion) are preserved **per event** and both displayable (FR-11/AC-11.1). Their difference is stored as `queuedDuration`, **labelled queue time and never clock skew** (FR-12b, AC-12.3, BR-22). The system never rewrites a timestamp (FR-12).

## 4. Write-ahead capture (identical online and offline)

Per action (architecture §2.4, PRD §14.1/14.2):

1. Validate input client-side (name/phone required; phone normalisation FR-06).
2. Generate `eventId`; if first event of a child-session, also `sessionRef`. Guard: a second sign-out for a session already signed out on this device is a **no-op** — no event is created (FR-18/AC-18.1).
3. Capture `deviceEventAt` once at the tap; attach `deviceId`, next `deviceSeq`, `capturedOffline`.
4. **One IndexedDB transaction:** insert the outbox entry **and** upsert the `sessions` day-cache overlay row.
5. Wait for transaction completion **and read the outbox row back** (AD-6).
6. **Only now** show success/pending UI (FR-08, BR-21, SC6). Write failure (quota/blocked) → **blocking error** with the paper instruction; no success state, no outbox entry, child not listed (AC-G3b, E16).
7. If online, push immediately as part of the action flow (FR-09); the state machine below is identical offline (Pending → Synced).

## 5. Outbox state machine

States (`state` on the outbox entry — architecture §2.3/§2.7):

```
pending ──► inflight ──► acked (removed after applying the ack)
   ▲            │
   │            ├─ transport failure / 5xx ──► failed-retryable ──► pending (after backoff)
   │            ├─ validation rejection ─────► failed-review (terminal until a human acts)
   │            └─ conflict with existing ───► acked + session conflict flag set
   └── app restart / rehydration resets stale inflight entries to pending
```

| State | Meaning | UI | Exit |
|---|---|---|---|
| `pending` | Durably stored, awaiting submission | *Saved on device (pending sync)* / amber | Sync loop picks it up |
| `inflight` | Included in a submitted batch, awaiting per-event result | *Syncing* (animated) | Per-event result; or reset to `pending` on restart (§8) |
| `failed-retryable` | Transport failure or 5xx for the batch | *Failed* + Retry | Automatic backoff retry, or manual Retry (FR-10) |
| `failed-review` | Server rejected the event (window/schema) with a reason | *Failed — needs review* + reason; **blocks day close** | Human resolution via correction/re-entry — **never blind retry** (FR-15, E15); never disappears (AC-15.4) |
| `acked` | Server result `accepted`/`duplicate`/`conflict` received | Row shows *Synced* (conflict additionally flagged) | Removed from outbox **after** the ack is applied to the day cache; may be pruned to bound storage |

The sync badge aggregates these states: "All synced · N pending · N failed — Retry" (FR-10, PRD §11.3).

## 6. Submission, batching, ordering, retry

| Aspect | Specification | Source |
|---|---|---|
| Endpoint | `POST /api/events`, cookie-authenticated | Architecture §5.3 |
| Batch limits | ≤ **50 events** and ≤ **128 KB** per request; after a successful batch, the next batch is sent immediately until the outbox is empty | Architecture §5.3 |
| Ordering | Oldest-first; one device's events in `deviceSeq` order; a session's sign-in enqueued before its sign-out on that device — a single device's own events cannot arrive out of order | FR-13 Ordering |
| Triggers | (1) immediately after an online capture, (2) `online` event, (3) app start, (4) foreground return (**mandatory** — iOS has no reliable background sync, A6/C9/RK13), (5) visible-tab tick every 60 s while outbox non-empty, (6) manual Retry | AD-2, architecture §2.9 |
| Concurrency | **One sync loop at a time** — in-flight guard; triggers during an active run are coalesced | Architecture §2.9 |
| Backoff | Exponential with jitter: **2 s, 5 s, 15 s, 60 s, 300 s (cap) ± 20 %**, then every 5 minutes while open and online. `429` honours `Retry-After`. **Retries never stop permanently** for retryable failures — an event stays pending until acknowledged or rejected to review (E2, FR-13) | Architecture §2.8 |
| Manual Retry | On the badge and per row; resets the backoff timer; **never duplicates** (idempotency) | FR-10.2 |
| Offline | No retries attempted; the `online`/foreground triggers restart the loop | Architecture §2.8 |

## 7. Acknowledgement format and semantics

An acknowledgement exists **only after the server transaction that accepts the event has committed** (architecture §2.10). Per-event, even when transport is per-batch:

| Result (API_CONTRACT §4.2) | Client action |
|---|---|
| `accepted` + `serverReceivedAt` + projection snapshot | Remove from outbox; merge projection into the day cache; row → *Synced* |
| `duplicate` + original acceptance | Identical to accepted — idempotent no-op (AC-13.2) |
| `rejected` + machine-readable reason | Outbox entry → `failed-review`; show reason on row and badge; no automatic retry (FR-15) |
| `conflict` + conflict info + projection | Remove from outbox (the event **was accepted**); set session conflict flag; surface for lead-teacher review (FR-16/32). **Conflicts are not errors** (architecture §5.7) |

Rules:
- The client **never renders "Synced" on transport success alone** — only on a per-event `accepted`/`duplicate`/`conflict` result (architecture §5.8).
- **Partial batch failure:** transport failure (network/5xx) fails the whole batch → all entries stay `pending`/`failed-retryable`. Per-event rejections are *not* transport failures: accepted events in the same batch are acknowledged normally; only rejected entries enter `failed-review` (never all-or-nothing loss — architecture §5.5).
- Merging a projection snapshot **never discards local unacknowledged state**: pending local events overlay the server row for display (FR-17.1 requires unsynced children to appear; architecture §2.3).

## 8. Duplicates and interrupted sync

Three layers (architecture §2.11, FR-13):

1. **Identity:** `eventId` generated once at capture, immutable; retries resend the same identity.
2. **Server acceptance:** each `eventId` accepted exactly once; a repeat submission returns the **original acknowledgement** — not an error, not a second row (AC-13.1/13.2).
3. **Client hygiene:** an event leaves the outbox only after its ack; interrupted in-flight entries reset to `pending` on app load/foreground and are resubmitted — safe by layers 1–2 (AC-13.3).

Convergence guarantee: any interleaving of capture, crash, restart and retry yields **exactly one server record per `eventId`** (AC-G4; "kill the network mid-request → restart → exactly one record", plan T6.1).

## 9. Conflict preservation and resolution

- **First synchronised wins** for the session's displayed time: the server orders competing events by `serverReceivedAt` (FR-16).
- The losing event is **retained permanently** in the log with `conflictMarker='losing'`; a conflict record links both; the session is flagged `time_conflict` (BR-12). **Nothing is ever silently overwritten or discarded.**
- The UI shows the flag as **icon + text** (never colour alone) on the row and in day review, typed as *time conflict* or *correction conflict* (FR-32/AC-32.2, U-A4).
- **Resolution** is the lead teacher choosing "use first recorded time" or "use later event's time" (AD-4) via the audited correction (API E5) referencing the conflict; both originals remain retrievable afterwards (AC-16.3).
- **Correction conflicts:** a correction carries its base value + base `serverVersion`; if the record changed elsewhere meanwhile, it is **flagged for review, not applied, both values retained** (AC-30.5).
- A cross-device `sign_in` while the child is still in school resolves first-synchronised-wins like any other conflict; a `sign_in` after an accepted sign-out is a **new session**, never a conflict (FR-16 new-session rule, v1.2).
- The offline duplicate warning (FR-23, S) is **best-effort** against local + last-synced data only — devices cannot see each other's unsynced data (C6, K5).

## 10. Local persistence and recovery

| Store | Contents | Recovery rule | Source |
|---|---|---|---|
| `outbox` | Unacknowledged events (full canonical event + state/attempts/nextAttemptAt/lastError) | **Never purged unacknowledged.** Day close is refused while any entry is un-acked (FR-35, BR-17, AC-35.4) | Architecture §2.3, PRD §16.2 |
| `sessions` (day cache) | Mirror of the server projection for today, overlaid with this device's unacknowledged events | **Derived state** — rebuilt from server snapshots; the overlay keeps lists correct offline | Architecture §2.3 |
| `messages` (cache) | Last cached outstanding-message list (server-held source of truth, AD-9) | Marked as possibly incomplete offline (FR-31-style banner) | Architecture §2.3/§6.5 |
| `sessionDescriptor` | `{staffName, issuedAt, expiresAt, keyId, signature}` — **nothing else; no PIN, no verifier** | Gates offline UI at open + foreground; expired → "Session expired — connect to log in", **no attendance data rendered** (AC-04.2). Expiry is checked against the **untrusted device clock** — documented limitation **pending Q16** (S14, C12) | FR-04, S11 |
| `meta` | `deviceId`, login-attempt counter + lock-until, last probe (`offsetSec`, `rttMs`, `measuredAt`), `lastSyncAt`, `schemaVersion`, current `dayKey` | Cleared at day close **except `deviceId`** | Architecture §2.3 |

Durability rules (FR-08/14, BR-21): durable IndexedDB (not memory/per-tab); **persistent storage requested** at first login (`navigator.storage.persist()`, A13); storage usage monitored with an early low-storage warning (proposed threshold: below the larger of 10 % or 5 MB — architecture §2.5, measurable, adjustable in pilot); write confirmed before any success UI; failure → blocking error, never false success.

**Recovery after refresh / closure / restart** (FR-14, AC-14.1–14.3): nothing authoritative lives in memory — on load the app rehydrates `sessions`, `outbox`, descriptor and `meta` from IndexedDB, resets stale `inflight` entries to `pending`, and the sync triggers fire. Closing the browser or the installed PWA loses nothing; device restart → shell served offline → rehydrate → sync.

**Documented residual risks (pending Q16 — never presented as prevented):** deliberate browser-data clearing, eviction under storage pressure and hardware loss can destroy **un**synchronised events (E21, RK15, S10); mitigations are persistent-storage request, sync-as-soon-as-online, low-storage warnings and the end-of-day "All synced" gate (architecture §2.13). The UI never claims otherwise (BR-22).

## 11. Late sync

- `dayKey` derives from `deviceEventAt` — **never from sync time**; a late event attaches to its original Lagos day and is never re-dated (§16.4, architecture §3.9).
- Inside the permitted late-sync window — **7 days proposed, pending Q5** (configurable value, never hard-coded): **accepted**, attached to the original day, flagged `lateSynced`, visible in that day's review (E23, AC-15.5).
- Beyond the window, or `deviceEventAt` more than **5 minutes ahead of server receipt** (**Q5 proposed**; no backwards tolerance): **rejected** to the device's visible `failed-review` state with a reason — **never silently dropped** (AC-15.2/15.4, FR-15).
- Day close does not lock the server day: a late event after close is still accepted into the closed day within the window (F13).

## 12. Clock probe and consistency flags (FR-12, AD-3)

| Component | Behaviour |
|---|---|
| Probe | Round-trip measurement at app open, foreground and sync start (piggybacked `serverTime`, or `GET /api/time`); stores `offsetSec`, `rttMs`, `measuredAt`; accuracy ± ½ RTT. **Advisory only — never gates ingestion, never rewrites a timestamp** (AC-G5) |
| Fast clock | `deviceEventAt` more than the tolerance (**Q5 proposed 5 min**) ahead of `serverReceivedAt` → visible **ahead-of-receipt** consistency flag; stored time unchanged; subsequent probe records a matching positive offset estimate (AC-12.2) |
| Slow clock | **No receipt-comparison rule can fire** — a slow clock is indistinguishable from queue time; evidenced only by the post-reconnect probe offset estimate (X-2, AC-G5) |
| Other flags | Sign-out before sign-in; device time outside the Lagos day; per-device `deviceSeq` regression (FR-12c) |
| Labelling | `queuedDuration` is stored and displayed as **queue time**, never as skew; true offline wall-clock accuracy **cannot be verified and is never claimed** (FR-12 verifiability statement, BR-22) |
| Threshold | The 5-minute flag threshold and 5-minute future tolerance are the **proposed Q5 values**, kept configurable (decision register) |

## 13. Gates on pending stakeholder decisions

| Decision | Safe default implemented here | What changes if decided otherwise |
|---|---|---|
| **Q5** | Flag threshold 5 min; future tolerance 5 min (max); late-sync window 7 days — all configurable | Threshold/window values only; no structural change (AD-3/AD-7) |
| **Q13** | Corrections are **online-only** for the pilot: no correction event is ever queued offline; the offline capture path handles `sign_in`/`sign_out` only (AD-5) | If offline corrections are approved, the same canonical event (`eventType='correction'`) is queued in the outbox — **no schema change** (DATABASE_CONTRACT §5) |
| **Q14** | Day close **blocked** unless online + outbox fully acknowledged + outstanding count confirmed; only acknowledged data purged; **no "purge anyway"** (AD-10, FR-35) | A relaxed rule would need an explicit stakeholder decision; the purge discipline (never purge unacked) does not change |
| **Q16** | Residual risks (device-clock manipulation, unencrypted local data, storage clearing/eviction, descriptor expiry vs untrusted clock) are **documented, not hidden, not claimed prevented** (§10) | Acknowledgement records acceptance; it does not alter this contract's behaviour |

## 14. Proposed decisions (PD-S#) — unresolved in the architecture, proposed here

| ID | Question | Proposed decision | Status |
|---|---|---|---|
| **PD-S1** | `deviceSeq` reset semantics | Continue across days (persist in `meta`, never reset at day close); the `meta` day-close rule clears day-scoped fields only, **not** the sequence counter — keeps FR-12c regression checks meaningful across a late sync into a previous day | Proposed (architecture §2.3 leaves the reset point implicit) |
| **PD-S2** | Pruning of `acked` outbox entries | Keep acknowledged entries until the ack is applied **and** the day cache merged, then prune immediately to bound storage (~120 events/day makes retention cheap either way); never prune `failed-review` | Proposed |
| **PD-S3** | Periodic-tick interval | 60 s while tab visible and outbox non-empty (AD-2 "visible-periodic tick" without value) | Proposed |
| **PD-S4** | Batch request coalescing | At most one batch in flight; the next batch is requested immediately after a successful response (architecture §5.3) | Proposed |
| **PD-S5** | Low-storage warning threshold | Warn when free space < max(10 %, 5 MB), checked at open and after each capture batch (architecture §2.5 value) | Proposed |
| **PD-S6** | `failed-review` resolution mechanics | Human path = correction/re-entry with audit; the `failed-review` outbox entry is cleared only by an explicit user action ("Resolve") that records who/when/why locally and requires the re-entry to have been made or a documented reason — never automatic, never silent (FR-15/AC-15.4 leave the mechanics open) | Proposed |
| **PD-S7** | Descriptor re-verification cadence | Checked at app open and on `visibilitychange` → visible (architecture §4.3); no background timer | Proposed |

## 15. Cross-contract consistency

- **One schema:** §3 is the canonical event structure; `API_CONTRACT_v1.0.md` §4 mirrors it for the server, and `DATABASE_CONTRACT_v1.0.md` §3 stores it 1:1. Frontend and backend implement the same field names, types and immutability rules.
- **Results ↔ states:** API results map to outbox states exactly as in §7; `conflict` is acceptance-plus-flag on both sides (never an error on either side).
- **Idempotency chain:** client `eventId` → server PK + original-acknowledgement return → client safe resubmission (§8 ↔ API §4.1 step 4 ↔ DATABASE §7).
- **Day close:** this contract's purge discipline (acknowledged data only, descriptor + day cache cleared) implements API_CONTRACT E6's token flow and FR-35; the server copy survives (AC-35.5).
- **No contradictions:** Q5/Q13/Q14/Q16 defaults here match the decision register, PRD v1.2 and architecture AD-3/AD-5/AD-7/AD-10; WhatsApp wording honesty (Q15) is unaffected by sync state (no sync surface ever claims message send/delivery).

*End of Sync Contract v1.0. No application code is contained here. PRD v1.2 and SYSTEM_ARCHITECTURE_v1.0 remain authoritative; PD-S1…PD-S7 and the mirrored PD-A/PD-D items are proposed implementation decisions pending review, and take no stakeholder decision.*
