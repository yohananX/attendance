# Implementation Plan v1.0
# Grace House School Attendance Sign-In — Controlled Pilot, 7 November 2026

| | |
|---|---|
| **Document** | Compressed implementation plan |
| **Version** | 1.0 — 30 October 2026 |
| **Author** | Lead Software Architect |
| **Team** | **One developer**, part-time stakeholder access for device testing |
| **Target** | **Controlled pilot: Saturday 7 November 2026.** Paper-backed session: Saturday 31 October 2026. Production sign-off: 14–21 November 2026. **No production release is promised by 31 October.** |
| **Inputs** | `PRD_v1.2.md` (product source of truth), `SYSTEM_ARCHITECTURE_v1.0.md` (AD-1…AD-10, protocol, data model), `PRD_VERIFICATION_REPORT.md` §8 |
| **Rules** | No application code, SQL or migrations are written in this plan — it sequences them. No stakeholder decision (Q13–Q16, Q5) is assumed answered; safe defaults from the architecture are used and flagged. The central record for Q5 and Q13–Q16 (proposed defaults and sign-off status) is `STAKEHOLDER_DECISION_REGISTER_v1.0.md`; all five remain **pending stakeholder approval**. |

---

## 0. Schedule reality check (read first)

| Item | Value |
|---|---|
| Build window | **Sun 1 Nov – Fri 6 Nov 2026** (6 days), optionally starting the evening of Sat 31 Oct after the paper-backed session |
| Bottom-up effort in this plan | **≈ 12.5 focused developer-days** (task table below), of which ~10 days is build and ~2.5 days is testing/checklist |
| Independent estimate (`PRD_VERIFICATION_REPORT.md` §8) | **7–10 focused days** for the never-cut core (their total excludes separate setup and compresses testing) |
| Verdict | **The window is short by roughly 1–3 days.** Schedule risk RK5 is live; the verification report's estimate was already for a compressed, cut-scope build |
| Mitigations | (a) smallest safe pilot scope below — cut items stay cut; (b) architecture decisions are pre-made (AD-1…AD-10), so no design churn; (c) hard gate: **if the never-cut core is not green on real phones by end of Fri 6 Nov, the 7 Nov session runs on paper and the software pilot moves to 14 Nov** — a stakeholder decision, not a silent slip |
| Non-negotiable | The never-cut core (§11) is never traded for schedule. A late pilot is recoverable; lost attendance proof is not |

**Suggested day plan:** Day 1 (Sun 1 Nov) §1+§2 · Day 2 (Mon) §3+§4 · Day 3 (Tue) §5+§6 start · Day 4 (Wed) §6 finish+§7 · Day 5 (Thu) §8 · Day 6 (Fri) §9 full pass · Buffer: Sat 6 late / Sun morning for fixes · **Fri evening: go/no-go** · Sat 7 Nov §10.

**Dependency legend:** every task lists the task IDs that must be complete first. `—` means no predecessor.

---

## 1. Project setup and deployment skeleton

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T1.1 | Next.js App Router + TypeScript project on Vercel with environment configuration (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, PIN verifier, `SCHOOL_NAME`), HTTPS live | — | Deployed skeleton app reachable at its Vercel URL over HTTPS; env vars set in Vercel, none exposed client-side | Load the site on a phone: HTTPS padlock present; view-source shows **no** database URL or service-role key (AC-G1) | 0.5 d | **Y** |
| T1.2 | Supabase project wired; RLS enabled with **no policies** on all tables; server-only access path confirmed | T1.1 | Empty database ready for the three-part model; a server route proves service-role connectivity, the browser proves it can read/write **nothing** | From the browser console: any REST call with the public endpoint returns zero rows/permission denied; server route returns ok (S2, S3) | 0.25 d | **Y** |
| T1.3 | PWA skeleton: manifest, service worker with versioned app-shell precache, install-to-home-screen verified on both pilot phones | T1.1 | App installs to home screen; second load opens offline from the shell | Airplane mode → reopen from home screen → app shell loads (blank screens OK at this stage) (U-A7, §2.1 architecture) | 0.25 d | **Y** |

**Milestone M1 (end of Day 1):** skeleton deployed, database locked down, PWA installs and opens offline.

---

## 2. Database and server-side event ingestion

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T2.1 | Implement the three-part data model (migrations written here — not in this plan): append-only event log, session projection, audit stores; DB-level guardrails (no-delete, event-timestamp immutability, correction-only exception) per architecture §3/§7.7 | T1.2 | Schema + protections live; conceptual field list from architecture §3.1–3.3 realised | Attempt a direct timestamp update outside the correction path → fails; attempt a delete → fails; migration applies cleanly on a fresh database (FR-11, BR-05/07, AC-G4) | 0.5 d | **Y** |
| T2.2 | Event ingest endpoint: cookie auth → schema validation → acceptance window (Lagos day + late-sync window **default 7 days pending Q5** + ≤5 min future) → **idempotent accept returning the original acknowledgement** → dual timestamps stamped | T1.1, T3.1 (auth), T2.1 | `POST /api/events` per architecture §5 with per-event results (`accepted/duplicate/rejected/conflict`) | AC-13.1/13.2 (same eventId twice → one row, identical ack); AC-15.1 (no cookie → 401); AC-15.2 (out-of-window → rejected with reason); AC-15.5 (late-in-window accepted + late-synced flag) | 0.75 d | **Y** |
| T2.3 | Projection service: session create/update from accepted events, day keys computed in Lagos, first-synchronised-wins conflict detection writing conflict records + flags, correction version check, late-sync flag | T2.2 | Server-side projector with conflict/correction/late logic (architecture §3.7–3.9) | AC-16.1/16.2 (two sign-outs → winner + losing event retained + conflict record); AC-30.5 (base-version mismatch → flagged, not applied); day key = Lagos date of `device_event_at` regardless of sync date | 0.5 d | **Y** |

**Milestone M2:** server can accept, deduplicate, project and flag events correctly — verifiable with plain HTTP requests before any UI exists.

---

## 3. Authentication and session handling

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T3.1 | Login handler: PIN verification (server-held verifier, constant-time), rate limiting (5 → 5 min, counted per identifier **client and server**), signed HttpOnly 12-hour cookie | T1.1 | Working login endpoint + minimal login screen | AC-01.1–01.3; AC-03.1–03.4; cookie flags HttpOnly/Secure/SameSite inspectable | 0.5 d | **Y** |
| T3.2 | Signed session descriptor (AD-1): server signs Ed25519 `{staffName, iat, exp, keyId}` at login; browser verifies with bundled public key; expiry gate at open + foreground; session-expired screen renders no data. **Device-compatibility test first (uncertainty U1): Ed25519 WebCrypto on both pilot phones — fallback ES256** | T3.1 | Two-layer session per architecture §4.2–4.4 | AC-04.1–04.5 incl. airplane-mode open + expired-descriptor screen; AC-G1 (no PIN/verifier in storage/source/network); **descriptor verifies on both physical phones** | 0.5 d | **Y** |

**Milestone M3:** AC-G1 passes on two real phones.

---

## 4. PWA and local persistence

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T4.1 | IndexedDB layer: `outbox`, `sessions`, `messages` cache, `sessionDescriptor`, `meta` (stores per architecture §2.3) with schema versioning | T1.3 | Single storage-repository module used by all UI code | Stores created/upgraded on load; rehydration restores state after reload | 0.25 d | **Y** |
| T4.2 | **Write-ahead capture pipeline** (never-cut): identities before persistence, one transaction (outbox + overlay), **read-back verification (AD-6)**, success UI only after durable confirmation, **blocking error state on failure (AC-G3b)**, persistent-storage request + quota monitoring/warning | T4.1, T5.1 | The capture core of architecture §2.4–2.6 | AC-08.1–08.4; **AC-G3b drill: simulate quota failure → blocking error, no success state, no outbox entry**; AC-09.3 (same path online/offline) | 0.75 d | **Y** |
| T4.3 | Refresh/closure/restart rehydration | T4.2 | App restores sessions, outbox, descriptor, meta on every load | AC-14.1–14.3: sign in offline → refresh → close browser → reboot device → all pending state intact | 0.25 d | **Y** |

**Milestone M4:** airplane-mode capture with durable persistence passes AC-G3 (incl. AC-G3b) on a real phone.

---

## 5. Attendance capture and session projection (client)

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T5.1 | Sign-in form: name + phone required, phone normalisation (FR-06 rules), event/session UUID generation, automatic device timestamp — **no time input anywhere** | T4.1 | Sign-in flow (architecture §2.4 steps 1–3) | AC-05.x, AC-06.1–06.3, AC-07.1/07.2, AC-G2 | 0.25 d | **Y** |
| T5.2 | Lists + counter + Lagos rendering: in-school (newest first, Sign out), signed-out today, live counter, per-row state chips (icon+text), Africa/Lagos 12-hour formatting | T4.2, T5.1 | Attendance screen per PRD §11.2 | AC-17.1/17.2, AC-19.1, AC-22.1/22.2, AC-G7 (sign-out once, second tap no-op creating no event) | 0.5 d | **Y** |
| T5.3 | Session-reference lifecycle: new sign-in after accepted sign-out starts a **new session** (new reference); client sign-out-once guard; per-device sequence counter | T5.1 | Session rules per architecture §3.4–3.5 | Sign in → out → in again → three events, **two sessions**, no conflict flag; deviceSeq strictly increasing | 0.25 d | **Y** |

**Milestone M5:** the full gate flow works offline on one phone with correct lists.

---

## 6. Synchronisation and conflict handling

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T6.1 | Sync engine (AD-2): triggers (capture/online/open/foreground/visible tick/manual), batching ≤50 events, backoff 2 s→300 s with jitter, inflight guard, in-flight reset on reload, per-event ack application, per-event result handling (accepted/duplicate/rejected/conflict) | T2.2, T4.1 | Full protocol of architecture §5 | AC-09.1/09.2, AC-10.1–10.3, AC-13.1–13.3 (**kill the network mid-request → restart → exactly one record**), AC-G3, AC-G4 | 1.0 d | **Y** |
| T6.2 | Sync status UI: global badge (All synced / N pending / N failed — Retry), per-row states incl. **Failed — needs review** with reason, automatic retry visible | T6.1 | Badge + row chips per PRD §11.3 | AC-10.1–10.3, AC-15.2/15.4 (rejected event visible with reason until resolved) | 0.25 d | **Y** |
| T6.3 | Conflict handling end-to-end: server conflict responses → session flags → flagged rows (icon+text+type) → lead-teacher resolution UI "use first recorded time / use later event's time" as audited correction referencing the conflict (AD-4) | T2.3, T6.1, T8.2 | Visible conflicts + resolution path preserving both events | AC-16.1–16.3, AC-32.1/32.2, **AC-G6 two-phone offline drill** | 0.5 d | **Y** |
| T6.4 | Clock probe + consistency flags (AD-3): probe at open/foreground/sync storing offset/RTT/measuredAt; flags for ahead-of-receipt (> 5 min, Q5 default), sign-out<sign-in, day mismatch, sequence regression; queue duration stored **labelled as queue time**; slow-clock evidenced only via probe | T6.1 | FR-12 implementation per architecture §3.6 | AC-12.1–12.4, **AC-G5 both runs: 2 h fast → ahead-of-receipt flag; 2 h slow → no receipt flag, probe estimate recorded, stored time unchanged** | 0.5 d | **Y** |

**Milestone M6:** AC-G4, AC-G5 and AC-G6 pass across two phones.

---

## 7. WhatsApp workflow

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T7.1 | Template render (school name, corrected times, Lagos format, privacy sentence), `wa.me` URL construction with `encodeURIComponent`, launch (online only), **always-visible Copy control** | T5.2 | Message module per architecture §6.1–6.4 | AC-24.1–24.3, AC-25.1/25.2, AC-G8 incl. O'Brien/Chidiebere and offline Copy | 0.25 d | **Y** |
| T7.2 | Server-held launch marker: `POST …/launched` on launch, ack-gated "WhatsApp opened" chip, outstanding-messages list from server with local cache, **wording audit: no "sent"/"delivered" anywhere** (CSV deferred, but no string may claim it) | T6.1, T7.1 | Marker + outstanding queue per architecture §6.5–6.6 | AC-26.1–26.4, AC-27.1–27.3, AC-20.3 (launch on one device visible on the other after sync) | 0.25 d | **Y** |

**Milestone M7:** messaging flow passes AC-G8 with honest wording.

---

## 8. Day review, correction and closure

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T8.1 | Minimal day review: every child, both times, attribution, sync/conflict/correction/message status; **device-scoped offline with incompleteness banner** (FR-31); outstanding-messages view | T6.2 | Review screen per PRD §11.6 | AC-31.1–31.3; outstanding view reaches zero (AC-G10) | 0.25 d | Conditional — full FR-31 polish is S; the **minimal view + banner** is needed for the close-day drill |
| T8.2 | Audited corrections (FR-30), **online-only for the pilot (AD-5, pending Q13)**: edit displayed time, write original/new/editor/when, mark corrected (icon+text), base-value conflict check, corrected time feeds the message; name/phone edit (FR-29) **only if schedule allows (cut item)** | T2.1, T8.1 | Correction path per architecture §3.8 | AC-30.1–30.5, AC-G9; direct update outside the path fails (AC-11.3/11.4) | 0.5 d | **Y** (FR-30 is M; FR-29 is N) |
| T8.3 | Gated day close (AD-10, **block default pending Q14**): preconditions online + outbox fully acknowledged + outstanding count confirmation; purge acknowledged local data only; blocked states with counts | T6.1, T7.2 | Close-day dialog + purge per architecture §7.11 | AC-35.1–35.5: blocked offline; blocked with 1 pending; succeeds green; **an unsynchronised event can never be purged**; outstanding state reconstructable after close | 0.5 d | **Y** |

**Milestone M8:** end-to-end day lifecycle passes AC-G9 and AC-G10 on the development device.

---

## 9. Testing on at least two real phones

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T9.1 | Device-matrix acceptance pass: **AC-G1 … AC-G10 (corrected AC-G5) on two real phones**, each on mobile data, Wi-Fi and airplane mode, as per PRD §13 | T8.3 | Signed test log per AC per device (document, not code) | All ten groups pass on both phones; any failure → defect fixed and re-tested before go/no-go | 0.75 d | **Y** |
| T9.2 | Adversarial drills: storage-failure (AC-G3b), mid-flight kill (AC-13.3), two-phone offline conflict (AC-G6), wrong-clock runs (AC-G5 both directions), duplicate submission, blocked close (AC-35.1/35.2), refresh/closure/restart (AC-14) | T9.1 | Drill results appended to the test log; defects fixed | Every drill passes; **conflict-evidence chain verified: both original events retrievable after resolution** | 0.5 d | **Y** |
| T9.3 | Staff runbook drill (unassisted): login → sign-in → sign-out → message (launch + press Send) → correction → one simulated offline period → blocked-close demonstration, paper fallback present (PRD §30 items 12) | T9.1 | Drill completed with staff; runbook corrected where staff got stuck | Staff complete the cycle without developer help; outstanding list reaches zero; "All synced" confirmed before close | 0.5 d | **Y** |

**Milestone M9 (Fri 6 Nov, evening): GO / NO-GO.** GO only if T9.1–T9.3 are green on both phones. NO-GO → 7 Nov runs on paper (already-approved fallback, D4/K4) and the software pilot moves to 14 Nov.

---

## 10. Controlled pilot checklist (Saturday 7 November 2026)

| ID | Task | Depends on | Deliverable | Acceptance test | Effort | Blocks pilot |
|---|---|---|---|---|---|---|
| T10.1 | Pre-pilot checklist, executed Friday evening: school name + accounts settled (Q1/Q2 — **stakeholder input required**); final PIN set and shared verbally; **screen lock verified on both phones** (K7a); both phones installed + persistent-storage granted; Ed25519/ES256 descriptor verified on both (U1); environment variables confirmed; **paper sheet + pen present**; runbook printed; staff briefed on: pending badge, failed list, outstanding messages, blocked close, re-login on handover | T9.3 | Completed checklist document | Every line checked; any unchecked line = launch blocker or explicit, recorded risk acceptance by the school owner | 0.25 d | **Y** |
| T10.2 | Pilot-day operation and reconciliation: observe gate flow (target < 15 s per sign-in), watch pending badge and storage warnings, end-of-day reconciliation (counter vs reality, outstanding messages = 0, all synced, blocked-close demo optional), capture findings for production sign-off | T10.1 | Pilot report: pass/fail against SC1–SC6 + notes for 14–21 Nov hardening | SC1, SC3 (as worded pending Q15), SC4, SC5, SC6 demonstrated; zero system-caused lost/duplicate records; **pilot labelled a supervised pilot, not a production release** | 0.5 d (incl. day) | n/a — is the pilot |

---

## 11. Smallest safe pilot scope

The smallest scope that still exercises every integrity guarantee the product promises.

### 11.1 Never cut (all in the pilot — no schedule trade accepted)

1. **Offline capture** — write-ahead capture in airplane mode (FR-05, FR-07, FR-08).
2. **Durable storage** — success only after confirmed durable write; blocking error state (FR-08, FR-14, BR-21, **AC-G3b**).
3. **Synchronisation** — automatic, visible states, per-event acks (FR-09, FR-10, FR-11).
4. **Idempotency** — client event UUIDs, server accepts each exactly once (FR-13, BR-20).
5. **Conflict-evidence chain** — first-synchronised-wins with the losing event permanently retained, flagged, and resolved only via audited correction (FR-16, FR-30, FR-32).
6. **Auth** — PIN login, 12-hour cookie + signed descriptor, rate limiting, no secrets in the browser (FR-01–FR-04, S1–S3).
7. **Core read models** — in-school/signed-out lists, counter, Lagos display (FR-17, FR-19, FR-22).
8. **Messaging** — template, launch, always-available Copy, server-held outstanding queue, "WhatsApp opened" wording (FR-24–FR-27).
9. **Integrity extras that protect the above** — dual timestamps + clock flags (FR-12), acceptance window with visible rejection (FR-15), audited time correction (FR-30), gated day close (FR-35).

### 11.2 Cut for the pilot (schedule only — never part of the never-cut list)

| Cut item | PRD status | Note |
|---|---|---|
| CSV download (FR-33) | C | First in the existing cut order |
| Search (FR-21) | S | Cut order 2 |
| Name/phone edit window (FR-29) | S | Cut order 3; **time correction FR-30 stays — it is M and required for conflict resolution** |
| Duplicate warning (FR-23) | S | Cut order 4 |
| Bulk sign-out (FR-34) | C | Manual sign-out remains |
| Offline-captured corrections | FR-30 option | **Online-only default pending Q13 (AD-5)** — product decision |
| Probe threshold calibration, KPI measurement, accessibility polish beyond icon+text | Q5/Q6/Q8 | Defaults used; measure post-pilot |
| Full cross-device day-review polish | FR-31 is S | Minimal view + offline banner ships (T8.1) |

**Why this is safe:** the cut items affect convenience, not evidence. Nothing cut can lose an event, hide a conflict, falsify a timestamp, or claim an unverified message state. What remains proves arrival and departure, offline, with an audit trail — the product's actual promise.

---

## 12. Effort summary and gate

| Section | Effort (days) | Pilot-blocking |
|---|---|---|
| §1 Setup and deployment skeleton | 1.00 | All Y |
| §2 Database and server ingestion | 1.75 | All Y |
| §3 Authentication and sessions | 1.00 | All Y |
| §4 PWA and local persistence | 1.25 | All Y |
| §5 Capture and projection (client) | 1.00 | All Y |
| §6 Synchronisation and conflicts | 2.25 | All Y |
| §7 WhatsApp workflow | 0.50 | All Y |
| §8 Review, correction, closure | 1.25 | Y (except FR-29 polish) |
| §9 Testing on two real phones | 1.75 | All Y |
| §10 Controlled pilot checklist | 0.75 | All Y (T10.1) |
| **Total** | **≈ 12.5 focused days** against a **6-day window** | — |

**Gate rule:** the go/no-go at end of Friday 6 November is decided by test evidence (T9.1–T9.3), not by date pressure. If NO-GO: 7 November runs on the approved paper fallback and the software pilot moves to 14 November. **A production release is never promised for 31 October.**

**First task to execute: T1.1** — project setup and deployment skeleton (no predecessor; unblocks everything).
