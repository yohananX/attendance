# PRD v1.1 Revision Verification and Build-Readiness Report

| | |
|---|---|
| **Document** | Independent verification of `PRD_v1.1.md` against `PRD_AUDIT_v1.1.md` findings |
| **Reviewer role** | Senior Software Architect / Technical QA (independent of the audit author) |
| **Date** | 30 October 2026 |
| **Inputs verified** | `PRD.md` (v1.0), `PRD_v1.1.md`, `PRD_AUDIT_v1.1.md` — all read in full; claims spot-checked against exact wording |
| **Method** | Every audit claim re-derived from the PRD v1.1 text. A finding counts as resolved only if a developer can implement it and a tester can verify it from the wording alone. |

---

## 1. Executive verdict

**APPROVED WITH CONDITIONS.**

PRD v1.1 genuinely resolves all four critical findings and all five high-priority findings. The event model (T-C1), offline session (T-C2), day-close safety (T-C4), conflict evidence (T-H1), durability-before-success (T-H3) and WhatsApp claim-narrowing (T-H2) are now technically coherent and implementable. This is a real revision, not a cosmetic one; the audit's change log is substantially accurate.

However, three defects prevent unconditional approval, and two are the exact class of problem this revision was meant to eliminate:

1. **PRD v1.1 §18 S10 and S14 state that the stakeholder has "explicitly accepted" residual risks (SQ4) — while Q16 (SQ4) is still listed as a pending stakeholder decision in §27.1.** This is an invented approval and must be corrected.
2. **AC-12.2 and AC-G5 require a consistency flag when the device clock is "far ahead/behind receipt", but FR-12(c)'s rule only fires for time *ahead* of receipt.** A 2-hour-*slow* clock is mathematically indistinguishable from a 2-hour offline queue; as written, the acceptance criterion contradicts the requirement it tests and cannot be passed by a correct implementation.
3. FR-15's acceptance window contains an undefined term — the "permitted late window" — with no value anywhere in the document or in Q5.

None of these require re-architecture; all are small, exactable text corrections (§7). The document is ready for architecture to begin **in parallel with** these corrections; stakeholder answers to Q13–Q16 are required before the corresponding features are implemented, not before architecture starts.

**Schedule warning (independent of PRD quality):** the delivery target is **tomorrow, Saturday 31 October 2026**, and no application code exists. The honest build estimate for the never-cut MVP core is 7–10 focused engineer-days (§8). A production release by 31 October is not achievable by any responsible plan. The fastest responsible route is a paper-backed session on 31 October followed by a **controlled pilot on 7 November** and production readiness after 2–3 supervised sessions (§8). The PRD's own RK5/K7b "schedule risk accepted" framing assumed a build that had already started; with zero code on 30 October, the cut order cannot rescue the date — the entire MVP is the cut.

---

## 2. Critical findings verification

| ID | Verdict | Evidence in PRD v1.1 (exact sections) | Residual issue / exact correction required |
|---|---|---|---|
| **T-C1** Attendance event model | **RESOLVED** | FR-11 (§10.2): "Sign-in and sign-out are separate events. Each carries its own `device_event_at` … and its own `server_received_at`"; session is explicitly a **projection**. FR-13: client UUID at capture-before-persistence, idempotent ack returning the original result, per-device sequence ordering. FR-16: losing event "retained permanently in the event log marked *conflicting*". §16.1 Parts 1–3: append-only event log (ID, type `sign_in\|sign_out\|correction`, session reference, device time, receipt time, offline flag, device ID + sequence, staff name, conflict marker) / mutable session projection / audit stores (corrections incl. base value, conflicts incl. both events + winner, login attempts). BR-05, BR-06, BR-20. AC-11.1–11.4, AC-16.1–16.3, E6, E18. Corrections alter only displayed times; "stored events remain byte-identical" (AC-11.4). | Minor, non-blocking: (a) the generation of the **session reference** (client UUID at first sign-in vs server-assigned) is unstated — architect decides at AD-stage (client-generated is the only offline-capable option); (b) a second sign-in after an *accepted sign-out* must create a **new session**, not a conflict — inferable from FR-18/FR-23 but should be stated in one clause in FR-16; (c) audit §5 lists FR-18 as "Unchanged" although v1.1 extends it (later sign-outs become conflicts) — audit table nit. |
| **T-C2** Offline authentication | **RESOLVED** | FR-04 (§10.1): two-layer session — HTTP-only cookie for every server call; local **signed descriptor** (name, issued-at, expiry only) signed server-side with the private key, verified with a **public key shipped in the app** (not a secret — no server secret reaches the browser). No PIN/verifier anywhere (AC-04.3). Expiry at open + foreground; expired descriptor → session-expired screen, no data rendered (AC-04.2, §11.1, §11.8, E13). Browser closure covered (AC-04.5). Server-side limitation explicit: descriptor without cookie is rejected by all APIs (AC-04.4, S11). Device-clock-rollback limitation explicit (AC-04.5 known-limitation note, S14, C12, RK16). | Minor, non-blocking: the audit's "a copied descriptor unlocks the local UI on another device" scenario is not restated in v1.1; it is covered implicitly by S10/RK11 (unencrypted at-rest exposure) but should be one added sentence in S11. **S14's "Accepted trade-off (SQ4)" must be corrected — see §7, Blocking-1.** |
| **T-C3** Device clock accuracy | **PARTIALLY RESOLVED** | FR-12 (§10.2) is correct and specific: (a) online round-trip probe, ±½ RTT, recorded with measurement time; (b) `server_received_at − device_event_at` recorded as **queue duration, explicitly NOT skew**; (c) consistency rules: sign-out < sign-in, device time > tolerance **ahead** of receipt, device time outside Lagos day, per-device sequence regression. Verifiability statement: "the true wall-clock accuracy of an offline-captured event **cannot be verified**". AC-12.3 (queue time never mislabelled), AC-12.4, BR-22, C4, U-A10, E5, §16.4. The invalid v1.0 computation is explicitly prohibited. Offset vs queue duration is clearly distinguished. | **Correction required (§7, Blocking-2):** AC-12.2 requires a flag for a clock set 2 hours wrong via a rule described as "(device time far ahead/**behind** receipt)" and AC-G5 repeats "(device time vs receipt beyond tolerance)". FR-12(c) only flags time *ahead* of receipt. A 2-hour-*slow* clock produces a receipt difference identical to a 2-hour queue and **no listed consistency rule fires** — the acceptance criterion is unpassable as written and reintroduces the invalid computation. Fix: AC-12.2 → flag raised "by the ahead-of-receipt consistency rule (fast clock); a slow clock is detected by the post-reconnect probe offset estimate". AC-G5 → same wording. |
| **T-C4** Day closure and purge | **RESOLVED** | FR-35 (§10.6): close is an online operation with enforced preconditions — (1) online; (2) local outbox empty, every event server-acknowledged; (3) outstanding-message count displayed with explicit confirmation; only acknowledged data purged; "unsynchronised events are never purged"; offline or non-empty outbox → blocked; "No 'purge anyway' option exists". AC-35.1–35.5 (incl. AC-35.4: purge of an unsynced event is impossible by test). BR-17, BR-21, E22, §11.8 close-day dialog, §14.7 step 4, AC-G10, §30.11. Outstanding WhatsApp actions are safe: launch state is **server-held** and reconstructable after close (FR-26 AC-26.4, AC-35.5). | None material. The pending SQ2 (Q14) is correctly marked on FR-35 and §27.1 — "block" is the specced default, and building block-first is reversible. |

---

## 3. High, medium and low findings verification

### 3.1 High priority

| ID | Verdict | Evidence (PRD v1.1) | Residual |
|---|---|---|---|
| **T-H1** Conflicting sign-outs / correction conflicts | **RESOLVED** | FR-16: first-*synchronised*-wins defined; losing event permanently retained, session flagged, resolution "via the audited correction (FR-30), which references the conflicting event"; AC-16.1–16.3. §16.1 Part 3: conflicts store holds both events, winner, resolution, resolver. FR-30 base-value check: mismatch → "flagged for review rather than silently applied, and both values retained"; AC-30.5. §14.5, §11.5. | Conflict-resolution UX detail remains open as AD-4 — appropriately so; the requirement is implementable without it. |
| **T-H2** WhatsApp status wording | **RESOLVED** | FR-24: "initiates navigation"; browser verifies only navigation; Copy control always available (AC-24.3). FR-27: launch-only marker, field `whatsapp_launched_at`, UI wording "WhatsApp opened", AC-27.3: "No screen or export anywhere claims 'sent' or 'delivered'". SC3 reworded to verifiable terms and **correctly marked pending Q15** — not presented as approved. BR-13, C5, C11, N3–N5, U-A10, FR-33 ("never 'sent'"), AC-G8, §30.9. Verified: no stale "Message opened"/`message_opened_at` references remain except the documented rename note (§16.1). | Minor wording: N3/FR-26 say launch is "impossible" offline — technically a `wa.me` link can open WhatsApp offline (WhatsApp queues the message). The rule is a defensible product choice (marker needs server confirmation); reword "cannot be launched offline" → "is not permitted offline" to avoid a false factual claim (BR-22). |
| **T-H3** Durable local write before success | **RESOLVED** | FR-08: write-ahead for every action; success UI "only after the local transaction is confirmed durable"; storage failure → blocking error with paper instruction; persistent-storage requested; quota monitored. BR-21, SC6, E16, E21, A13, RK15, AC-08.2/08.3, AC-G3, §30.3. U10/U12 and SC4 honestly qualified to the defined failure set. | Minor: "AC-G3b" is referenced three times (SC6, AC-G3, §30.3) but never defined as a standalone criterion; the testable clause exists inline in AC-G3. Either define AC-G3b or drop the ID. |
| **T-H4** Offline correction conflicts | **RESOLVED (mechanism)** | FR-30 conflict-safe base-value semantics + AC-30.5 + audit-store base value (§16.1 Part 3) + §11.5/§14.5 queue-with-base-value flow. Both retained, neither silently wins. | Offline-vs-online-only capture remains pending Q13/AD-5 — correctly flagged on FR-30 and §27.1, not silently decided. |
| **T-H5** Attribution on device handover | **RESOLVED** | §8 limitation 2: "Offline actions are attributed to the name of the **active session**, not provably to the person holding the phone"; BR-01 extended; S7; runbook rule §14.7 step 7 (re-login on handover); U16 qualified. | None. |

### 3.2 Medium priority

| ID | Verdict | Evidence (PRD v1.1) | Residual |
|---|---|---|---|
| **T-M1** Rate-limit device identity | **RESOLVED** | FR-03: per-browser local identifier; reset-on-storage-clear limitation stated; no IP counting; AC-03.4; BR-03; S4. | AD-8 (ID scheme) open — architect-level, both options implementable. |
| **T-M2** Phone normalisation | **RESOLVED** | FR-06: objective rule (strip formatting; leading `0` → `+234`; other `+` with 7–15 digits as-is; else reject); BR-10; AC-06.2/06.3 incl. non-Nigerian example. | None. |
| **T-M3** Day boundary / late sync | **PARTIALLY RESOLVED** | §16.4: day key = Lagos calendar date of `device_event_at`; late-synced events attach to original day, flagged, never dropped or re-dated; E23; §16.1 projection flag "late-synced"; FR-20/FR-26 outstanding state spans days. | **Correction required (§7, Blocking-3):** FR-15's window is "Lagos operational day **± permitted late window**" — the window's length is defined nowhere, and Q5 (§27.2) covers only the 5-minute ahead-tolerance. An event synced 3 days later is either accepted-late (E23) or rejected-to-review (FR-15) depending on a number that does not exist. Fix: add "permitted late-sync window (proposed: 7 days)" to Q5 and reference it from FR-15, BR-11 and S12. |
| **T-M4** FR-15 tolerance and rejection reaction | **RESOLVED** | FR-15: future tolerance (5 min, pending Q5); rejection → visible "Failed — needs review" with reason; AC-15.2/15.4 ("No rejected event disappears"); E15; §11.3 dedicated state row; BR-11. | Threshold value pending Q5 — correctly flagged. |
| **T-M5** WhatsApp-missing detection | **RESOLVED** | Folded into FR-24: Copy control always visible, no detection relied upon; E11; N5; AC-24.3. | None. |
| **T-M6** Offline scope of day review / bulk sign-out | **RESOLVED** | FR-31: "Offline, this view covers the local device's … data only" + AC-31.3 incompleteness banner. FR-34: "Offline, this applies only to sessions present on that device" + AC-34.4. | None. |
| **T-M7** Correction after message sent | **RESOLVED** | E19: row flagged "corrected after message"; corrected time shown on re-open; staff decides on re-send. | None. |
| **T-M8** Divergent online/offline paths | **RESOLVED** | FR-09: "One write-ahead path for all actions … No separate online-only path exists"; AC-09.3 (same code path observably); §14.1. | None. |

### 3.3 Low priority

| ID | Verdict | Evidence (PRD v1.1) | Residual |
|---|---|---|---|
| **T-L1** FR-20 elevation | **RESOLVED (as openly tracked)** | FR-20 and §27.2 Q10 both mark the elevation as pending confirmation; not presented as decided. | See X-5 (§4): a related, previously unnoticed FR-27 priority contradiction. |
| **T-L2** `message_opened_at` overstated name | **RESOLVED** | Field renamed `whatsapp_launched_at` (FR-27, §16.1 Part 2). Grep-verified: no stale runtime references. | None. |
| **T-L3** Unconfirmed thresholds | **RESOLVED (as openly tracked)** | Q5/Q6/Q8 retained in §27.2; 5-minute values consistently marked "(Q5)". | None. |
| **T-L4** "Shows corrected" display rule | **RESOLVED** | FR-30 AC-30.3 "icon + text"; FR-32 icon + text + type; U-A4. | None. |
| **T-L5** Conflated schema table | **RESOLVED** | §16.1 replaced by the three-part conceptual model (event log / session projection / audit stores); no SQL, as scoped. | None. |

---

## 4. Cross-document consistency findings

Verified: all v1.0 requirement IDs survive into v1.1 with the same or explicitly-explained meanings (FR-01…35, U1…16, BR-01…19→22, SC1…5→6, S1…13→14, N1…5, P1…7→8, U-A1…9→10, E1…20→23, R1…5, A1…12→13, C1…10→13, RK1…14→17, Q1…12→16). Functional requirements, business rules, security requirements, user stories, error cases and acceptance criteria are mutually consistent in nearly all places checked. Every new v1.1 requirement carries an in-document provenance marker *(technical fix v1.1)*. Pending decisions are marked inline (FR-04 "pending SQ4", FR-30 "pending SQ1", FR-35 "pending SQ2", SC3 "pending SQ3"). No priority was silently changed. The following defects were found:

| # | Finding | Location | Severity | Exact correction |
|---|---|---|---|---|
| **X-1** | **Invented stakeholder approval.** S10 states "Residual risk **explicitly accepted by stakeholder** (K7a, SQ4)" and S14 "Accepted trade-off (SQ4)" — while Q16/SQ4 is a *pending* stakeholder decision (§27.1, document header, FR-04's own "pending SQ4" marker). K7a approved purge/screen-lock measures, not the unencrypted-at-rest or device-clock trade-offs. E21/A13/RK15's "acknowledged (SQ4)" wording is ambiguous in the same direction. | PRD v1.1 §18 S10, S14 (also soften E21, A13, RK15) | **BLOCKING** | S10: replace "Residual risk explicitly accepted by stakeholder (K7a, SQ4)" with "Residual risk acceptance requested — **pending Q16**; K7a approved the mitigations only." S14: replace "Accepted trade-off (SQ4)" with "Proposed trade-off — **pending Q16**." |
| **X-2** | **AC contradicts its own requirement (slow clock).** AC-12.2 ("device time far ahead/**behind** receipt") and AC-G5 ("device time vs receipt beyond tolerance") require flagging behaviour FR-12(c) does not define and cannot define (a slow clock ≡ queue time). A correct implementation fails the test; an incorrect one passes it. | PRD v1.1 §13 AC-G5, FR-12 AC-12.2 | **BLOCKING** | As specified in §2, T-C3: fast clock → ahead-of-receipt rule; slow clock → detected by the post-reconnect **probe** offset estimate. Amend both ACs. |
| **X-3** | **Undefined acceptance-window term.** FR-15's "permitted late window" has no value anywhere; Q5 omits it; E23 and FR-15 can contradict each other depending on the missing number. | PRD v1.1 FR-15, §16.4, Q5 | **BLOCKING for sign-off** (architect may set a default, which must then be recorded) | Add the late-window length to Q5 and reference it in FR-15, BR-11, S12. |
| **X-4** | **Audit traceability table undercounts v1.1 additions.** Audit §5 records SC1…SC5 as 5→5, but v1.1 adds **SC6**; it has no row for **O8** or **P8**; it records C as "10 + 2" but v1.1 adds **C13** (10 + 3). Change log §4 row 21 omits the AC-G3 (durability) and AC-G6 (conflict-evidence) refinements. The PRD markers are correct; the audit's "zero unaccounted additions" table is not. | PRD_AUDIT §5, §4 | Medium | Correct the audit tables: SC 5→6 (SC6), add O 7→8 (O8), P 7→8 (P8), C 10→13, and add AC-G3/AC-G6 to the change log. |
| **X-5** | **FR-27 priority contradiction (carried over from v1.0, now material).** §28 lists FR-27 in "MVP includes" yet FR-27 is priority **S** and also listed under "Should Have (if time allows)". Material because FR-26 (priority **M**) requires launch state to be persisted — which is FR-27's marker. Without FR-27 the pending-message list (SC3's checklist) can never empty. | PRD v1.1 §10.4 FR-26/FR-27, §28 | Medium | Reclassify **FR-27 as M** (it is functionally required by FR-26/SC3), or remove it from the MVP-includes list and accept SC3 is unmeasurable. Recommend the former; it is a two-line change and does not need a stakeholder meeting if noted as an audit-driven correction (T-H2 depends on it). |
| **X-6** | **Approval-status wording.** v1.1 header calls the document "Approved working baseline" although v1.0 was "Draft for stakeholder approval" and Q13–Q16 are unsigned. The audit's own premise is that v1.0 was the approved baseline; the two documents disagree about what has been approved. | PRD v1.1 header vs PRD v1.0 §1 header; audit §"Input" | Low | Change status to "Revised draft for stakeholder sign-off (v1.0 technical baseline preserved)". Do not claim approval that has not occurred. |
| **X-7** | Minor wording drift: S12 says "Lagos-day/**±5-min** window" while FR-15 defines only a *future* tolerance ("not more than 5 minutes ahead"); "±" implies a backwards tolerance that does not exist. FR-18's double-tap wording ("later ones become conflicts") sits next to E7 ("no-op") — harmless because the client guard prevents event creation, but state it. FR-18/FR-20/FR-33 are listed as "Unchanged" in audit §5 although their text was extended. N3/FR-26 claim launch is "impossible" offline (see §3.1 T-H2). "AC-G3b" referenced but undefined (see T-H3). | §18 S12; FR-18; audit §5; N3 | Low | One-line wording fixes; none affects architecture. |

**Unresolved decisions are explicitly identified:** yes — Q13–Q16 (§27.1), AD-1–AD-10 (audit §6, referenced by §27.3), and carried-forward Q1–Q12 (§27.2), with inline pending markers on the affected requirements. Apart from X-1, no recommendation is presented as an approved decision.

---

## 5. Decision register — Q13–Q16 and AD-1–AD-10

| ID | Decision required | Recommended answer | If unresolved |
|---|---|---|---|
| **Q13 (SQ1)** | Corrections captured offline or online-only? | **Product decision.** Recommend: online-only corrections for the first pilot (corrections occur at day end when connectivity is normally available and close-day requires online anyway); offline queued corrections as the first post-pilot change. This is the one place where the audit's "offline supported" recommendation can be responsibly out-voted by the deadline. | FR-30 queue design and event-type set stay open; correction flow cannot start. Architect can build either — not a blocker for architecture start, a blocker for implementing FR-30. |
| **Q14 (SQ2)** | Close day blocked unless online + fully synced + warning? | **Product decision.** Recommend **Block** (already the specced default; building block-first is trivially relaxable later). | FR-35 implementation direction ambiguous; default is safe. |
| **Q15 (SQ3)** | SC3 reworded to "link launched + runbook send-confirmation"? | **Product decision.** Recommend **Approve** — the old wording promises what no browser can verify. | SC3/§6 measurement stays self-contradictory; already correctly marked pending. |
| **Q16 (SQ4)** | Acknowledge: device-clock-enforced offline expiry; unencrypted local data; storage-eviction window. | **Product decision.** Recommend **Acknowledge** (the mitigations are honest and residual risk is bounded) — but the PRD must first stop claiming it was already accepted (X-1). | S10/S14 remain false statements; architecture sign-off blocked by the text defect regardless of the answer. |
| **AD-1** | Descriptor signature scheme. | **Architect.** Asymmetric — Ed25519 (EdDSA); public key bundled in app; short descriptor (name, iat, exp, key-id). No HMAC (secret in browser — correctly rejected). | Offline login mechanism undefined. |
| **AD-2** | Sync protocol: triggers, ack semantics, backoff. | **Architect.** Push on capture + reconnect + open/foreground (A6/C9 make on-focus mandatory); idempotent ack returning the original result; exponential backoff with jitter; batch ≤ ~120 events. | Sync engine undefined; duplication risk returns. |
| **AD-3** | Probe schedule and thresholds. | **Architect** (value pending Q5, default 5 min). Probe at open, foreground, and at sync; store estimate + measurement time + RTT. | FR-12 partially unimplementable. |
| **AD-4** | Conflict-resolution UX. | **Architect.** Flagged row → "keep first recorded time / use later event's time" — both via the audited correction referencing the conflict. | Lead teacher has no defined action on flagged rows; not blocking to start. |
| **AD-5** | Offline corrections on/off. | **Blocked by Q13** (recommend online-only for pilot, per Q13). | Event-type set and version-check design open. |
| **AD-6** | Local write-verification method. | **Architect.** IndexedDB transaction completion + read-back verify for outbox writes (the outbox is the only copy; belt-and-braces justified). | FR-08 durability guarantee unverifiable. |
| **AD-7** | Late-sync policy for closed days. | **Architect.** Flag-and-attach to original day (matches §16.4/E23); default late window 7 days pending Q5 addition (X-3). | E23/FR-15 contradiction persists. |
| **AD-8** | Rate-limit device identifier. | **Architect.** Local random UUID in persistent storage; reset limitation already documented in FR-03. | FR-03 underspecified (minor). |
| **AD-9** | Outstanding-message source of truth. | **Architect.** Server-held with local cache — already assumed by FR-26/AC-26.4; confirm explicitly. | FR-26/FR-35 interplay ambiguous (minor — wording already implies the answer). |
| **AD-10** | Day-close interaction. | **Blocked by Q14** (default: block). | FR-35 build direction open (default safe). |

**Separation:** Q13–Q16 are product/stakeholder decisions and must not be settled by the architect. AD-1, AD-2, AD-3, AD-4, AD-6, AD-7, AD-8, AD-9 are technical decisions the architect can responsibly make now. AD-5 and AD-10 are gated on Q13/Q14 but have safe defaults (online-only corrections; block). Deferrable until after MVP without compromising attendance integrity, security or recovery: AD-3 threshold calibration, AD-4 UX polish beyond accept-A/accept-B, AD-7 window length (use a 7-day default), offline corrections (Q13 alternative), sync telemetry (§29).

---

## 6. Section references

Every finding above cites its PRD v1.1 section inline (tables in §2, §3, §4). Key anchor sections: FR table §10.1–10.6; screens §11.1–11.8; acceptance criteria §13 AC-G1–G10; workflows §14.4–14.7; business rules §15 BR-01–BR-22; data model §16.1–16.5; security §18 S1–S14; performance §19; usability §20 U-A1–U-A10; error cases §21 E1–E23; assumptions §24 A1–A13; constraints §25 C1–C13; risks §26 RK1–RK17; open questions §27.1–27.3; MVP §28; acceptance §30. Audit references: `PRD_AUDIT_v1.1.md` §1 (findings), §4 (change log), §5 (traceability), §6 (AD-1–AD-10).

---

## 7. Blocking issues before architecture sign-off

All are exactable text corrections; none requires rewriting the PRD.

1. **X-1 (invented approval) — PRD v1.1 §18 S10, S14.** Replace "explicitly accepted by stakeholder (K7a, SQ4)" / "Accepted trade-off (SQ4)" with pending-Q16 wording; soften "acknowledged (SQ4)" in E21, A13, RK15. Alternatively: obtain the Q16 answer today and record it — but until then the PRD must not assert it.
2. **X-2 (unpassable AC) — §13 AC-12.2 and AC-G5.** Restrict the receipt-comparison rule to clocks *ahead* of receipt; attribute slow-clock detection to the post-reconnect probe estimate.
3. **X-3 (undefined window) — FR-15, §16.4, §27.2 Q5.** Define the permitted late-sync window (recommended default: 7 days) and reference it consistently in FR-15, BR-11, S12; also fix S12's "±5-min" to "≤5-min-ahead".
4. **Architect decisions at kickoff (not PRD text):** record AD-1, AD-2, AD-3, AD-4, AD-6, AD-8, AD-9 in the architecture document using the recommendations in §5.

Recommended but not blocking architecture start: X-4 (audit table corrections), X-5 (FR-27 → M), X-6 (status wording), X-7 (minor wording), T-C1 residual (session-reference generation, second-sign-in-after-sign-out clause), T-H3 residual (AC-G3b ID), T-C2 residual (copied-descriptor sentence in S11), N3 wording.

---

## 8. Compressed project execution plan

**Honest estimate (one experienced full-stack developer, real-phone testing included):** auth + two-layer session 0.5–1 d · durable event capture + lists 1–1.5 d · server ingest + idempotency + projection 1 d · sync engine 1–1.5 d · conflict/consistency flags 0.5–1 d · WhatsApp launch + pending queue 0.5 d · corrections + audit 0.5–1 d · gated close 0.5 d · hardening, device matrix, runbook drill 1–1.5 d. **Total: 7–10 focused days.** Target date is **tomorrow**. No plan compresses this responsibly into one day.

**Phase 0 — Saturday 31 October (session runs):** paper sheet as the primary record, exactly per §14.6/§14.7 (already an approved fallback, D4/K4). Do not ship an untested build to a live gate. If the stakeholder insists on software, at most a supervised *non-authoritative* online capture screen may be trialled — records re-entered and reconciled against paper — never as the system of record.

**Phase 1 — Controlled pilot, Saturday 7 November** (build window: 31 Oct – 6 Nov, ~5 working days + buffer). Strict scope, in the prompt's priority order:

1. **Essential attendance capture:** FR-05, FR-07 (no time input, ever).
2. **Durable offline storage:** FR-08 write-ahead + blocking failure state, FR-14, §16.2 durability rules (this is the never-cut core).
3. **Reliable sync + duplicate prevention:** FR-09/10/11/13 — event log with per-event dual timestamps, idempotent ack, ack-returns-original-result (§16.1 Part 1; AD-1/2/6).
4. **Multi-device conflict visibility:** FR-16 first-write-wins with preserved evidence, FR-32 flags (accept-A/accept-B resolution can be the simplest possible UI per AD-4).
5. **Auth/session:** FR-01–FR-04 two-layer session (AD-1: Ed25519 descriptor), FR-03 rate limiting.
6. **WhatsApp preparation:** FR-24/25/26/27 (launch + always-available Copy + server-held pending queue) — cheap and already fully specified.
7. **Day review, correction, closure:** minimal day review (FR-31 device-scoped with banner), online-only corrections if Q13 unresolved (FR-30 base-value check), **gated** close FR-35.
8. **Essential security/deployment:** S2/S3/S6 (service-role only, RLS no policies, HTTPS), S5/S7 runbook items, one AC-G1–G10 pass on two real phones including one full simulated-offline day (§30 drill, minus CSV).

Pilot acceptance: pass AC-G1–G10 (with X-2's corrected AC-G5), the §30 drill, and the runbook — with paper present as fallback throughout.

**Phase 2 — Production readiness, Saturday 14 or 21 November:** two further supervised sessions, PIN-change discipline verified, storage/quota behaviour observed on the actual staff phones, then full §30 sign-off.

**Deferrable without compromising attendance integrity, security or data recovery:** CSV export (FR-33, C), search (FR-21, S), name/phone edit window (FR-29, S), duplicate warning (FR-23, S), bulk sign-out (FR-34, C), offline-captured corrections (Q13 alternative), probe fine-tuning beyond the simple sync/open probe, KPI measurement (§6.2), accessibility polish beyond icon+text, late-window edge-case UX. **Never defer:** the entire capture/durable-store/sync/idempotency chain, per-event dual timestamps, conflict evidence preservation, gated close, PIN login + no-secrets-in-browser, "WhatsApp opened" wording discipline, Lagos display.

**Controlled pilot ≠ production release.** The 7 November build should be labelled a supervised pilot: single-day scope (D10), paper fallback on site, lead teacher reconciling the day-review list against reality before close. Production sign-off (full §30) targets 14–21 November. Delivering "by 31 October" is only honest as a paper-backed session; any claim that the offline-first MVP can be built, tested on real phones across two devices, and safely trusted with attendance proof by tomorrow is not supported by the estimate.

---

## 9. Final recommendation

**Proceed to architecture — approved with conditions.** The revision genuinely resolves the critical technical incoherencies; waiting for another full PRD round would waste the remaining week. Apply the three blocking text corrections (§7 items 1–3) before the architecture document is signed, record the architect-level AD decisions at kickoff, obtain Q13–Q16 answers before the affected features are implemented, and re-baseline the delivery promise: **paper-backed session 31 October, controlled pilot 7 November, production sign-off 14–21 November.**
