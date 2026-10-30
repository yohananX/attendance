# PRD Change Log — v1.1 → v1.2

| | |
|---|---|
| **Document** | Change log for surgical corrections applied to `PRD_v1.1.md` to produce `PRD_v1.2.md` |
| **Version** | 1.0 |
| **Date** | 30 October 2026 |
| **Author** | Lead Software Architect |
| **Driver** | `PRD_VERIFICATION_REPORT.md` (APPROVED WITH CONDITIONS) — §7 blocking items 1–3, §4 findings X-1…X-7, and stated T-C1/T-C2/T-H3/T-H2 residuals |
| **Scope rules observed** | No requirement removed. No requirement ID renumbered. No approved decision (D1–D10, K1–K7) altered. No stakeholder approval invented. No product requirement invented — every change is a correction of accuracy, priority consistency, wording, or a residual explicitly named by the verification report. |

---

## 1. Correction summary

| ID | Correction | Locations changed | Severity (per verification report) |
|---|---|---|---|
| **X-1** | Removed wording claiming SQ4 had already been accepted; residual-risk acceptance now stated as pending Q16 | §18 S10, §18 S14, §21 E21, §24 A13, §26 RK15 | Blocking |
| **X-2** | Clock-consistency corrections: fast clock flagged by the ahead-of-receipt rule; slow clock assessed only by the post-reconnect probe offset estimate; receipt-minus-device time never treated as proof of skew; true offline wall-clock accuracy stated as unverifiable | §10.2 FR-12 (behaviour + AC-12.2), §13 AC-G5, §21 E5, §30 item 6 | Blocking |
| **X-3** | Proposed **7-day** late-sync window added to Q5 for stakeholder confirmation and referenced consistently; S12's "±5-min" corrected to a maximum five-minute **future** tolerance | §27.2 Q5, FR-15 (+ new AC-15.5), BR-11, §18 S12, §16.4, §26 RK12 | Blocking for sign-off |
| **X-4** | Audit traceability counts and change-log omissions corrected (recorded here; `PRD_AUDIT_v1.1.md` tables are the defect and are not reproduced into v1.2) | §1.3 note; full corrected counts in §3 below | Medium |
| **X-5** | FR-27 priority **S → M**, reason recorded: FR-26 (M) persists the launch marker FR-27 sets; without FR-27 the pending-message list can never empty | §10.4 FR-27, §28 Should-Have list | Medium |
| **X-6** | PRD status changed to **"Revised draft for stakeholder sign-off"** — no approval claimed that has not occurred | Header (Status, Version), §30 end note | Low |
| **X-7** | Minor wording fixes: S12 "±5-min" (also RK12), FR-18 double-tap no-op stated explicitly, WhatsApp "cannot launch offline" → "not permitted by the application offline", AC-G3b defined, schedule wording re-baselined | FR-18, FR-26, §17 N3, §2, §13, C1, §28, priority legend | Low |
| **Residuals** | Verification-report residuals folded in: new-session clause (T-C1), session-reference generation (T-C1), copied-descriptor risk in S11 (T-C2), AC-G3b definition (T-H3), WhatsApp-offline wording (T-H2) | FR-16, §16.1, S11, §13, FR-26/N3/§2 | Medium/Low |

---

## 2. Detailed change log (v1.1 → v1.2)

Changes are listed in document order. "Before" quotes the v1.1 wording; "After" quotes or summarises the v1.2 wording.

### 2.1 Document control (X-6, X-4)

| Location | Before (v1.1) | After (v1.2) | Driver |
|---|---|---|---|
| Header — Version | "1.1 — technically corrected baseline (supersedes v1.0)" | "1.2 — surgically corrected baseline (supersedes v1.1; corrections X-1…X-7 per independent verification)" | X-6 |
| Header — Status | "Approved working baseline, technically corrected; pending stakeholder sign-off…" | **"Revised draft for stakeholder sign-off** (v1.0 technical baseline preserved); pending stakeholder sign-off on Q13–Q16; technical decisions AD-1…AD-10 recorded in `SYSTEM_ARCHITECTURE_v1.0.md`" | X-6 — v1.0 was only ever "Draft for stakeholder approval"; Q13–Q16 are unsigned, so no approval may be claimed |
| Header — Companion documents | Audit only | Adds `PRD_VERIFICATION_REPORT.md`, `PRD_CHANGELOG_v1.2.md`, `SYSTEM_ARCHITECTURE_v1.0.md` | Doc control |
| §1.1 version history | Rows 0.1, 1.0, 1.1 | New row 1.2 recording every correction family and "No requirement removed; no stakeholder decision taken." | Doc control |
| §1.2 reading conventions | Markers existing / approved / technical fix v1.1 / recommended | New marker **(correction v1.2)**: accuracy or implementation-level fix; changes no approved business requirement, removes no requirement, takes no stakeholder decision | X-6 |
| §1.3 intro | References audit §5 counts as authoritative | Adds X-4 correction note: audit §5 undercounts — SC 5→6, O 7→8, P 7→8, C 10→13; audit §4 row 21 omits AC-G3/AC-G6 refinements. PRD markers were already correct | X-4 |

### 2.2 Executive summary and schedule wording (X-7, X-2 wording)

| Location | Before | After | Driver |
|---|---|---|---|
| §2 last paragraph | "Delivery target is **Saturday 31 October 2026**…" | Schedule re-baselined: 31 Oct = paper-backed session, **no production release promised by 31 October**; controlled pilot **7 Nov 2026**; production sign-off 14–21 Nov (`PRD_VERIFICATION_REPORT.md` §8) | Strict rule: no production release promised by 31 Oct; verification §8 |
| §2 offline mandate | "WhatsApp messages that **cannot be launched** while offline remain visibly pending" | "…that **the application does not permit to be launched** while offline…" | X-7 / T-H2 residual — a `wa.me` link can technically open offline; the app's rule is a product choice, not a platform impossibility |

### 2.3 Functional requirements

| Location | Before | After | Driver |
|---|---|---|---|
| FR-12 behaviour (c) | Consistency rules list, then verifiability statement | Adds **Fast-vs-slow clocks** clarification: ahead-of-receipt rule detects only a *fast* clock; a *slow* clock is indistinguishable from queue time, is never flagged by any receipt-comparison rule, and is assessed only by the post-reconnect probe estimate; `server_received_at − device_event_at` never treated as proof of skew; true offline accuracy unverifiable | X-2 |
| FR-12 AC-12.2 | "…a consistency rule (device time far ahead/**behind** receipt) raises a visible flag…" — unpassable for a slow clock | Split into **Fast clock** (ahead-of-receipt rule flags; probe records matching positive offset) and **Slow clock** (no receipt-comparison rule fires; discrepancy evidenced by post-reconnect probe offset estimate); no claim of true offline accuracy | X-2 — the old AC contradicted FR-12(c) and reinstated the invalid T-C3 computation |
| FR-15 | "Lagos operational day **± permitted late window**" — term undefined anywhere | Window defined: Lagos operational day **+ permitted late-sync window (proposed 7 days, added to Q5 for stakeholder confirmation; not yet approved)**, plus not more than 5 minutes ahead of receipt (maximum future tolerance, no backwards tolerance); late events attach to original day flagged *late-synced*; **new AC-15.5** tests both sides of the window | X-3 |
| FR-16 | Ends "Both original events remain in the log." | Adds **New-session rule**: a second sign-in after an accepted sign-out starts a **new session** (new session reference) and is never a conflict; a cross-device sign-in while the child is still in school resolves first-synchronised-wins | T-C1 residual (verification §2) |
| FR-18 | "repeat taps are no-ops (client guard; server accepts one sign-out event per session — later ones become conflicts per FR-16)" — sits uneasily next to E7 "no-op" | Stated explicitly: the client guard prevents a second sign-out event **from ever being created**, so a double-tap produces neither event nor conflict (E7); only a genuinely captured other-device sign-out becomes a conflict | X-7 |
| FR-26 | "…including offline, when launching is **impossible**" | "…including offline, where **launching is not permitted by the application** (marker requires server confirmation; a `wa.me` link could technically open WhatsApp offline; the app does not offer it — BR-22)" | X-7 / T-H2 residual |
| FR-27 | Priority **S** (while listed inside "MVP includes") | Priority **M**; provenance line marks "priority S→M corrected v1.2, X-5"; expected-behaviour text records the reason: FR-26 (M) persists this marker, so without FR-27 the SC3 checklist can never empty | X-5 |

### 2.4 Acceptance criteria

| Location | Before | After | Driver |
|---|---|---|---|
| §13 AC-G5 | "device clock set 2 hours wrong … a consistency rule raises a visible discrepancy flag (device time vs receipt beyond tolerance)" | Two runs specified: **ahead** → ahead-of-receipt rule flags + probe records matching positive offset; **behind** → no receipt-comparison rule fires, discrepancy evidenced by post-reconnect probe estimate; queue duration never labelled skew; receipt-minus-device never used as proof; true offline accuracy never asserted | X-2 |
| §13 AC-G3b | Referenced three times (SC6, AC-G3, §30.3) but never defined | **Defined**: storage forced to fail → blocking error with paper instruction, no success/pending state, no outbox entry, child not listed; storage restored → same action succeeds normally (FR-08, FR-14, BR-21, SC6, E16) | T-H3 residual / X-7 |
| §30 item 6 | "visible flag raised via probe + consistency rules" | Fast clock → ahead-of-receipt rule; slow clock → post-reconnect probe offset estimate; queue time never mislabelled; true offline accuracy never claimed | X-2 |

### 2.5 Business rules, data model, security, risks, questions

| Location | Before | After | Driver |
|---|---|---|---|
| BR-11 | "within the acceptance window (Lagos day, ≤5 min ahead — Q5)" | "within the acceptance window — **Lagos day plus the permitted late-sync window (proposed 7 days, pending confirmation in Q5)** and device time not more than 5 minutes ahead of server receipt (Q5)" | X-3 |
| §16.1 Part 1 (note) | Session-reference generation unstated | **Session reference = client-generated UUID at first sign-in capture, before persistence** (the only offline-capable option); server accepts and never renumbers; shared by later events; new sign-in after accepted sign-out = new reference; event ID ≠ session reference | T-C1 residual (verification §2) |
| §16.4 | Late sync attaches to original day; no window length | Adds window bullet: within the proposed 7-day window → accepted, flagged *late-synced*; beyond → FR-15 review state, never silently dropped (AC-15.5) | X-3 |
| §17 N3 | "Messages **cannot be launched offline**" | "Messages are **not permitted to be launched offline by the application** (marker needs server confirmation; a `wa.me` link could technically open WhatsApp offline — the app does not offer it)" | X-7 / T-H2 residual |
| §18 S10 | "Residual risk **explicitly accepted by stakeholder** (K7a, SQ4)." | "**Residual-risk acceptance is requested — pending Q16**; K7a approved the mitigations only (screen lock, day-close purge, minimal local data), not the unencrypted-at-rest exposure." | **X-1** — Q16 is unsigned; K7a approved mitigations, not exposure |
| §18 S11 | Descriptor described; copied-descriptor scenario absent | Adds **copied-descriptor risk**: descriptor is not device-bound, so a copy unlocks the offline UI on another device (no data, cannot pass server APIs); treated as part of the S10 exposure surface; **pending Q16** | T-C2 residual (verification §2) |
| §18 S12 | "Lagos-day/**±5-min** window" | "Lagos day + permitted late-sync window (proposed 7 days, pending Q5) with a **maximum five-minute future tolerance** — not more than 5 minutes ahead of server receipt, **no backwards tolerance**" | X-3 + X-7 — "±" implied a backwards tolerance that does not exist |
| §18 S14 | "**Accepted trade-off (SQ4).**" | "**Proposed trade-off — pending Q16.**" | **X-1** |
| §21 E5 | "Detected via probe + consistency rules" | Fast clock: ahead-of-receipt rule. Slow clock: post-reconnect probe offset estimate only (no receipt-comparison rule can fire) | X-2 |
| §21 E21 | "**acknowledged** residual risk … (SQ4)" | "residual risk **stated for acknowledgement — pending Q16 (SQ4)**" | **X-1** |
| §24 A13 | "residual risk of eviction/deliberate clearing **acknowledged** (E21, SQ4)" | "…**stated for acknowledgement — pending Q16** (E21, SQ4)" | **X-1** |
| §26 RK12 | "Lagos-day/**±5-min** window" | "Lagos day + permitted late-sync window (proposed 7 days, Q5) and ≤5-min-ahead tolerance" | X-3 + X-7 |
| §26 RK15 | "residual risk **acknowledged** (SQ4, E21)" | "residual risk **pending acknowledgement (Q16/SQ4; E21)**" | **X-1** |
| §27.2 Q5 | Clock threshold + "≤5 min ahead" only | Adds **permitted late-sync window (proposed 7 days — added here in v1.2, X-3, for stakeholder confirmation; not yet approved)**; future tolerance restated as not-more-than-5-minutes-ahead | X-3 |
| §27.3 | Points only to audit §6 | Adds: AD-1…AD-10 recorded in `SYSTEM_ARCHITECTURE_v1.0.md` §8; **AD-5 and AD-10 gated on Q13/Q14 — product decisions, not technical ones** | Doc control |

### 2.6 Scope, constraints and status wording (X-5, X-6, X-7)

| Location | Before | After | Driver |
|---|---|---|---|
| Priority legend (§10) | "M = Must Have (31 Oct 2026)" | "M = Must Have (controlled pilot, 7 Nov 2026)" | X-7 schedule honesty |
| §25 C1 | "**Deadline: Saturday 31 October 2026.**" | Schedule re-baselined: 31 Oct = paper-backed session only, **no production release promised by 31 October**; pilot 7 Nov; sign-off 14–21 Nov; original deadline not achievable with zero code on 30 Oct (RK5) | Strict rule + verification §8 |
| §28 MVP heading | "Required for Saturday 31 October 2026." | "Required for the **controlled pilot on Saturday 7 November 2026** — no production release is promised by 31 October." | Verification §8 |
| §28 Should-Have list | "FR-21, FR-23, **FR-27**, FR-29, FR-31" | "FR-21, FR-23, FR-29, FR-31" + note that FR-27 was reclassified **M** (X-5) and was already inside "MVP includes" | X-5 |
| §30 end note | "End of PRD v1.1…" | "End of PRD v1.2. Corrections X-1…X-7 applied… Q13–Q16 remain **open and unapproved**… zero removals (counts corrected per X-4)." | X-6, X-4 |

---

## 3. X-4 — corrected audit traceability counts

The audit's §5 "zero unaccounted additions" table and §4 change log undercount v1.1 additions. The PRD's in-document markers were correct; the audit tables were not. `PRD_AUDIT_v1.1.md` was not edited by this revision (it is a historical report) — the corrected figures are recorded here and must be applied to the audit at its next revision.

### 3.1 Corrected ID-group counts (v1.0 → v1.1/v1.2)

| ID group | v1.0 | Audit §5 claimed | **Corrected count** | Correction |
|---|---|---|---|---|
| FR-01…FR-35 | 35 | 35 | 35 | None (FR-27 priority changed in v1.2 — X-5, priority only) |
| U1…U16 | 16 | 16 | 16 | None |
| BR-01…BR-19 | 19 | 19 + 3 (BR-20, 21, 22) | 19 + 3 = 22 | Count correct; **labels wrong** — audit describes BR-21 as "close-day gating", but close-day gating is a refinement of **BR-17**; BR-21 is *durability-before-success* |
| SC1…SC5 | 5 | 5 | **6** | **SC6 added in v1.1** (durability confirmation) — audit missed it |
| O1…O7 | 7 | *not listed* | **8** | **O8 added in v1.1** (no unverifiable state presented as fact) — audit has no row for O |
| P1…P7 | 7 | 7 | **8** | **P8 added in v1.1** (conflict/flag evaluation adds no delay) — audit missed it |
| S1…S13 | 13 | 13 + 1 | 14 | None (S14 added) |
| N1…N5 | 5 | 5 | 5 | None |
| U-A1…U-A9 | 9 | 9 + 1 | 10 | None (U-A10 added) |
| E1…E20 | 20 | 20 + 3 | 23 | None (E21–E23 added) |
| A1…A12 | 12 | 12 + 1 | 13 | None (A13 added) |
| **C1…C10** | 10 | **"10 + 2"** | **10 + 3 = 13** | **C13 added in v1.1** — audit omits C13 |
| RK1…RK14 | 14 | 14 + 3 | 17 | None (RK15–RK17 added) |
| Q1…Q12 | 12 | 12 + 4 | 16 | None (Q13–Q16 added) |
| AC-G1…AC-G10 | 10 | 10 | 10 + 1 defined sub-criterion | v1.2 defines **AC-G3b** (previously referenced but undefined) |

### 3.2 Corrected change-log entries (audit §4 omissions and mislabels)

| Audit §4 row | Defect | Corrected content |
|---|---|---|
| Row 21 ("§13 ACs") | Omissions | Must also record the **AC-G3 refinement** (durable-write confirmation / blocking-error durability clause) and the **AC-G6 refinement** (conflict-evidence preservation: losing event persists in the log, resolution audited, both originals retrievable) |
| Row 23 ("§15 BRs") | Mislabel | "BR-20..22 added (event model, **close gating**, verifiable-claims)" → BR-21 is *durability-before-success*; close-day gating is a refinement of BR-17, not a new BR |
| §5 "Unchanged" list | Mislabel | **FR-18** is listed unchanged although v1.1 extends it (later sign-out events become conflicts); **FR-20** and **FR-33** listed unchanged although their text was extended (outstanding-state scope across days; "WhatsApp opened" wording). Correct classification: FR-18 refined; FR-20/FR-33 refined (scope/wording), intent unchanged |

---

## 4. Decisions explicitly NOT taken in v1.2

No stakeholder decision was made, implied, or recorded as approved. The following remain **open**:

| ID | Decision | Status |
|---|---|---|
| Q13 (SQ1) | Corrections offline or online-only | Pending stakeholder — architecture default: online-only for the pilot (AD-5) |
| Q14 (SQ2) | Close day blocked unless online + fully synced | Pending stakeholder — architecture default: block (AD-10) |
| Q15 (SQ3) | SC3 reworded to verifiable terms | Pending stakeholder (SC3 keeps its "pending SQ3" marker) |
| Q16 (SQ4) | Residual-risk acknowledgement (device-clock expiry, unencrypted local data, storage-eviction window) | Pending stakeholder — all "accepted" wording removed (X-1) |
| Q5 | Clock threshold (5 min), future tolerance (5 min), **late-sync window (7 days)** | Pending stakeholder — 7-day value added as a **proposal**, referenced but never marked approved (X-3) |
| Q1–Q4, Q6–Q12 | Carried forward unchanged from v1.0/v1.1 | Pending stakeholder |

**Requirement removals: zero. Priority changes: one** — FR-27 S→M, reason recorded (X-5), consistent with its existing presence in the MVP list.
