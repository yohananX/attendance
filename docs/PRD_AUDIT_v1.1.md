# Technical Consistency Audit — School Attendance Sign-In PRD
# Audit of PRD v1.0 → Revision v1.1

| | |
|---|---|
| **Document** | Technical Consistency Audit Report |
| **Version** | 1.0 |
| **Date** | 30 October 2026 |
| **Auditor role** | Senior Software Architect / Offline-First Systems Engineer / Database Architect / Technical Product Analyst |
| **Input** | `PRD.md` (v1.0, approved working baseline) |
| **Output** | `PRD_v1.1.md` (corrected baseline) + this report |
| **Scope limits observed** | No application code, SQL, migrations, API/UI implementation, or System Architecture Document produced. No requirement removed. No stakeholder decision taken silently. |

---

## 1. Audit findings, ranked

Classification key — **[TC]** technical correction (implementation-level fix, does not change an approved business requirement) · **[RA]** requires stakeholder approval before architecture sign-off.

### 1.1 CRITICAL

#### T-C1 — Single-row timestamp model cannot represent two events **[TC]**
- **Area:** A — Attendance event and timestamp model (FR-11, FR-13, BR-05, §16.1).
- **Finding:** v1.0 models an attendance session as one row carrying one `event_id`, one `device_event_at`, plus `signed_in_at`/`signed_out_at`. Sign-in and sign-out are two separately captured actions: each requires its own idempotency key, its own device-captured timestamp, its own server-receipt timestamp, and may be captured on a different device. A single `event_id` on the session row identifies neither action unambiguously, so a retried sign-out cannot be deduplicated, and "the device timestamp of the record" cannot be both arrival and departure.
- **Why it matters:** this breaks FR-13 (idempotency), corrupts FR-11 (dual timestamps), and makes offline requirements 5 and 7 unimplementable.
- **Resolution:** append-only **event log** (one entry per captured action: client-generated event ID, type sign-in/sign-out, session reference, device time, receipt time, offline flag, device ID, per-device sequence, capturing staff name) + **session projection** (one row per child per day: identity, accepted times derived from events, day key, attribution, sync/conflict/correction/message state) + **audit stores** (corrections, conflicts, login attempts). Event timestamps immutable; the projection is the only mutable, UI-facing state.

#### T-C2 — Offline session as specified is not technically feasible **[RA]**
- **Area:** B — Offline authentication (FR-04, AC-G1, S1, S11).
- **Finding:** an HTTP-only cookie cannot be read by client JavaScript, and while offline there is no server to validate a signature or enforce expiry. v1.0's AC-04.2 ("expired session offline is refused") implies an enforcement mechanism that cannot exist offline.
- **Resolution:** two-layer session. (1) **Online layer:** signed HTTP-only cookie, 12 hours, required for every server API call (unchanged). (2) **Offline layer:** on successful login the app stores a **signed session descriptor** locally — staff first name, issued-at, expiry only — signed with the server's private key and verifiable offline using a public key shipped with the app. No PIN, no PIN verifier, no shared secret in the browser. The app checks the descriptor at open and foreground; on expiry it presents a session-expired screen and shows no attendance data.
- **Stated limitations (must be acknowledged, SQ4):** offline expiry is evaluated against the **device clock**, which is untrusted — a rolled-back clock extends offline access until the next online contact; server-side acceptance windows (FR-15) bound the effect. A copied descriptor could unlock the offline UI elsewhere, but carries no data and cannot pass server APIs. Attendance data at rest is presented-but-not-served after expiry; deletion at expiry is not claimed.

#### T-C3 — Device-clock skew cannot be measured as v1.0 implies **[TC]**
- **Area:** D — Clock accuracy (FR-12).
- **Finding:** `server_received_at − device_event_at` equals **clock skew + time spent queued offline**. The two are mathematically inseparable for an already-captured event. v1.0's "device clock compared with the server clock at synchronisation" invites precisely this invalid computation and would produce false flags for every legitimately offline event.
- **Resolution (what can and cannot be verified):**
  - **Verifiable:** a client↔server **round-trip probe** while online estimates *current* clock offset with uncertainty ≈ ½ RTT; recorded with measurement time. Deterministic consistency rules: sign-out earlier than sign-in; device time more than a tolerance ahead of receipt; device time outside its Lagos day; per-device sequence regression.
  - **Recorded but not skew:** `queued_duration = server_received_at − device_event_at`, explicitly labelled as queue time.
  - **Not verifiable:** the true wall-clock time of an offline-captured event. Detection of inconsistency ≠ proof of accuracy. Flags only; never a silent rewrite; corrections via the audited path.

#### T-C4 — Day-close purge can destroy unsynchronised or outstanding data **[RA]**
- **Area:** G — Day boundaries (FR-35, BR-17).
- **Finding:** v1.0 says purge happens "after all events are synchronised" but defines no enforced preconditions. A close attempted offline, or with a failed sync, would purge the only copy of unsynchronised events. The local outstanding-message list could be purged while messages were still unsent.
- **Resolution:** Close day is a **gated online operation**: (1) device online; (2) outbox empty with per-event server acknowledgement; (3) outstanding-message count displayed (state is server-held, so purging the local copy loses nothing) with explicit confirmation; (4) only server-acknowledged data purged; unsynchronised events **never** purged. Offline or non-empty outbox → close is blocked with a clear message; no "purge anyway".

### 1.2 HIGH

| ID | Area | Finding | Resolution | Class |
|---|---|---|---|---|
| **T-H1** | C | FR-16 requires preserving the losing conflicting event, but the one-row model has nowhere to store it; conflicting *corrections* have no defined semantics. | Event log preserves all conflicting events immutably; markers on the projection; resolution via audited correction referencing the conflict; corrections carry a **base value** — mismatch at sync raises a review flag instead of silent application. | TC |
| **T-H2** | F | The browser verifies only *text prepared* and *navigation initiated*. FR-24/FR-27 ("cannot be opened", "successfully opened"), SC3 ("parent receives") and AC-G8 ("WhatsApp opens") promise unverifiable behaviour. | Four-state ladder: **prepared → link launched → sent (unverifiable) → delivered (unverifiable)**. Marker renamed `whatsapp_launched_at`; UI chip "WhatsApp opened"; Copy control always available; end-of-day delivery confirmation stays a staff runbook duty. SC3 rewording → **SQ3**. | RA |
| **T-H3** | E | "Survives refresh/closure" ≠ survives storage eviction, quota exhaustion, browser-data clearing. v1.0 shows success on tap even if the local write fails — confirming an attendance record that does not exist. | Success UI only after **confirmed durable local write**; request persistent storage; monitor quota and warn early; storage failure → blocking error with paper instruction, never success; absolute claims in SC4/U10 qualified to the defined failure set. | TC |
| **T-H4** | A | Two offline devices may correct the same field; no resolution defined — silent overwrite would violate the "never silently overwritten" rule. | Base-version check at sync; both corrections retained; session flagged for review. Offline-capable corrections recommended; online-only alternative → **SQ1**. | RA |
| **T-H5** | B/E | A shared device keeps the last login's session; offline actions are attributed to that name even if another person used the phone. | Document: attribution follows the active session, not the physical person (extends BR-01/BR-16 caveat); re-login on handover added to runbook rule. | TC |

### 1.3 MEDIUM

| ID | Finding | Resolution | Class |
|---|---|---|---|
| **T-M1** | FR-03 rate limit keys on undefined "device"; IP unsuitable on mobile; local counter resets when storage cleared. | Define per-browser local identifier/counter; document reset limitation; no IP counting. | TC |
| **T-M2** | FR-06 normalisation is Nigeria-only; non-`+234` numbers undefined. | Rule: strip formatting; leading `0` → `+234`; other `+` numbers with 7–15 digits accepted as-is; otherwise reject with message. | TC |
| **T-M3** | Offline event synced after midnight: which Lagos day do lists/CSV/"today" use? | Day key = Lagos calendar date of `device_event_at`; late-synced events attach to their original day, flagged "late", never dropped. | TC |
| **T-M4** | FR-15 has no future-clock tolerance and no defined reaction to rejection. | Tolerance (proposed 5 min, Q5); rejected events enter visible "failed — needs review", resolved via correction path; never silent drop. | TC |
| **T-M5** | FR-24 "cannot be opened → fallback" detection unreliable. | Folded into T-H2: Copy control always present. | TC |
| **T-M6** | FR-31 day review and FR-34 bulk sign-out are partial offline (device knows only local + synced sessions) — unstated. | Scope stated explicitly in both requirements. | TC |
| **T-M7** | E19 (correction after message sent) behaviour undefined. | Show corrected time on re-open, flag "corrected after message", staff decides about re-send. | TC |
| **T-M8** | FR-08 local queue vs FR-09 "sync as part of action" — two divergent paths. | Single write-ahead path for every action: durable local save first, then push (immediate when online). | TC |

### 1.4 LOW

| ID | Finding | Resolution | Class |
|---|---|---|---|
| **T-L1** | FR-20 priority Should→Must elevation unconfirmed (existing Q10). | Re-flagged §27. | RA |
| **T-L2** | `message_opened_at` name overstates semantics. | Model field renamed `whatsapp_launched_at`. | TC |
| **T-L3** | Thresholds/targets unconfirmed (Q5, Q6, Q8). | Remains §27. | RA |
| **T-L4** | "Record shows corrected" display rule unspecified. | Icon + text label, never colour alone (per U-A4). | TC |
| **T-L5** | §16.1 conflated session and event columns in one table. | Replaced by three-part conceptual model. | TC |

---

## 2. Explanation of contradictions and implementation risks (summary)

1. **Integrity contradiction (T-C1/H1):** the source document's core promise is "times nobody can type or alter"; offline capture moved time origin to the device, and v1.0 kept a single-row schema that cannot represent two device times, two idempotency keys, or preserve a losing conflict. The event log is the minimum structure that keeps every approved promise simultaneously (immutability, idempotency, evidence preservation, audited correction).
2. **Verification contradiction (T-C3/H2):** three requirements promised detection/proof the platform cannot deliver (skew from receipt difference; WhatsApp send confirmation). Both are resolved by *narrowing the claim, not removing the requirement*: flags/probes instead of proof; "link launched" instead of "sent".
3. **Durability contradiction (T-H3/T-C4):** the product's success criterion is "no record lost", while the specified flows could confirm unsaved data (write failure) or purge unsynced data (day close). Resolved by confirmation-before-success and gated day close.
4. **Session contradiction (T-C2):** offline access with no local secret and no server — resolved with a signed descriptor plus explicitly acknowledged client-side enforcement limits.
5. **Risk accepted knowingly:** device clock untrusted (C4), local data unencrypted (K7a restated honestly), shared-PIN attribution (D6) — none hidden, all carried into §25/§26/§27 of v1.1.

---

## 3. Questions requiring stakeholder decisions

| # | Question | Recommendation |
|---|---|---|
| SQ1 | Corrections: capture offline (queued, version-checked) or online-only? | Offline supported. |
| SQ2 | Close day blocked unless online + fully synced, with outstanding-message warning? | Block. |
| SQ3 | SC3 reworded to "WhatsApp link launched for every child; staff confirm actual sending via runbook"? | Approve. |
| SQ4 | Acknowledge: (a) offline session expiry enforced against device clock; (b) local data at rest NOT encrypted — screen lock is deterrence, not encryption; (c) storage-eviction exposure window bounded by immediate sync. | Acknowledge. |

Carried forward: **Q1–Q12** from v1.0 §27 (school name, accounts/phone, fallback plan, warn-vs-block, thresholds, performance targets, privacy wording, KPIs, analytics, FR-20 elevation, parent notification, target devices).

---

## 4. Change log — v1.0 → v1.1

| # | Location | v1.0 | v1.1 | Driver |
|---|---|---|---|---|
| 1 | §1.1/§1.2 | Version 1.0 | Version 1.1, technical-correction marker added | — |
| 2 | §2, §6 | SC3 "every parent receives" | Reworded to verifiable proxy; business goal retained | T-H2 / SQ3 |
| 3 | FR-03 | "one device" undefined | Per-browser identifier defined + reset limitation | T-M1 |
| 4 | FR-04 | Single cookie, infeasible offline claims | Two-layer session: cookie + signed local descriptor; limitations stated | T-C2 / SQ4 |
| 5 | FR-06 | Nigeria-only normalisation implied | Explicit objective normalisation rule incl. non-`+234` | T-M2 |
| 6 | FR-08 | Local save assumed to succeed | Durable-write confirmation before success; blocking failure state | T-H3 |
| 7 | FR-09 | "sync as part of action" (second path) | Single write-ahead path for all actions | T-M8 |
| 8 | FR-11 | One `device_event_at` for the record | Per-event device + receipt times; projection model; events immutable | T-C1 |
| 9 | FR-12 | Invalid skew comparison implied | Probe + queued-duration + consistency rules + honesty statement | T-C3 |
| 10 | FR-13 | "client-generated ID" undefined | Full event identity, idempotent ack, per-device ordering, out-of-order handling | T-C1 |
| 11 | FR-15 | Window without tolerance/reaction | Future tolerance, Lagos day, visible "failed — needs review" | T-M4/T-M3 |
| 12 | FR-16 | "stored and flagged" with no store | Event-log evidence, resolution via audited correction | T-H1 |
| 13 | FR-20 | Send control home | Outstanding-messages scope across days stated | T-H2 |
| 14 | FR-24 | "opens / cannot be opened" detection | Navigation-initiated semantics; always-available Copy control | T-H2/T-M5 |
| 15 | FR-26 | Pending state local-centric | Server-held outstanding state; survives day close | T-C4 |
| 16 | FR-27 | Marker on "successfully opened" | Marker on link launch; wording "WhatsApp opened"; no send/delivery claim | T-H2/T-L2 |
| 17 | FR-30 | Simple edit only | Base-version conflict handling; offline queue option (SQ1) | T-H4 |
| 18 | FR-31/FR-34 | Scope unstated offline | Offline scope stated | T-M6 |
| 19 | FR-35 | Purge "after sync" | Gated close-day: online, empty outbox, warning, blocked states | T-C4 / SQ2 |
| 20 | §11 | Two screens + edit | Added session-expired and close-day states | T-C2/T-C4 |
| 21 | §13 ACs | G1/G4/G5/G8/G10 as v1.0 | Descriptor gate, idempotent ack, valid clock test, launch wording, close-day gating | T-C2/C3/H2/C4 |
| 22 | §14.5/§14.7 | Correction & end-of-day flows | Base-version step; close-day preconditions | T-H4/T-C4 |
| 23 | §15 BRs | BR-01, BR-05, BR-17 | Session-attribution note; per-event BR-05; BR-20..22 added (event model, close gating, verifiable-claims principle) | T-C1/H5/C4/H2 |
| 24 | §16 | Flat column table | Three-part conceptual model (event log / session projection / audit) + local store durability rules + Lagos day key | T-C1/T-H3/T-M3 |
| 25 | §17 N4/N5 | Opened semantics | Launched semantics; copy fallback always | T-H2 |
| 26 | §18 S10/S11 | Screen lock implied protection; cookie-only | Honest at-rest statement (no encryption); descriptor contents + S14 offline-session limitation | T-C2/SQ4 |
| 27 | §20 | — | U-A10: never display unverifiable states as facts | T-H2 |
| 28 | §21 E5/E12/E15/E16 | v1.0 wordings | Probe-based E5; launch wording E12; rejected-event handling E15; durable-save E16; E21–E23 added (eviction, close-blocked, late sync) | T-C3/H2/M4/H3/C4/M3 |
| 29 | §24/§25 | A6, C4, C5 | Storage eviction assumption A13; C4 skew honesty; C5 launch-only claim; C12 offline session clock limit | T-C2/C3/H3 |
| 30 | §26 | 14 risks | RK15 storage loss, RK16 clock rollback, RK17 late sync added | T-H3/C2/M3 |
| 31 | §27 | Q1–Q12 | Q13–Q16 added (SQ1–SQ4) | — |
| 32 | §28/§30 | MVP + acceptance | Close-day gating + durability + launch wording incorporated | T-C4/H3/H2 |

**Requirement removals: none.** See §5.

---

## 5. Requirements traceability — v1.0 → v1.1

**No v1.0 requirement ID was removed, merged away, or downgraded in priority except where explicitly stated.**

| ID group | v1.0 count | v1.1 count | Removed | Status of changes |
|---|---|---|---|---|
| FR-01 … FR-35 | 35 | 35 | 0 | Unchanged: FR-01, 02, 05, 07, 10, 14, 17, 18, 19, 20 (scope note), 21, 22, 23, 25, 28, 29, 31 (scope note), 32, 33. Refined (behaviour clarified, requirement retained): FR-03, 04, 06, 08, 09, 11, 12, 13, 15, 16, 24, 26, 27, 30, 34, 35. Priorities unchanged (FR-20 elevation still pending Q10). |
| U1 … U16 | 16 | 16 | 0 | U1–U8 source stories intact; U9–U16 offline stories intact; U10 wording qualified to defined failure set. |
| BR-01 … BR-19 | 19 | 19 + 3 | 0 | BR-01, BR-05, BR-17 refined; BR-20 (event model), BR-21 (close-day gating), BR-22 (no unverifiable claims) added. |
| SC1 … SC5 | 5 | 5 | 0 | SC3 reworded (SQ3 pending); SC2 aligned with projection/event split; SC4 qualified. |
| S1 … S13 | 13 | 13 + 1 | 0 | S10, S11 refined (honesty/descriptor); S14 added (offline session limitation). |
| N1 … N5 | 5 | 5 | 0 | N4/N5 aligned with launch semantics. |
| P1 … P7 | 7 | 7 | 0 | Unchanged. |
| U-A1 … U-A9 | 9 | 9 + 1 | 0 | U-A10 added. |
| E1 … E20 | 20 | 20 + 3 | 0 | E5, E12, E15, E16 refined; E21–E23 added. |
| R1 … R5 | 5 | 5 | 0 | Unchanged. |
| A1 … A12 | 12 | 12 + 1 | 0 | A13 added (storage durability). |
| C1 … C10 | 10 | 10 + 2 | 0 | C4, C5 refined; C11 (launch-only verification), C12 (client-side session expiry) added. |
| RK1 … RK14 | 14 | 14 + 3 | 0 | RK15–RK17 added. |
| Q1 … Q12 | 12 | 12 + 4 | 0 | Q13–Q16 (=SQ1–SQ4) added. |
| User stories AC groups AC-G1…G10 | 10 | 10 | 0 | G1, G4, G5, G8, G10 refined. |

---

## 6. Unresolved technical decisions to settle before architecture approval

| # | Decision | Options | Recommendation |
|---|---|---|---|
| AD-1 | Session descriptor signature scheme | Asymmetric (public key in app, verifiable offline) vs HMAC (requires secret in browser — rejected) | Asymmetric (EdDSA/ES256) |
| AD-2 | Sync protocol details | Push-on-reconnect vs periodic vs on-focus; ack semantics; backoff schedule | All three triggers; idempotent ack of original result; exponential backoff |
| AD-3 | Skew probe schedule and thresholds | Probe at open/foreground/sync; skew threshold (Q5); future tolerance | Open + foreground + sync; 5 min threshold pending Q5 |
| AD-4 | Conflict resolution UX | What the lead teacher actually does with a flagged conflict (accept A, accept B, correct) | Accept A / accept B via audited correction |
| AD-5 | Offline corrections on/off | SQ1 outcome determines event types and version-check design | Offline with base-version check |
| AD-6 | Local write verification method | Transaction completion confirmation vs read-back verify | Transaction completion + read-back for outbox |
| AD-7 | Late-sync policy for closed days | Flag-and-attach vs reopen-day | Flag-and-attach, visible in that day's review |
| AD-8 | Device identifier for rate limiting | Local random ID vs cookie-based | Local random ID + documented reset |
| AD-9 | Outstanding-message source of truth | Server-only vs server + local mirror | Server-held, local mirror cacheable |
| AD-10 | Day-close interaction | Block vs warn-and-force | Block (pending SQ2) |

*— End of audit report —*
