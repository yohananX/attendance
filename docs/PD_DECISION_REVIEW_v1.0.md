# PD Decision Review Pack v1.0
# Grace House School Attendance Sign-In

| | |
|---|---|
| **Document** | PD Decision Review Pack v1.0 |
| **Version** | 1.0 — 30 October 2026 |
| **Author** | Decision Review (preparation only) |
| **Status** | Review pack for project owner — **No decisions approved. No documents modified. No code written.** |
| **Scope** | Review of PD-D1–D11, PD-A1–A8, PD-S1–S7 (26 decisions total). Focus on PD-A4, PD-D3, PD-S6. Interaction analysis with Q5, Q13, Q14, Q15, Q16. |
| **Sources** | `docs/DATABASE_CONTRACT_v1.0.md`, `docs/API_CONTRACT_v1.0.md`, `docs/SYNC_CONTRACT_v1.0.md`, `docs/STAKEHOLDER_DECISION_REGISTER_v1.0.md`, `docs/PRD_v1.2.md`, `docs/SYSTEM_ARCHITECTURE_v1.0.md`, `docs/IMPLEMENTATION_PLAN_v1.0.md` |

---

## 1. Executive Summary

### Decisions requiring owner approval before implementation
These decisions have structural/operational implications that cannot be resolved by safe defaults without explicit approval:

| ID | Decision | Blocker reason |
|---|---|---|
| **PD-A4** | Who enforces "outbox fully acknowledged" at day close | Affects day-close safety (FR-35/BR-17/AC-35.4). Server cannot observe device outbox — requires explicit agreement on responsibility. **Blocks implementation of day-close gating.** |
| **PD-D1** | Late-sync window value (default 7 days proposed, configurable) | Tied to **Q5** (thresholds). Window length affects acceptance/rejection behavior (FR-15/AC-15.5). Needs confirmation. |
| **PD-D2** | Enforce "exactly one accepted sign-out" via partial unique indexes | Schema-level enforcement choice. Defence-in-depth vs logic-only; affects data integrity guarantees. Should be approved before schema finalization. |
| **PD-D3** | Orphaned sign-out (sign-out arrives before sign-in syncs) | Affects cross-device/offline conflict model (FR-16). Proposed accept-into-log + provisional session + needs_review is a significant behavior change not fully specified in architecture §5.4. **Needs explicit approval.** |
| **PD-A5** | "Same child" definition for competing_sign_in | Affects conflict detection semantics (FR-16). Proposed name+phone+dayKey equality has ambiguity (typos, formatting). Needs approval. |
| **PD-A8** | Dedicated E5 endpoint for corrections | Affects API surface and offline-correction compatibility with **Q13**. Needs approval before API contract finalization. |
| **PD-S6** | Failed-review resolution mechanics | Affects FR-15/AC-15.4 (rejected events must not disappear). Resolution path undefined; proposed human action with audit needed. **Needs approval.** |
| **PD-S1** | deviceSeq reset semantics | Affects FR-12c regression checks across days/late sync. Needs clarification. |

### Decisions safe to defer
These are implementation details with safe defaults that don't block core integrity if deferred with configuration:

| ID | Decision | Notes |
|---|---|---|
| **PD-D6** | Server-side day-close record | None needed; day close is device purge. Can defer indefinitely. |
| **PD-D7** | Launch-marker idempotency (first write wins) | Safe default, low risk. |
| **PD-D8** | FR-29 identity-edit audit storage reservation | Feature cut for pilot (PRD §28). Defer until/if enabled. |
| **PD-D9** | losing_event_ids as array vs child table | Array fine for pilot volumes (~120 events/day). Defer. |
| **PD-D10** | Lockout representation (derived, no locked row) | Safe default. |
| **PD-D11** | login_attempts retention (24 hours proposed) | Operational detail, can tune later. |
| **PD-A2** | Probe transport (serverTime in every response + /api/time) | Safe default, doesn't block core sync. |
| **PD-A3** | Purge-token format (opaque, signed, single-use, 5 min TTL) | Safe if follows security requirements; details can refine. |
| **PD-A6** | FR-29 identity-edit endpoint shape (deferred) | Feature cut. Defer. |
| **PD-A7** | Launch-marker timestamp source (serverReceivedAt) | Safe default. |
| **PD-S2** | Pruning acked outbox entries | Safe default. |
| **PD-S3** | Periodic-tick interval (60s) | Tuneable parameter. |
| **PD-S4** | Batch coalescing | Safe default. |
| **PD-S5** | Low-storage warning threshold (max(10%,5MB)) | Tuneable. |
| **PD-S7** | Descriptor re-verification cadence | Safe default. |

### Decisions that can use their proposed defaults
With no owner approval needed (or defaults are clearly safe):

- **PD-D4**: Server stamps staff_name from cookie, ignores client-supplied — aligns with BR-01/S7. Safe default.
- **PD-D5**: Enforce (device_id, day_key, device_seq) uniqueness, violation as flag not rejection — safe default.
- **PD-A1**: Endpoint catalogue as proposed — architecture names only /api/login,/api/events,/api/messages/{sessionRef}/launched; full catalogue is needed for implementation. Proposed set is complete per contracts.
- Most PD-S* can use defaults except PD-S6.

### Recommended next implementation task
**Start with T1.1–T2.3 foundation (setup, schema skeleton, auth basics) BUT do NOT finalize day-close (E6) or orphaned sign-out handling until PD-A4 and PD-D3 are resolved.** Specifically: implement the append-only event log + projection + auth first (blocking for everything), but gate E6 implementation behind PD-A4 approval and gate orphaned-event handling behind PD-D3 approval. Also confirm Q5 affects PD-D1 before hardcoding late-sync window.

---

## 2. Per-Decision Review (All 26)

### Database Decisions (PD-D1–D11)

#### PD-D1: Late-sync window value
- **Decision ID/Title:** PD-D1 — Late-sync window value
- **Problem addressed:** PRD FR-15/S12 require acceptance window (Lagos day + late-sync window) but no specific value defined; DATABASE_CONTRACT says "7 days proposed, Q5 pending".
- **Proposed default:** Store as configuration, default 7 days; never hard-code.
- **Alternatives:**
  1. **Hardcode 7 days** — simple, no config needed. *Consequence:* Cannot adjust without code change; violates "never hard-code" rule. *Risk:* Inflexible if school needs different window.
  2. **Shorter window (e.g., 24-48 hours)** — stricter, less risk of stale data. *Consequence:* More rejections to failed-review. *Risk:* May reject legitimate late events.
  3. **Longer window (e.g., 14 days)** — more forgiving. *Consequence:* Larger acceptance window, more complex reconciliation. *Risk:* Stale data issues.
- **Risks if deferred:** Cannot implement FR-15 validation correctly; late events behavior undefined. Tied to **Q5**.
- **Dependencies:** **Q5** (thresholds). Affects API_CONTRACT §4.1, SYNC_CONTRACT §11, PRD FR-15.
- **Blocking:** **Required before implementation** of event ingestion validation (T2.2). Needs Q5 confirmation.
- **Recommendation:** Keep as configurable default 7 days pending Q5; implement config mechanism now.

#### PD-D2: Enforcing "exactly one accepted sign-out" at data layer
- **Decision ID/Title:** PD-D2 — Enforce exactly one accepted sign-out at data layer
- **Problem addressed:** BR-06 requires exactly one accepted sign-out per session; second becomes conflict. Need enforcement mechanism.
- **Proposed default:** Partial unique indexes on `events(session_ref)` for non-`losing` sign_in/sign_out rows (§3.1). Defence-in-depth behind ingest logic.
- **Alternatives:**
  1. **Logic-only enforcement** — simpler schema, no partial unique indexes. *Consequence:* Relies entirely on application logic; race conditions possible. *Risk:* Data integrity violation if logic fails.
  2. **Full unique constraint on sessions** — different model. *Consequence:* Not compatible with conflict model (losing events must be retained). *Risk:* Cannot preserve conflicting events.
- **Risks if deferred:** Data integrity not enforced at DB level; possible duplicate accepted sign-outs if ingest logic has bugs.
- **Dependencies:** PD-D3 (orphaned sign-out handling affects when sign-outs appear), PD-D9 (conflict model).
- **Blocking:** **Required before schema finalization** (T2.1). Strongly recommended for integrity.
- **Recommendation:** Approve partial unique indexes as proposed. Essential for BR-06 enforcement.

#### PD-D3: Orphaned sign-out handling (sign-out before sign-in syncs)
- **Decision ID/Title:** PD-D3 — Orphaned sign-out (cross-device/offline case)
- **Problem addressed:** Sign-out event arrives for session whose sign-in not yet synchronised (cross-device/offline). Architecture §5.4 doesn't address this.
- **Proposed default:** Accept into log (never drop evidence), create provisional session with `needs_review`, flag event; re-project when sign-in arrives. Rejecting strands legitimate events.
- **Alternatives:**
  1. **Reject to failed-review** — simpler, no provisional sessions. *Consequence:* Legitimate cross-device sign-outs rejected, staff must re-enter. *Risk:* Poor UX, breaks offline-first guarantee.
  2. **Queue sign-out until sign-in arrives** — complex state machine. *Consequence:* Sign-out not recorded until sign-in syncs; delays parent messaging. *Risk:* Complex to implement, may miss deadlines.
  3. **Create session on first sign-out if sign-in missing** — different model. *Consequence:* Ambiguous session identity. *Risk:* Conflicts with PRD §16.1 (sessionRef generated at first sign-in).
- **Risks if deferred:** Cannot handle legitimate cross-device scenarios. Events may be mishandled. **High impact on offline-first guarantee.**
- **Dependencies:** PD-D2 (sign-out uniqueness), session model (§3.4). Affects FR-16.
- **Blocking:** **Blocks implementation** of ingest projection logic (T2.3). Needs explicit approval.
- **Recommendation:** **Approve proposed approach** as it's necessary for offline-first and preserves evidence. This is critical.

#### PD-D4: staff_name on wire vs cookie
- **Decision ID/Title:** PD-D4 — staff_name attribution
- **Problem addressed:** BR-01 requires attribution from active session; client could spoof.
- **Proposed default:** Server ignores any client-supplied staff_name and stamps from cookie (BR-01/S7). Wire field informational only.
- **Alternatives:**
  1. **Trust client-supplied name** — simpler. *Consequence:* Spoofable attribution. *Risk:* Violates BR-01/S7.
- **Risks if deferred:** Attribution integrity compromised.
- **Dependencies:** Auth model (§4).
- **Blocking:** **Required before implementation** (T2.2, T3.1). Must enforce.
- **Recommendation:** Approve proposed default. Enforce strictly.

#### PD-D5: Uniqueness of (device_id, day_key, device_seq)
- **Decision ID/Title:** PD-D5 — Device sequence uniqueness
- **Problem addressed:** Detect sequence anomalies per FR-12c/13.
- **Proposed default:** Enforce with unique constraint; violation is consistency flag, not rejection of primary event_id path.
- **Alternatives:**
  1. **No uniqueness constraint** — simpler. *Consequence:* Cannot detect anomalies at DB level. *Risk:* Harder to detect tampering/errors.
  2. **Rejection on violation** — stricter. *Consequence:* Breaks idempotency/retry model. *Risk:* May reject legitimate retries.
- **Risks if deferred:** Harder to detect inconsistencies.
- **Dependencies:** FR-12c.
- **Blocking:** Can use proposed default. Not blocking core flow.
- **Recommendation:** Approve proposed default.

#### PD-D6: Server-side day-close record
- **Decision ID/Title:** PD-D6 — Server day-close record
- **Problem addressed:** Need to track day close?
- **Proposed default:** None. Day close is device purge; server state scoped by day_key. Optional day_closures audit row later if needed.
- **Alternatives:**
  1. **Add day_closures table** — track close events. *Consequence:* Schema complexity, sync issues. *Risk:* Not needed per PRD.
- **Risks if deferred:** None identified.
- **Dependencies:** FR-35, AC-35.5 (outstanding messages survive).
- **Blocking:** No.
- **Recommendation:** Approve proposed default. Defer.

#### PD-D7: Launch-marker idempotency
- **Decision ID/Title:** PD-D7 — Launch marker idempotency
- **Problem addressed:** E4 called multiple times.
- **Proposed default:** First write wins; repeat returns existing whatsapp_launched_at unchanged.
- **Alternatives:**
  1. **Last write wins** — not needed. *Risk:* Could overwrite timestamp.
  2. **Error on repeat** — bad UX.
- **Risks if deferred:** None.
- **Dependencies:** FR-27, AD-9.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

#### PD-D8: FR-29 identity-edit audit storage
- **Decision ID/Title:** PD-D8 — Identity edit audit
- **Problem addressed:** FR-29 deferred (cut for pilot).
- **Proposed default:** Reserve 'student_name'/'parent_phone' values in corrections.field; feature cut for pilot.
- **Alternatives:**
  1. **Don't reserve** — need to add later. *Consequence:* Schema migration if added.
- **Risks if deferred:** Easy to add later if needed.
- **Dependencies:** PRD §28 (cut order).
- **Blocking:** No.
- **Recommendation:** Approve proposed default. Defer feature.

#### PD-D9: conflicts.losing_event_ids as array vs child table
- **Decision ID/Title:** PD-D9 — losing_event_ids storage
- **Problem addressed:** Store multiple losing events.
- **Proposed default:** Array (uuid[]) — volumes ~120 events/day; child table adds no pilot value.
- **Alternatives:**
  1. **Child table** — more normalized. *Consequence:* Extra joins. *Risk:* Over-engineering for pilot.
- **Risks if deferred:** None for pilot.
- **Dependencies:** FR-16.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

#### PD-D10: Lockout representation
- **Decision ID/Title:** PD-D10 — Lockout state
- **Problem addressed:** How to represent lockout.
- **Proposed default:** Derived from recent failure counts; no "locked" row written.
- **Alternatives:**
  1. **Store locked state** — explicit. *Consequence:* Extra state. *Risk:* Stale state issues.
- **Risks if deferred:** None.
- **Dependencies:** FR-03.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

#### PD-D11: login_attempts retention
- **Decision ID/Title:** PD-D11 — login_attempts retention
- **Problem addressed:** Retention policy.
- **Proposed default:** 24 hours, purged server-side (cron/on-read pruning).
- **Alternatives:**
  1. **No retention limit** — grows unbounded. *Risk:* Storage growth.
  2. **Shorter retention (e.g., 1 hour)** — enough for 5-min window. *Consequence:* Less history.
- **Risks if deferred:** Storage grows, but volumes small.
- **Dependencies:** FR-03.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

### API Decisions (PD-A1–A8)

#### PD-A1: Endpoint names/paths and response envelopes
- **Decision ID/Title:** PD-A1 — API surface
- **Problem addressed:** Architecture names only /api/login, /api/events, /api/messages/{sessionRef}/launched; need full catalogue.
- **Proposed default:** Catalogue in §2 (/api/day, /api/corrections, /api/day-close/check, /api/time)
- **Alternatives:**
  1. **Different naming** — possible. *Consequence:* API contract mismatch.
- **Risks if deferred:** Cannot implement API routes.
- **Dependencies:** All API functionality.
- **Blocking:** **Required before implementation** of API routes (T2.2, T6.x, T7.x, T8.3).
- **Recommendation:** Approve proposed catalogue.

#### PD-A2: Probe transport
- **Decision ID/Title:** PD-A2 — Clock probe mechanism
- **Problem addressed:** How to get serverTime for probes.
- **Proposed default:** serverTime on every response + dedicated GET /api/time for open/foreground probes.
- **Alternatives:**
  1. **Only piggyback on other responses** — may miss open/foreground when no other calls. *Consequence:* Less reliable probe.
- **Risks if deferred:** Clock probing may be incomplete.
- **Dependencies:** FR-12(a), AD-3.
- **Blocking:** Can use proposed default.
- **Recommendation:** Approve proposed default.

#### PD-A3: Purge-token format
- **Decision ID/Title:** PD-A3 — Day-close purge token
- **Problem addressed:** Token format unspecified.
- **Proposed default:** Opaque, server-signed, single-use, bound to session + dayKey, ~5-minute TTL.
- **Alternatives:**
  1. **Different format** — possible. *Consequence:* Security implications.
- **Risks if deferred:** Cannot implement day-close securely.
- **Dependencies:** E6, FR-35, AD-10.
- **Blocking:** Required before E6 implementation (T8.3).
- **Recommendation:** Approve proposed default with security review.

#### PD-A4: Who enforces "outbox fully acknowledged" at day close
- **Decision ID/Title:** PD-A4 — Day-close enforcement responsibility
- **Problem addressed:** Server cannot observe device outbox; who enforces?
- **Proposed default:** Client-side enforcement (server cannot observe outbox); server supplies outstanding count + purge authorization; client may only purge acknowledged data — AC-35.4 guarantee is structural on client.
- **Alternatives:**
  1. **Server enforces** — impossible as stated. *Consequence:* Cannot work.
  2. **Trust client** — dangerous. *Consequence:* Client could purge unacknowledged data.
  3. **Hybrid** — server tracks what it acknowledged, client must prove outbox empty. *Consequence:* More complex, still client-side enforcement.
- **Risks if deferred:** **Critical** — day-close safety (FR-35/BR-17/AC-35.4) cannot be implemented correctly. Risk of data loss.
- **Dependencies:** FR-35, AC-35.4, Q14 (day-close blocking). Tied to **Q14**.
- **Blocking:** **BLOCKS implementation of day-close (T8.3/E6).** Must be resolved.
- **Recommendation:** **Approve proposed default** — it's the only viable option. Server cannot observe device state; client must enforce, server must validate counts. Need explicit agreement on this responsibility.

#### PD-A5: "Same child" definition for competing_sign_in
- **Decision ID/Title:** PD-A5 — Competing sign-in matching
- **Problem addressed:** How to detect competing sign-in?
- **Proposed default:** Normalised studentName + parentPhone + dayKey equality (no student registry).
- **Alternatives:**
  1. **Name only** — more false positives. *Risk:* Unwanted conflicts.
  2. **Phone only** — families share phones. *Risk:* Wrong matching.
  3. **Fuzzy matching** — complex. *Risk:* Over-engineering.
- **Risks if deferred:** Conflict detection may be incorrect.
- **Dependencies:** FR-16.
- **Blocking:** Required before conflict detection (T2.3).
- **Recommendation:** Approve proposed default but note ambiguity (typos). May need to refine.

#### PD-A6: FR-29 identity-edit endpoint
- **Decision ID/Title:** PD-A6 — Identity edit endpoint
- **Problem addressed:** FR-29 cut for pilot.
- **Proposed default:** Deferred; proposed shape POST /api/sessions/{sessionRef}/identity with audit discipline if enabled.
- **Alternatives:**
  1. **Don't plan** — fine for pilot.
- **Risks if deferred:** None for pilot.
- **Dependencies:** PRD §28.
- **Blocking:** No.
- **Recommendation:** Approve deferral.

#### PD-A7: Launch-marker timestamp source
- **Decision ID/Title:** PD-A7 — Launch marker timestamp
- **Problem addressed:** What timestamp to record?
- **Proposed default:** Server-stamped serverReceivedAt (client clock untrusted).
- **Alternatives:**
  1. **Client timestamp** — untrusted. *Risk:* Violates trust model.
- **Risks if deferred:** None.
- **Dependencies:** FR-27, BR-13.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

#### PD-A8: Correction submission path
- **Decision ID/Title:** PD-A8 — Correction endpoint
- **Problem addressed:** How to submit corrections?
- **Proposed default:** Dedicated E5 endpoint that writes a correction event through same ingest discipline (keeps log append-only, Q13 offline option schema-compatible).
- **Alternatives:**
  1. **Reuse E2** — possible but different semantics. *Consequence:* More complex validation.
  2. **Separate mechanism** — breaks append-only model.
- **Risks if deferred:** Cannot implement corrections (FR-30).
- **Dependencies:** FR-30, Q13 (online-only for pilot). Tied to **Q13**.
- **Blocking:** **Required before corrections implementation (T8.2).** Must resolve with Q13.
- **Recommendation:** Approve proposed default.

### Sync Decisions (PD-S1–S7)

#### PD-S1: deviceSeq reset semantics
- **Decision ID/Title:** PD-S1 — Device sequence reset
- **Problem addressed:** When to reset deviceSeq?
- **Proposed default:** Continue across days (persist in meta, never reset at day close); only day-scoped fields cleared.
- **Alternatives:**
  1. **Reset at day close** — breaks regression checks across late sync. *Risk:* Cannot detect anomalies across day boundary.
  2. **Reset daily** — same issue.
- **Risks if deferred:** FR-12c regression checks less effective.
- **Dependencies:** FR-12c.
- **Blocking:** Can use proposed default.
- **Recommendation:** Approve proposed default.

#### PD-S2: Pruning of acked outbox entries
- **Decision ID/Title:** PD-S2 — Outbox pruning
- **Problem addressed:** When to remove acked entries?
- **Proposed default:** Keep until ack applied and day cache merged, then prune immediately; never prune failed-review.
- **Alternatives:**
  1. **Keep longer** — uses more storage. *Consequence:* Minimal impact for 120 events/day.
  2. **Prune differently** — risky if not careful.
- **Risks if deferred:** Storage could grow slightly, but not critical.
- **Dependencies:** FR-35.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

#### PD-S3: Periodic-tick interval
- **Decision ID/Title:** PD-S3 — Sync tick interval
- **Problem addressed:** How often to poll while outbox non-empty?
- **Proposed default:** 60s while tab visible and outbox non-empty.
- **Alternatives:**
  1. **Shorter interval** — more responsive but more battery/network use. *Consequence:* May drain battery.
  2. **Longer interval** — less responsive. *Consequence:* Slower sync.
- **Risks if deferred:** Sync responsiveness may vary.
- **Dependencies:** AD-2.
- **Blocking:** No.
- **Recommendation:** Approve proposed default, tune if needed.

#### PD-S4: Batch request coalescing
- **Decision ID/Title:** PD-S4 — Batch coalescing
- **Problem addressed:** How to handle multiple triggers?
- **Proposed default:** At most one batch in flight; next batch immediately after successful response.
- **Alternatives:**
  1. **Parallel batches** — could overwhelm server. *Risk:* Server overload.
  2. **Different coalescing** — possible.
- **Risks if deferred:** Could cause race conditions.
- **Dependencies:** AD-2, §5.3.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

#### PD-S5: Low-storage warning threshold
- **Decision ID/Title:** PD-S5 — Storage warning threshold
- **Problem addressed:** When to warn about low storage?
- **Proposed default:** Warn when free space < max(10%, 5MB), checked at open and after each capture batch.
- **Alternatives:**
  1. **Different threshold** — tuneable.
- **Risks if deferred:** May warn too late or too early.
- **Dependencies:** FR-08, architecture §2.5.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

#### PD-S6: Failed-review resolution mechanics
- **Decision ID/Title:** PD-S6 — Failed-review resolution
- **Problem addressed:** FR-15 says rejected events go to failed-review and must not disappear until resolved, but mechanics undefined.
- **Proposed default:** Human path = correction/re-entry with audit; failed-review outbox entry cleared only by explicit user action ("Resolve") that records who/when/why locally and requires re-entry to have been made or documented reason — never automatic, never silent.
- **Alternatives:**
  1. **Automatic retry after fix** — dangerous, could cause issues.
  2. **Just delete on action** — loses audit trail.
  3. **Require correction event** — ties to FR-30.
- **Risks if deferred:** **Cannot satisfy AC-15.4** (rejected events must not disappear until resolved). Users may not know how to resolve. Blocks proper handling of rejections.
- **Dependencies:** FR-15, AC-15.4, FR-30 (correction path). Tied to day-close blocking (failed-review blocks close).
- **Blocking:** **Blocks proper implementation of failed-review handling.** Needs approval.
- **Recommendation:** **Approve proposed default** — it's reasonable and maintains audit trail.

#### PD-S7: Descriptor re-verification cadence
- **Decision ID/Title:** PD-S7 — Descriptor re-verification
- **Problem addressed:** When to check descriptor validity?
- **Proposed default:** Checked at app open and on visibilitychange → visible; no background timer.
- **Alternatives:**
  1. **Periodic check** — more responsive but uses resources.
- **Risks if deferred:** None.
- **Dependencies:** FR-04.
- **Blocking:** No.
- **Recommendation:** Approve proposed default.

---

## 3. Prioritized Decisions Analysis

### PD-A4: Day-close enforcement and purge-token behaviour
**Full analysis:**

- **Exact problem:** Server cannot observe device outbox state. Who enforces "all events acknowledged" before day close? How is purge authorized?
- **Existing proposed default:** Client-side enforcement (server cannot observe outbox); server supplies outstanding count + purge authorization via token; client may only purge acknowledged data. Token is opaque, server-signed, single-use, bound to session+dayKey, ~5 min TTL (PD-A3).
- **Alternatives:**
  1. **Server-only enforcement** — Impossible. Server has no visibility into device IndexedDB/outbox.
  2. **Client-only, no server validation** — Dangerous. Client could lie about counts and purge unacknowledged data. Violates FR-35/BR-17/AC-35.4.
  3. **Hybrid (proposed)** — Server tracks what it acknowledged per session/day; client proves outbox empty locally and gets token only if server confirms outstanding count matches; client purges only acknowledged data. *This is the only viable approach.*
- **Technical consequences:**
  - **Proposed:** Requires E6 check endpoint (server can report outstanding messages from sessions table, but cannot know device outbox). Client must verify its own outbox is empty before requesting close. Server issues token only if outstanding messages count matches and conditions met. Client purges only local data it's sure is acknowledged (outbox empty means all acked). Safe if implemented correctly.
  - **If different:** No other viable approach exists.
- **Risks if deferred:** **Critical data loss risk**. Cannot implement gated day close. AC-35.4 requires "unsynchronised events never purged" — must be enforced.
- **Dependencies:** FR-35, BR-17, AC-35.1–35.5, PD-A3 (token), **Q14** (blocking rule). Tied to Q14.
- **Blocking:** **BLOCKS T8.3 (day close). Must be resolved before implementation.**
- **Recommendation:** **Approve hybrid approach as proposed.** This is the only safe viable option. Make it explicit in docs that client enforces outbox emptiness, server enforces outstanding-message count and authorization.

### PD-D3: Orphaned sign-out handling
**Full analysis:**

- **Exact problem:** Sign-out event arrives for session whose sign-in not yet synchronised (cross-device/offline scenario). Architecture doesn't specify handling.
- **Existing proposed default:** Accept into log (never drop evidence), create provisional session with needs_review, flag event; re-project when sign-in arrives.
- **Failure scenarios:**
  1. **Sign-out arrives first (cross-device):** Device A signs out child offline, Device B hasn't synced sign-in yet. Sign-out syncs first → needs provisional session or error. Without proper handling, sign-out rejected or lost.
  2. **Sign-out after sign-in lost?** No, sign-in would be earlier.
  3. **Re-projection conflicts:** When sign-in arrives later, provisional session needs to be merged correctly without losing data.
- **Alternatives:**
  1. **Reject to failed-review** — Loses legitimate sign-out, forces re-entry. Breaks offline-first. Bad UX.
  2. **Hold sign-out in queue until sign-in arrives** — Complex, sign-out not recorded until sign-in syncs, delays messaging. Hard to implement correctly.
  3. **Create provisional session with sessionRef?** But sessionRef generated at sign-in per PRD §16.1. Orphan sign-out has sessionRef from device that did sign-out — but sign-in might come from different device with same sessionRef? Or different sessionRef? **Critical ambiguity:** sessionRef is generated at first sign-in capture. If sign-out is captured on a device that never did sign-in, where does sessionRef come from? Or if sign-in/sign-out on different devices, sessionRef should be same? Need to clarify.
- **Technical consequences:**
  - **Proposed:** Preserves evidence (append-only log accepts it), creates provisional session so it can be tracked, flags for review, re-projects when sign-in arrives. Maintains BR-12 (evidence preserved). Complex but necessary.
- **Risks if deferred:** Orphaned sign-outs may be dropped or mishandled. Breaks cross-device offline scenarios. Violates "never lost" principle.
- **Dependencies:** PD-D2 (sign-out uniqueness), sessionRef generation (§16.1 of PRD), FR-16. Needs clarification on sessionRef for orphan case.
- **Blocking:** **Blocks T2.3 (projection logic). Must be resolved.**
- **Recommendation:** **Approve proposed approach but clarify sessionRef handling.** Need to specify: if sign-out arrives with sessionRef but no sign-in exists for that sessionRef on server, create provisional session keyed by sessionRef with needs_review=true, store sign-out event, when sign-in arrives merge/provision properly.

### PD-S6: Failed-review resolution mechanics
**Full analysis:**

- **Exact problem:** FR-15 says rejected events go to failed-review and "never disappear until resolved" (AC-15.4), but no mechanics specified. How do users resolve? What actions clear failed-review state?
- **Existing proposed default:** Human path = correction/re-entry with audit; failed-review entry cleared only by explicit user action ("Resolve") that records who/when/why locally and requires re-entry to have been made or documented reason — never automatic, never silent.
- **Failure scenarios:**
  1. **Out of window event:** Event too old (>7 days) or too far in future (>5 min). User needs to re-enter with correct time or correct via different flow.
  2. **Schema rejection:** Bad data. User must fix and re-enter.
  3. **Day close blocked:** Failed-review events block close (architecture says). Must be resolvable before close.
- **Alternatives:**
  1. **Auto-delete after timeout** — Violates AC-15.4.
  2. **Require correction event** — Ties resolution to FR-30 correction flow. Makes sense if it's a time issue.
  3. **Manual re-entry creates new event** — Old failed event remains for audit, new event submitted.
- **Technical consequences:**
  - **Proposed:** Maintains audit trail, explicit resolution, prevents accidental disappearance. Requires UI for "Resolve" action, local audit of resolution, clearing only on explicit action.
- **Risks if deferred:** Cannot satisfy AC-15.4. Users confused about how to proceed. Day close may be blocked indefinitely.
- **Dependencies:** FR-15, AC-15.4, FR-30, E6 (day close blocked by failed-review). Tied to day-close flow.
- **Blocking:** **Blocks proper failed-review handling.** Needed for AC-15.4 compliance.
- **Recommendation:** **Approve proposed default.** Implement "Resolve" action that requires user to either create a correction/re-entry (which creates new event) or document reason, with audit log of resolution.

---

## 4. Interaction with Stakeholder Questions (Q5, Q13, Q14, Q15, Q16)

### Q5 — Clock and late-sync thresholds
**Interaction with PD decisions:**
- **PD-D1:** Directly tied. Late-sync window value needs Q5 confirmation (proposed 7 days). Must be configurable.
- **PD-D5:** (device_id, day_key, device_seq) uniqueness relates to clock/sequence issues.
- **PD-A2:** Probe thresholds relate to Q5 (5 min flag threshold).
- **PD-S1:** Affects sequence handling.
- **API_CONTRACT §4.1:** Mentions "5 minutes ahead of server receipt" and "7 days proposed, pending Q5".
- **SYNC_CONTRACT §11:** Late-sync window 7 days proposed, pending Q5.
- **PRD FR-15/S12:** References Q5 thresholds.

**Recommendation:** **Q5 must be answered before finalizing PD-D1 and hardcoding validation logic.** Implement as configurable with 7 days/5 min defaults pending approval.

### Q13 — Offline attendance corrections
**Interaction with PD decisions:**
- **PD-A8:** Correction submission path — needs to be compatible with offline option. Proposed E5 endpoint keeps schema-compatible.
- **AD-5:** Online-only for pilot by default, gated on Q13.
- **PRD FR-30:** Correction flow; offline capture option pending Q13.
- **SYNC_CONTRACT §13:** States online-only default for pilot.

**Recommendation:** **Q13 answer affects PD-A8 implementation detail.** Default to online-only (AD-5) for pilot; E5 endpoint design should not preclude offline later.

### Q14 — Closing the attendance day
**Interaction with PD decisions:**
- **PD-A4:** Critical. Enforcement responsibility tied to Q14 (blocking rule).
- **PD-A3:** Purge token format for gated close.
- **PRD FR-35:** Gated close, blocked until synced.
- **API_CONTRACT §9:** Day close flow.
- **SYSTEM_ARCHITECTURE §7.11:** Gated close default pending Q14.

**Recommendation:** **Q14 must be answered.** PD-A4 resolution assumes blocking is required. Default is blocking (AD-10) pending Q14.

### Q15 — WhatsApp success wording
**Interaction with PD decisions:**
- **PD-D7:** Launch marker semantics.
- **PD-A7:** Timestamp source.
- **PRD FR-27:** "WhatsApp opened" wording, never claims sent/delivered.
- **API_CONTRACT §7:** Honest wording rules.
- **SYNC_CONTRACT:** No claims of delivery.

**Recommendation:** **Q15 is about wording/claims.** PD decisions already enforce honest wording (BR-13, "WhatsApp opened"). No structural conflict; Q15 is confirmation/approval of wording policy.

### Q16 — Residual technical risks
**Interaction with PD decisions:**
- **PD-D4:** Attribution limitations.
- **PD-S7:** Descriptor expiry vs untrusted clock.
- **PRD S10/S11/S14:** Document residual risks (unencrypted local storage, copied descriptor, clock manipulation).
- **API_CONTRACT §12:** Lists residual risks.

**Recommendation:** **Q16 is acknowledgement of risks.** PD decisions don't eliminate these risks; they document them. No blocking changes needed, just explicit acknowledgement.

---

## 5. Ambiguities and Contradictions Identified

### Ambiguities
1. **PD-D3 sessionRef for orphaned sign-out:** Unclear how sessionRef is handled when sign-out arrives before sign-in. PRD says "session reference generated at first sign-in capture" — if sign-out captured first on different device, where does sessionRef come from? Need clarification.
2. **PD-A5 "same child" matching:** Normalisation rules for name comparison not specified (case, spacing, accents). Could cause false positives/negatives.
3. **PD-S6 resolution scope:** What counts as "resolved"? If user re-enters, old failed event remains — is that considered resolved? Need clear definition.
4. **PD-A4 client enforcement:** How does client prove outbox is empty to server? Server can't verify directly. Need to define the protocol.
5. **Late-sync window interaction with day close:** Can late event arrive after close? PRD says yes (F13) within window — but close purges local data. Server state remains.

### Contradictions
1. **PD-D2 vs PD-D3:** Partial unique index on sign-out events could conflict with orphaned sign-out acceptance if not careful about provisional sessions.
2. **Offline corrections:** PD-A8 says schema-compatible for offline later, but AD-5 says online-only for pilot pending Q13. Need to ensure E5 design doesn't force online-only inappropriately.
3. **Day close and failed-review:** Failed-review events block close (architecture implies), but PD-S6 resolution needs to work before close. Circular dependency possible if not handled.
4. **Session projection rebuild:** PD-D3 says re-project when sign-in arrives for orphaned sign-out — but projection is derived from log; need to ensure re-projection doesn't corrupt state.

---

## 6. Final Recommendations

### Must resolve before implementation starts
1. **PD-A4** — Day-close enforcement (critical safety issue)
2. **PD-D3** — Orphaned sign-out handling (breaks offline-first if not handled)
3. **PD-S6** — Failed-review resolution (required for AC-15.4)
4. **PD-D1** + **Q5** — Late-sync window (needed for validation)
5. **PD-A1, PD-A8** — API surface for core flows

### Can resolve during implementation with defaults
Most others can use proposed defaults as specified.

### Implementation order recommendation
1. **Phase 0:** Resolve blocking decisions (PD-A4, PD-D3, PD-S6, PD-D1 with Q5) — do this first
2. **Phase 1:** T1.1–T2.1 (setup, schema) with decisions applied
3. **Phase 2:** T2.2–T3.2 (ingest, auth)
4. **Phase 3:** T4.x–T6.x (offline, sync, conflicts)
5. **Phase 4:** T7.x–T8.x (messaging, close) with PD-A4/PD-S6 implemented

**Critical note:** Do not implement day-close (E6/T8.3) until PD-A4 is explicitly approved. Do not implement orphaned sign-out handling until PD-D3 is approved. Do not finalize failed-review UI until PD-S6 is approved.
