# Product Requirements Document
# School Attendance Sign-In (Offline-First)

| | |
|---|---|
| **Document title** | Product Requirements Document — School Attendance Sign-In |
| **Version** | **1.1 — technically corrected baseline** (supersedes v1.0) |
| **Date** | 30 October 2026 |
| **Author** | Senior PM/BA draft (v1.0); technical consistency audit revision (v1.1) |
| **Status** | Approved working baseline, technically corrected; **pending stakeholder sign-off on Q13–Q16 and technical decisions AD-1…AD-10** before architecture approval |
| **Audience** | Software engineers, UI/UX designers, QA engineers, technical project managers, school stakeholders |
| **Source of truth** | `prd_build-plan.txt` + approved decisions D1–D10, K1–K7 |
| **Companion documents** | `PRD_AUDIT_v1.1.md` — full audit findings, change log v1.0→v1.1, requirements traceability, unresolved technical decisions |

---

## 1. Document Control and Version History

### 1.1 Version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 30 Oct 2026 | School | Original combined PRD + Build Plan (`prd_build-plan.txt`) for Saturday 31 Oct 2026. |
| 1.0 | 30 Oct 2026 | This document | Restructured to the 30-section PRD format; offline-first requirements incorporated per D1–D10, K1–K7. |
| 1.1 | 30 Oct 2026 | Technical audit | **Technical consistency audit applied.** Corrected the event/timestamp model (T-C1), offline session mechanism (T-C2), clock-skew method (T-C3), day-close safety (T-C4), conflict evidence (T-H1), messaging claims (T-H2), local durability (T-H3), correction conflicts (T-H4), attribution (T-H5) and Medium/Low findings. **No requirement removed, no priority changed, no stakeholder decision taken silently.** Full change log and traceability: `PRD_AUDIT_v1.1.md` §4–§5. |

### 1.2 Reading conventions

| Marker | Meaning |
|---|---|
| *(existing)* | Documented in the source PRD/Build Plan, carried forward unchanged. |
| *(approved)* | New or changed by explicit stakeholder decision (references D# or K#). |
| *(technical fix v1.1)* | Implementation-level correction from the technical audit. Does **not** change an approved business requirement; clarifies or corrects how it is achieved. |
| *(recommended)* | Author recommendation, **not yet approved** — listed in §27. |

### 1.3 Traceability of amendments to the original source document

**None of the following requirements were removed.** Each amendment was explicitly approved (see `PRD_AUDIT_v1.1.md` §5 for the full v1.0→v1.1 traceability table showing zero removals).

| Source requirement | Original intent | Approved amendment | Decision |
|---|---|---|---|
| "Set every time on the server…" | Server clock is the single time source | Dual-timestamp: time **captured automatically on the device**, server records receipt; back-dating defended by acceptance window + detection | K1 |
| F4 | Database sets sign-in time | Rewritten FR-07: times **captured automatically**, never manually entered | K1 |
| F8 | Absolute immutability | Originals immutable; **simple audited correction** preserves the original | K3 |
| Test: "phone clock 2 hours wrong → time correct" | Server neutralises wrong clock | Replaced: discrepancy is **detected and flagged**, never silently accepted or rewritten | K2 |
| F11 "Message sent" | Marker implies delivery | Renamed **"WhatsApp opened"** — link-launch confirmation only | D5 |
| Retention delete | Delete via DB | **Owner-level manual purge outside the app**; no-delete trigger intact | D3 |
| Paper back-fill procedure | Online-only design | **Offline-first**; paper only for session/device failure | D4, K4 |
| F15 chosen closing time | A chosen clock time | Records **actual execution time** | D2 |
| U6 role-limited editing | Enforced by role | **Process rule**; gap documented | D6 |

---

## 2. Executive Summary

The School Attendance Sign-In application is a small, phone-first web application that records when each child arrives at and leaves Saturday's extra lesson, so the school can send every parent timestamped proof of attendance the same day. Staff log in with a shared PIN and their first name, type a child's name and parent phone number, tap **Sign in**, later tap **Sign out**, and then send the parent a pre-written WhatsApp message containing both times.

**The offline-first mandate (approved, D4).** The application must work normally with no internet connection. Each attendance action is captured as an individual **event** with an automatically recorded device timestamp, saved durably to local storage, and synchronised to the server automatically when connectivity returns, with visible pending/succeeded/failed states. Every event preserves both its device-captured timestamp and its server-received timestamp; originals are never silently overwritten; offline-captured events are flagged; possible device-clock discrepancies are detected by methods that are technically valid; duplicate submissions are prevented by unique event identity; unsynchronised records survive refresh and browser closure; and WhatsApp messages that cannot be launched while offline remain visibly pending.

**Core integrity promise (amended, K1/K3).** Staff can never type a time during normal operation. The device-captured timestamp is the time of record for each event; the server-received timestamp establishes provenance. Original event timestamps are immutable; the only time change permitted is an explicit, authorised, audit-logged correction to the session's displayed times in which the original is preserved.

**v1.1 technical corrections.** v1.0 could not represent two independently captured events (sign-in, sign-out) in one record, specified an offline-session mechanism that browsers cannot perform, implied an invalid clock-skew calculation, and permitted a day-close purge that could destroy unsynchronised data. v1.1 corrects all four **without removing any requirement** — see `PRD_AUDIT_v1.1.md`.

**Success in one sentence (source):** every child present has an arrival and a departure time that staff cannot type, and every parent receives that proof the same day.

Delivery target is **Saturday 31 October 2026**; offline-first schedule risk accepted (K7b) with documented cut order and paper fallback.

---

## 3. Product Vision

*(existing)*

Deliver believable, tamper-resistant proof of arrival and departure for every child at Saturday's extra lesson, with the least typing possible at the gate, such that:

1. A child's arrival is recorded in under 15 seconds.
2. A departure is recorded with one tap from a list of children currently in school.
3. Times are captured automatically — staff never type or back-date them — and are immutable once recorded (subject only to audited correction).
4. Every parent receives a ready-to-send WhatsApp message containing both times, the same day.
5. The application keeps working when the internet does not.

---

## 4. Problem Statement

*(existing)*

Saturday's extra lesson has no reliable mechanism to prove when each child arrived and left. Parents expect timestamped confirmation; the school needs a record staff cannot retrospectively alter. Manual paper records are slow, illegible, and provide no direct route to the parent. General-purpose school management systems are far larger than this need, require parent logins, incur cost, and do not operate under intermittent connectivity.

The problem is sharpened by connectivity: **the gate is exactly where the network is least reliable.** A solution dependent on live connectivity would force the school back to paper, re-entry, and incorrect timestamps — precisely what this product must prevent.

---

## 5. Product Objectives

*(existing + approved offline-first)*

| # | Objective | Provenance |
|---|---|---|
| O1 | Record a child's arrival in under 15 seconds. | *(existing)* |
| O2 | Record departure with one tap from the "In school" list. | *(existing)* |
| O3 | Prevent staff from typing or back-dating any attendance time; times are captured automatically and protected at the data layer. | *(existing, amended K1)* |
| O4 | Give staff a ready-to-send WhatsApp message for each parent containing both times. | *(existing)* |
| O5 | Keep the application fully usable for sign-in, sign-out and list viewing with no internet, synchronising automatically on reconnection. | *(approved, D4)* |
| O6 | Never lose an attendance event to refresh, restart or retry: unsynchronised records persist; synchronisation never duplicates records; the app never confirms a record it has not durably saved. | *(approved D4 + technical fix v1.1)* |
| O7 | Give staff clear visibility of synchronisation and message status at all times. | *(approved, D4)* |
| O8 | Never present an unverifiable state as a verified fact (skew, message delivery). | *(technical fix v1.1)* |

---

## 6. Success Metrics and KPIs

### 6.1 Success criteria — product level

| # | Criterion | Measurement |
|---|---|---|
| SC1 | Every child present on Saturday has a record with a sign-in time, and a sign-out time once they leave. | End-of-day count equals the paper sheet. |
| SC2 | No original event timestamp can be changed after it is saved; the only permitted change is an audit-logged correction of the session's displayed times that preserves the original. | Direct update attempt fails; corrections appear in the audit log with who/when/original. |
| SC3 | *(reworded, technical fix v1.1 — pending SQ3)* For every child, the **WhatsApp link is launched with the correct message**, and the school confirms actual sending as an operational duty via the runbook. The system itself can only verify link launch, not delivery. | Day review: zero rows in "not launched" state; runbook sign-off that staff pressed Send for each. |
| SC4 | Two or more staff phones — online and offline — use the app without **losing or duplicating records** to sync, retry, refresh or restart. *(Absolute no-loss is not claimable against deliberate local-data clearing; qualified failure set in §21/E21.)* | Concurrency test AC-G6; duplicate check AC-G4. |
| SC5 | Offline events synchronise automatically and visibly on reconnection. | All pending → synced; UI reflects status; no data loss. |
| SC6 | The app never displays a success confirmation for an attendance record that was not durably stored. | Storage-failure test AC-G3b. |

### 6.2 Recommended KPIs *(recommended — targets pending Q8)*

| KPI | Target |
|---|---|
| Median sign-in time at the gate | < 15 seconds |
| Message link launched for every child | 100% before day end (= SC3) |
| Unsynced events at end of day | 0 |
| Sync failure rate per event | < 1% after retries |
| Lost/duplicated records (system-caused) | 0 |
| Clock-discrepancy flags raised | 0 expected; 100% reviewed if raised |
| Durability failures surfaced | 100% surfaced as blocking errors (never silent) |

---

## 7. Target Users and Stakeholders

*(existing)*

| Stakeholder | Description |
|---|---|
| **Gate staff** | Teacher/volunteer at the entrance. Signs in/out, opens parent messages. Primary all-day user; one-handed, on a phone, at a gate. |
| **Lead teacher** | Person in charge of the lesson. Everything gate staff do, plus edits, time corrections, conflict review, day check. |
| **Parent / guardian** | Never logs in. Receives a WhatsApp message with arrival and departure times. |
| **School owner / administration** | Provides PIN and school name; end-of-term retention purge outside the app; accountable for data handling. |
| **Developer / handover contact** | Receives runbook, environment variables, and this PRD. |

**Volume (D7):** ~60 children per session, 2 staff phones (2–4 tolerated).

---

## 8. User Roles and Permissions

*(existing; enforcement gap documented per D6; attribution caveat extended per technical fix v1.1)*

| Role | What they do | Enforcement |
|---|---|---|
| Gate staff | Log in, sign in/out, open parent messages, view lists. | Shared PIN authentication. |
| Lead teacher | Plus: edit name/phone, correct times, review full day, resolve conflicts. | **Process rule only** — the shared PIN cannot distinguish roles. Every edit/correction/ conflict resolution is audit-logged with the sign-in name. *(approved D6)* |
| Parent | Receives a WhatsApp message. | No authentication; no application access. |

**Documented limitations (approved D6 + technical fix v1.1):**
1. All staff share one PIN; each self-declares a first name at login. The system records *who said they did it*, not cryptographic proof.
2. **A shared device holds the most recent login's session.** Offline actions are attributed to the name of the **active session**, not provably to the person holding the phone. Re-login on staff handover is a runbook rule (§14.7). *(technical fix v1.1)*

---

## 9. Product Scope

### 9.1 In scope *(existing)*

- Shared-PIN staff login, first-name attribution, 12-hour session (**two-layer: server cookie + signed local descriptor for offline continuity — technical fix v1.1**).
- Sign-in/sign-out capture as **individually identified events** with automatic timestamps.
- "In school" and "Signed out today" lists, search, in-school counter.
- **Offline operation**: durable local capture, local queue, automatic sync with visible status, duplicate prevention, persistence across refresh/restart. *(approved D4)*
- Dual timestamps per event, offline flag, **valid** clock-discrepancy detection. *(approved D4/K1, technical fix v1.1)*
- Pending WhatsApp queue and **"WhatsApp opened"** marker (link launch only). *(approved D4/D5)*
- Edit name/phone; simple audit-logged time correction with conflict detection. *(existing F10; approved K3; technical fix v1.1)*
- Full-day review, conflict flagging (first-write-wins, evidence preserved), local purge at **gated** day close. *(approved K6/K7a + technical fix v1.1)*
- Africa/Lagos 12-hour display; CSV download; bulk sign-out. *(existing)*

### 9.2 Out of scope *(existing non-goals, unchanged)*

- Parent logins or a parent portal.
- QR cards or barcode scanning.
- Automatic/scheduled SMS or WhatsApp sending (no WhatsApp Business API, no messaging accounts, no cost).
- Fees, grades, timetables, wider school management.
- Individual staff accounts *(future)*.
- Multi-week history, termly reporting, multi-school support *(single-day MVP; D10)*.
- Product analytics / telemetry *(none — confirm Q9)*.
- Verifying that a WhatsApp message was **sent or delivered** by the system. *(technical fix v1.1 — browser cannot verify; C11)*
- Payment, advertising, third-party tracking.

---

## 10. Functional Requirements

Legend — Priority: **M** = Must Have (31 Oct 2026), **S** = Should Have, **C** = Could Have. Provenance markers per §1.2.

### 10.1 Authentication and session

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-01 | Staff log in with a shared PIN and their first name. *(existing F1)* | M | First name + PIN fields; PIN verified **on the server**; on success a signed HTTP-only 12-hour session cookie is set **and** a signed local session descriptor is stored (FR-04); main screen opens showing the name. | AC-01.1 Wrong PIN shows an error; main screen not opened. AC-01.2 Right PIN opens main screen with entered name shown. AC-01.3 Blank name or blank PIN refused with a message. |
| FR-02 | Session lasts 12 hours. *(existing F1)* | M | Server cookie and local descriptor both carry a 12-hour expiry from login; the shorter effective expiry governs. | AC-02.1 Closing and reopening within 12 hours keeps session and lists intact, online or offline. AC-02.2 After 12 hours the user must log in again (online). |
| FR-03 | Failed PIN attempts are rate-limited. *(existing security requirement; device identity defined — technical fix v1.1)* | M | Attempts are counted against a **per-browser local identifier** stored on the device. After 5 wrong attempts, no attempt is accepted for 5 minutes (online), with a visible wait message. Limitation acknowledged: clearing browser storage resets the counter; IP-based counting is not used (unreliable on mobile networks). | AC-03.1 Five wrong PINs trigger the 5-minute wait. AC-03.2 During the wait a correct PIN is also refused, showing remaining wait. AC-03.3 After the wait, login works normally. AC-03.4 The wait applies only while online; offline login is impossible anyway (FR-04). |
| FR-04 | Session continues to work offline without storing any PIN material. *(approved K4; mechanism corrected — technical fix v1.1, pending SQ4 acknowledgement)* | M | **Two-layer session.** (1) *Online layer:* signed HTTP-only cookie, required for every server call. (2) *Offline layer:* on successful login the app stores a **signed session descriptor** locally — staff first name, issued-at, expiry only — signed with the server's private key and verifiable in the browser with a public key shipped in the app. **No PIN, no PIN verifier, no shared secret is stored.** The descriptor is checked at app open and at foreground; while valid the app operates fully offline; on expiry the app shows "Session expired — connect to log in" and **presents no attendance data**. Server APIs remain cookie-gated, so a forged descriptor cannot read server data. | AC-04.1 After one online login, airplane mode → app opens and performs sign-in/sign-out. AC-04.2 Expired descriptor in airplane mode → session-expired screen; no attendance lists or records rendered. AC-04.3 No PIN or PIN verifier appears in storage, cookies, page source or network calls. AC-04.4 While online, server requests with a valid descriptor but no valid cookie are rejected. AC-04.5 Browser closed and reopened within expiry, offline → session and data available. **Known limitation (SQ4/C12): offline expiry is checked against the device clock, which is untrusted; a rolled-back clock can extend offline access until the next online contact, bounded by FR-15 acceptance windows.** |

### 10.2 Attendance capture (sign-in and sign-out)

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-05 | Sign-in form takes student name and parent phone; both required. *(existing F2)* | M | Two fields + Sign in button; after save the form clears with name focused for the next child. | AC-05.1 Blank name or phone refused with visible message. AC-05.2 After successful save the fields clear. |
| FR-06 | Phone numbers cleaned and saved in international format. *(existing F3; rule made objective — technical fix v1.1)* | M | Normalisation rule: strip spaces/dashes/parentheses; a local number starting `0` is converted to `+234…`; any other number already starting `+` with 7–15 digits is stored as-is (international numbers supported); anything else is rejected. Example: `0803 123 4567` → `+2348031234567`. | AC-06.1 `0803 123 4567` stored as `+2348031234567`. AC-06.2 An existing `+`-number (e.g. `+447911123456`) stored unchanged. AC-06.3 A number that cannot be normalised (e.g. `12345`, letters) rejected with a clear message. |
| FR-07 | Times are captured automatically — never typed. *(existing F4, amended K1; offline req 1)* | M | On tap of Sign in / Sign out the app records the **device timestamp for that event** automatically. No time input field exists during normal operation. | AC-07.1 No UI control allows entering an attendance time during normal sign-in/out. AC-07.2 The saved device time equals the device clock at the moment of the tap. |
| FR-08 | Offline actions are saved locally and remain available — **durably**. *(approved D4 req 3; durability hardened — technical fix v1.1)* | M | **Write-ahead:** every action (online or offline) first writes the event to durable local storage (IndexedDB); the UI shows success **only after the local transaction is confirmed durable**. If the write cannot be stored (quota exceeded, storage unavailable/blocked), a **blocking error** is shown — "Could not save on this device — write on paper and retry" — and **no success/pending state is ever shown for an unsaved record**. When offline, a stored event shows as *Saved on device (pending sync)*. Persistent storage is requested from the browser; storage usage is monitored and warned when low. | AC-08.1 Airplane mode → sign-in/out succeed locally with instant list updates and *pending* state. AC-08.2 The success/pending indicator appears only after the local transaction completes successfully. AC-08.3 With local storage forced to fail (quota simulation), the app shows the blocking error and **never** shows a saved state; staff instruction to use paper appears. AC-08.4 Low-storage warning appears before storage becomes critical. |
| FR-09 | Online actions synchronise immediately. *(approved D4 req 2; single path — technical fix v1.1)* | M | One write-ahead path for all actions: durable local save (FR-08) → if online, push to the server as part of the action flow; UI advances *Pending → Synced*. No separate online-only path exists, so behaviour cannot diverge. | AC-09.1 Online sign-in reaches the server without manual intervention. AC-09.2 The row transitions Pending → Synced automatically. AC-09.3 The same code path is observably used online and offline (identical UI states). |
| FR-10 | Visible synchronisation status: pending, successful, failed. *(approved D4 req 4)* | M | Per-row sync indicator plus a global badge ("All synced · N pending · N failed"). Failed items expose Retry; reconnection triggers automatic retry with backoff. | AC-10.1 A pending row is visibly marked until server acknowledgement. AC-10.2 A failed sync is visibly marked; retry succeeds without duplicating the record. AC-10.3 On connectivity return, pending events retry automatically with no user action. |
| FR-11 | Every **event** preserves its own dual timestamps; originals never silently overwritten. *(approved D4/K1 req 5; model corrected — technical fix v1.1)* | M | **Sign-in and sign-out are separate events.** Each carries its own `device_event_at` (captured at the tap) and its own `server_received_at` (set at synchronisation). Event timestamps are immutable after synchronisation. The child's session record is a **projection** of accepted events — it displays the accepted sign-in/sign-out times and cannot be edited except through the audited correction (FR-30), which alters only the displayed times, writes the original to the audit log, and marks the record *corrected*. Underlying events are never modified by corrections. | AC-11.1 A session shows the sign-in event's device/receipt times and the sign-out event's device/receipt times, independently. AC-11.2 Re-syncing or refreshing changes neither timestamp of either event. AC-11.3 A direct attempt to update an event timestamp fails. AC-11.4 A correction changes only the session's displayed times + audit entry; the stored events remain byte-identical. |
| FR-12 | Offline events flagged; possible clock discrepancies detected by valid methods. *(approved D4/K2 req 6; method corrected — technical fix v1.1)* | M | Detection has three parts: (a) **Round-trip time probe** — while online (app open, foreground, and at sync) the client measures the device clock's offset from the server clock, accurate to roughly half the round-trip time; the estimate and its measurement time are recorded. (b) **Queue duration** — for each event, `server_received_at − device_event_at` is recorded as *time spent waiting to sync*; **this is explicitly NOT a clock-skew measurement** because it conflates skew with offline duration. (c) **Consistency rules** flag suspicious events: sign-out earlier than sign-in; device time more than a tolerance (Q5, proposed 5 min) ahead of server receipt; device time outside the Lagos day; per-device sequence going backwards. Flags surface for lead-teacher review. **The system never rewrites a timestamp.** **Verifiability statement:** the true wall-clock accuracy of an offline-captured event **cannot be verified** — only inconsistencies can be detected. | AC-12.1 Offline-captured events are identifiable as such after sync. AC-12.2 Device clock set 2 hours wrong in airplane mode, event syncs → a consistency rule (device time far ahead/behind receipt) raises a visible flag; the stored device timestamp is unchanged; the subsequent online probe records a matching offset estimate. AC-12.3 The stored `queue duration` value is labelled as queue time, not skew, in any diagnostic display. AC-12.4 Probe estimate accuracy is documented as ±½ round-trip time. |
| FR-13 | Duplicate attendance records prevented on retry/interruption. *(approved D4 req 7; identity defined — technical fix v1.1)* | M | **Event identity:** a UUID generated on the client **at the moment of capture, before persistence**, immutable thereafter, unique server-side. **Idempotency:** the server accepts each event ID exactly once; a repeated submission returns the original acknowledgement (not an error, not a second row). **Ordering:** each device keeps a monotonically increasing local sequence; a child's sign-in event is written to the outbox before any sign-out for that child on that device, so cross-device out-of-ordering of a single device's own events cannot occur. | AC-13.1 Retrying a sync after mid-flight interruption creates exactly one server record. AC-13.2 The same event ID submitted twice yields one record and an identical acknowledgement. AC-13.3 An interruption between local save and push, followed by app restart, still results in exactly one record after sync. |
| FR-14 | Unsynced records survive refresh and temporary browser closure. *(approved D4 req 10)* | M | Durable IndexedDB storage, not in-memory or per-tab state; app rehydrates pending state on load. *(Scope: covers refresh, closure, restart — not deliberate data clearing or hardware loss; see §21 E21.)* | AC-14.1 Sign in offline, refresh → records and pending state remain. AC-14.2 Close and reopen browser/PWA → unsynced records remain and sync on reconnect. AC-14.3 Restart the device, reopen → unsynced records remain. |
| FR-15 | Server writes authenticated and time-bounded; rejection is visible, never silent. *(approved K1; tolerance + reaction added — technical fix v1.1)* | M | Only authenticated sessions may submit events. A submitted `device_event_at` must: fall within the allowed window (proposed: Lagos operational day ± permitted late window, and not more than **5 minutes (Q5)** ahead of server receipt). Events outside the window are **not silently dropped**: they enter a visible *Failed — needs review* state, and are resolved through the authorised correction/re-entry path with audit. | AC-15.1 Unauthenticated requests cannot create or modify records. AC-15.2 An event timestamped outside the window is rejected and appears in the failed/review state with a clear reason. AC-15.3 Legitimate same-day offline events within the window are accepted. AC-15.4 No rejected event disappears from the device's failed list until resolved. |
| FR-16 | Cross-device conflicts: first-write-wins, **evidence always preserved**. *(approved K6; evidence store corrected — technical fix v1.1)* | M | When a second sign-in/sign-out event for the same child arrives from another device, the **first synchronised event wins** for the session's displayed time. The later event is **not discarded**: it is retained permanently in the event log marked *conflicting*, the session is flagged, and the conflict is visible in the list and day review. Resolution is done by the lead teacher via the audited correction (FR-30), which references the conflicting event. Both original events remain in the log. | AC-16.1 Two devices sign out the same child offline → the first synchronised sign-out stands; the second event exists permanently in the log as *conflicting*. AC-16.2 A flagged conflict is visible on the row and in the day review; nothing is silently overwritten or deleted. AC-16.3 Resolving the conflict writes an audit entry naming the chosen value; both original events are still retrievable afterwards. |

### 10.3 Lists and display

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-17 | "In school" list. *(existing F5, U3)* | M | Every child with no sign-out time, newest first; name, sign-in time, Sign out button; works offline from local + synced data. | AC-17.1 All unsynced and synced children without sign-out time appear, newest first. AC-17.2 List correct in airplane mode. |
| FR-18 | Sign-out sets the time once; second tap changes nothing. *(existing F6)* | M | One tap; time captured automatically; repeat taps are no-ops (client guard; server accepts one sign-out event per session — later ones become conflicts per FR-16). | AC-18.1 Tapping Sign out twice — online or offline — does not change the recorded time. AC-18.2 After sign-out the row moves to "Signed out today". |
| FR-19 | Live in-school counter. *(existing screen spec)* | M | Counter = children currently in school; used for end-of-day check. | AC-19.1 Counter equals the "In school" row count and updates after every action. |
| FR-20 | "Signed out today" list with Send message control. *(existing F11/U5 — priority elevation still pending Q10)* | M | Rows show name, both times, Send message control, and message status. Outstanding messages remain identifiable across days (state held server-side — technical fix v1.1). *(Elevated Should→Must because existing Must F7 has no home otherwise — Q10.)* | AC-20.1 Every signed-out child appears with both times. AC-20.2 Send message control present on each row. AC-20.3 A message launched on one device is reflected as launched on other devices after sync. |
| FR-21 | Search the lists by name. *(existing F12)* | S | Search box filters both lists by name against locally available data. | AC-21.1 Partial name shows only matching rows. AC-21.2 Clearing restores all rows. |
| FR-22 | Times display in Africa/Lagos, 12-hour format, with the date. *(existing F13)* | M | `Intl.DateTimeFormat` with the Africa/Lagos time zone so every phone shows the same time; `8:47 AM`, `Sat 31 Oct 2026`. | AC-22.1 Displayed times match Lagos time regardless of device time zone. AC-22.2 12-hour format with date shown. |
| FR-23 | Duplicate warning on sign-in. *(existing F9; best-effort offline per K5)* | S | Warn when the same name + phone are already signed in and not signed out. Checks local device data plus last successful sync. | AC-23.1 Signing in a name + phone currently "in school" raises a warning. AC-23.2 Warning dismissible to proceed *(warn-don't-block, pending Q4)*. AC-23.3 Works offline against local data. |

### 10.4 Parent messaging

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-24 | Send message launches WhatsApp with the number and pre-written text. *(existing F7, D8; claims narrowed — technical fix v1.1)* | M | On tap the app **initiates navigation** to `https://wa.me/<number-without-+>?text=<url-encoded message>` with the text fully pre-filled so staff only tap Send. The browser can verify only that navigation was initiated — not that WhatsApp opened, sent, or delivered. A **Copy message** control is **always** available (fallback for SMS/paste); no unreliable "WhatsApp missing" detection is relied upon. | AC-24.1 Tapping Send message navigates to the WhatsApp deep link with the parent's number and pre-filled text (observable as a navigation/action). AC-24.2 The text contains both times and the date as displayed in the app. AC-24.3 The Copy control is always visible and copies the complete message text to the clipboard. |
| FR-25 | Message template with school name from settings. *(existing template)* | M | `Hello, this is [School name]. [Student name] arrived at [8:47 AM] and left at [12:15 PM] on [Sat 31 Oct 2026]. Thank you.` — `[School name]` from environment setting; times from the session record (corrected displayed time if one exists — FR-30). | AC-25.1 Message names school, child, date, arrival, departure. AC-25.2 Times/date use Lagos 12-hour format identical to on-screen values. |
| FR-26 | Pending message queue visible until launched; survives day close. *(approved D4 req 9; state made server-held — technical fix v1.1)* | M | Rows whose WhatsApp link has **not been launched** are visibly *Pending* — including offline, when launching is impossible. Launch state is persisted server-side per record once synced, so it survives local purge, device change and day close; the local list is a cache. The list answers "which messages still need to be sent?" | AC-26.1 Offline sign-out leaves the row in *Pending message* state. AC-26.2 After reconnect, pending messages remain listed until launched. AC-26.3 End of day, staff can identify every child whose message has not been launched. AC-26.4 After day-close purge (FR-35), the outstanding-message list is still reconstructable from server state. |
| FR-27 | "WhatsApp opened" marker — launch confirmation only. *(existing F11, renamed per D5; semantics narrowed — technical fix v1.1)* | S | Set when the WhatsApp **link launch is initiated** (online only). UI chip wording: **"WhatsApp opened"**. The marker is explicitly **not** evidence that staff pressed Send or that the parent received the message — the system cannot verify either (C11). The server field is `whatsapp_launched_at`. | AC-27.1 Launching the link sets the marker on the row. AC-27.2 Marker is never set when no launch occurred (e.g. offline). AC-27.3 No screen or export anywhere claims "sent" or "delivered"; wording is "WhatsApp opened". AC-27.4 (Operational, non-technical) the runbook requires staff to actually press Send — verified by day-end runbook check. |
| FR-28 | Privacy notice to parents. *(existing security requirement; recommended wording)* | M | The message includes one short sentence stating what is recorded and why. Proposed: *"We record arrival and departure times for your child's safety."* | AC-28.1 Message text includes a statement of what is recorded and why. AC-28.2 Final wording approved by the school (Q7). |

### 10.5 Corrections and review

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-29 | Edit name and phone; every edit logged. *(existing F10, U6)* | S | Edit window from a pencil icon; changes name and phone only; times read-only in this mode; each edit writes who/when + old/new values to the audit log. Role restriction is a process rule (D6). | AC-29.1 Name and phone editable; times not editable in this mode. AC-29.2 Every edit writes an audit row with editor name, timestamp, old/new values. |
| FR-30 | Simple time correction with original preserved and conflict detection. *(approved K3, offline req 8; conflict-safe — technical fix v1.1; offline capture pending SQ1)* | M | Authorised staff **edit the displayed sign-in/sign-out time directly** in correction mode. Saving: updates the session's displayed times, writes an audit entry (original value, new value, who, when), marks the record *corrected* (icon + text label, not colour alone), and uses the corrected time in the parent message. The original event timestamps are never altered. **Conflict-safe:** the correction carries the value it was based on; if the record changed on another device before sync, the correction is **flagged for review rather than silently applied**, and both values are retained. *(Offline capture of corrections: recommended yes, queued like events — pending SQ1; alternative is online-only corrections.)* | AC-30.1 From a row, staff can change a displayed time and save; the new time displays and is used in the message. AC-30.2 The audit log retains original time, new time, editor name, edit time. AC-30.3 The record visibly shows it has been corrected (icon + text). AC-30.4 This is the only path changing displayed times; direct updates outside it fail. AC-30.5 Two devices correcting the same time offline → neither silently wins; both corrections retained; record flagged for review. |
| FR-31 | Full-day review list. *(existing U7; offline scope stated — technical fix v1.1)* | S | One list showing every child, both times, who recorded each action, sync state, conflict flags, correction status, message status. **Offline, this view covers the local device's synced + unsynced data only; a complete cross-device view requires synchronisation.** | AC-31.1 View shows all records for the day with both times and attribution. AC-31.2 Message, sync and conflict status visible per row. AC-31.3 Offline, a banner states the view may be incomplete until sync. |
| FR-32 | Conflict flag visible on affected rows. *(approved K6)* | M | Any row involved in a first-write-wins conflict or a correction conflict carries a visible flag (icon + text) identifying it for lead-teacher review. | AC-32.1 After an offline conflict, the affected row shows a conflict indicator in the list and day review. AC-32.2 Indicator identifies the type (time conflict / correction conflict). |

### 10.6 Data utility and housekeeping

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-33 | Download the day's records as CSV. *(existing F14)* | C | Export all of the day's rows with both timestamps, attribution, sync state, correction status, message status. Exports "WhatsApp opened" wording, never "sent". | AC-33.1 CSV downloads with every row for the day and the documented columns. AC-33.2 Column/message-status wording is "WhatsApp opened". |
| FR-34 | Sign out all remaining children. *(existing F15, amended D2; offline scope stated — technical fix v1.1)* | C | "Sign out all remaining" signs out every child still in school, recording the **actual execution time** for each. **Offline, this applies only to sessions present on that device** (local + synced); the global set requires sync. Each resulting sign-out event obeys once-only and idempotency rules. | AC-34.1 One action signs out all rows currently without a sign-out time on this device. AC-34.2 Each recorded time equals the moment of execution. AC-34.3 Already-signed-out rows unaffected. AC-34.4 Offline bulk sign-out affects only locally visible sessions; other devices' sessions untouched. |
| FR-35 | Local day-data purged at **gated** day close. *(approved K7a; gating added — technical fix v1.1, pending SQ2)* | M | **Close day is an online operation with enforced preconditions:** (1) device online; (2) local outbox empty — every event acknowledged by the server; (3) outstanding-message count displayed with explicit confirmation (state is server-held, so purging the local copy loses nothing). Only server-acknowledged local data is purged; **unsynchronised events are never purged**. If offline or the outbox is not empty, **close is blocked** with a clear message ("N records not yet synced"). No "purge anyway" option exists. | AC-35.1 Close day attempted offline → blocked with a clear message; no data removed. AC-35.2 Close day with pending events → blocked showing the count; no data removed. AC-35.3 Close day online, fully synced → local attendance data and session descriptor removed after confirmation. AC-35.4 An unsynchronised event can never be purged (verified by attempting close with one pending). AC-35.5 Outstanding-message state remains reconstructable from the server after close. |

---

## 11. Detailed Feature Specifications

### 11.1 Screen 1 — Login *(existing + v1.1 states)*

| Element | Spec |
|---|---|
| Fields | First name; PIN (password-style, numeric ≥ 6 digits). |
| Button | Log in (large, primary). |
| States | *Default* — form ready. *Loading* — verifying. *Error* — wrong PIN. *Rate-limited* — wait message with remaining time. *Offline, no session* — "Internet needed to log in." *Offline, valid descriptor* — direct to attendance. *Offline, expired descriptor* — **"Session expired — connect to log in"**, no attendance data shown (FR-04). |
| Behaviour | PIN verified server-side; on success server sets cookie, app stores signed descriptor (name, issued, expiry — nothing else). |

### 11.2 Screen 2 — Attendance (single page, three parts)

1. **Sign-in form (top):** student name, parent phone, Sign in button; clears and refocuses after save; no time input (FR-07).
2. **In-school list:** name, sign-in time, Sign out button; newest first (FR-17); per-row sync icon (synced / pending / failed / conflict / corrected).
3. **Signed-out today list:** name, both times, Send message control, status chip: *Pending (offline)* / *Not opened* / *WhatsApp opened* (FR-20, FR-26, FR-27).

**Global chrome:** search (FR-21); in-school counter (FR-19); sync badge "All synced / N pending / N failed — Retry" (FR-10); staff name displayed.

### 11.3 Sync indicator

| State | Visual | Action |
|---|---|---|
| All synced | Neutral badge | — |
| Pending (offline) | Amber badge + per-row icon | Automatic |
| Syncing | Animated | — |
| Failed (retryable) | Red badge + per-row icon | Retry (auto-retry too) |
| Failed — needs review (rejected by window rule FR-15) | Red + reason | Opens correction/re-entry path |
| Conflict flagged | Warning icon + text on row | Opens row for lead-teacher review |

### 11.4 Pending message queue

Embedded in "Signed out today": chip "Messages outstanding: N" lists children whose link has not been launched (FR-26). Server-held, so it survives device change and day close. This is the SC3 checklist.

### 11.5 Edit window *(existing + correction mode + v1.1 conflict handling)*

- Opens from a pencil icon on any row.
- **Mode A:** edit name/phone; times read-only (FR-29).
- **Mode B (correction):** displayed times editable (FR-30); saving writes audit (original, new, editor, when), marks row *corrected*, and carries the base value for conflict detection at sync.
- Technical note: data-layer time protection must make **event** timestamps immutable while permitting the session projection to change **only** through the audited correction path; all other time updates fail. *(Conceptual requirement only — architecture document will specify how.)*

### 11.6 Day review *(existing U7 + v1.1 flags)*

Full-day table: name, sign-in, sign-out, who signed in/out, corrected?, conflict? (+type), sync state, message status ("WhatsApp opened" / pending). Offline view is device-scoped with an incompleteness banner (FR-31). CSV control here (FR-33).

### 11.7 Design constraints *(existing)*

Phone held one-handed, large buttons, two screens + one edit window, PWA home-screen install.

### 11.8 Operational states added in v1.1 *(technical fix v1.1)*

- **Session expired (offline):** dedicated screen; no attendance data rendered.
- **Close day dialog:** shows online status, pending-event count, outstanding-message count; blocks unless preconditions met (FR-35).
- **Durability failure:** blocking error screen with paper instruction (FR-08).

---

## 12. User Stories

Format: *As a [user], I want [capability], so that [benefit].* U1–U8 are source stories reformatted without meaning change; U9–U16 cover offline-first.

| ID | User story | Acceptance summary |
|---|---|---|
| U1 | As gate staff, I log in with the PIN and my name, so that only staff can use the app. | Wrong PIN errors; right PIN opens main screen with my name shown. |
| U2 | As gate staff, I sign a child in by typing their name and parent number, so that arrival is recorded without delay. | Child appears in "In school" with automatically captured sign-in time. |
| U3 | As gate staff, I see who is currently in school, so that I always know who is present. | Name, sign-in time and Sign out button, newest first — including offline. |
| U4 | As gate staff, I sign a child out with one tap, so that departure is recorded at hand-over. | Sign-out time saved once; row moves to "Signed out today"; second tap changes nothing. |
| U5 | As gate staff, I send the parent a message after sign-out, so that they receive proof of attendance. | WhatsApp link launches with the number and pre-written text; only Send needs tapping. |
| U6 | As lead teacher, I fix a typo in a name or phone number, so that records stay accurate. | Name/phone editable; times not editable here; every edit logged. |
| U7 | As lead teacher, I check the whole day, so that I can verify every child is accounted for. | One list: every child, both times, who recorded them, message/sync status. |
| U8 | As a parent, I get a clear message, so that I know exactly when my child arrived and left. | Text names my child, gives date, arrival and departure times. |
| U9 | As gate staff, I can sign children in and out with no internet, so that an outage never stops the gate. | Airplane mode: all actions succeed locally; lists update instantly. |
| U10 | As gate staff, I can see which records have synchronised and which have not, so that I know what is safely on the server. | Badge and per-row indicators show pending, synced, failed — and a record is only shown as saved once durably stored. |
| U11 | As gate staff, I want pending records to sync automatically when the connection returns, so that I never re-enter anything. | On reconnect, pending events upload without action; failures retryable; no duplicates. |
| U12 | As gate staff, my unsaved records survive closing and reopening the app, so that a refresh or restart cannot lose attendance data. | Records and pending states persist across refresh, browser closure and device restart (not deliberate data clearing — §21 E21). |
| U13 | As gate staff, I can see which parent messages still need to be launched, so that no parent is forgotten before the day ends. | Visible list/count of outstanding messages until each link is launched. |
| U14 | As lead teacher, I can correct a recorded time simply, so that a wrong device clock or forgotten entry can be fixed with the truth preserved. | Editing the displayed time saves the correction, keeps the original in the audit log, flags the record as corrected, and detects conflicting corrections. |
| U15 | As lead teacher, I am alerted when two phones made conflicting entries for the same child, so that I can resolve it deliberately. | Conflicting rows flagged (first write wins); the losing event is preserved, never silently discarded. |
| U16 | As the school, I want every recorded action attributed to a named staff member, so that we can review who did what. | Each record carries the login first name for sign-in, sign-out and corrections (attribution = active session, §8). |

---

## 13. Acceptance Criteria

Objective, testable, end-to-end. All pass on real phones, on mobile data and Wi-Fi, and in airplane mode where stated.

**AC-G1 — Login, session, offline access**
Wrong PIN denied with error (FR-01); correct PIN online opens main screen with name; browser closed/reopened within 12 hours keeps session and lists, online **and offline** (FR-02, FR-14, FR-04); five wrong PINs → 5-minute wait (FR-03); **offline with an expired descriptor → session-expired screen with no attendance data** (FR-04); database URL and service role key absent from page source and network calls (S2).

**AC-G2 — Online capture**
Online sign-in shows child in "In school" with automatically captured time (FR-05, FR-07, FR-09, FR-17); `0803 123 4567` → `+2348031234567`; non-Nigerian `+` number unchanged; unnormalisable number rejected (FR-06); blank fields refused (FR-05).

**AC-G3 — Offline capture, persistence, durability**
Airplane mode: sign-in/out succeed locally with instant updates and *pending* state (FR-07, FR-08); refresh and browser reopen preserve all unsynchronised records (FR-14); **storage failure produces a blocking error and never a success confirmation (AC-G3b, SC6)**; on connectivity return pending events auto-sync to *synced* (FR-09, FR-10).

**AC-G4 — Integrity, dual timestamps, idempotency**
Sign-in and sign-out each show their own device and receipt times (FR-11); re-sync changes neither (FR-11); offline events flagged offline-captured (FR-12); sync retry after interruption → exactly one record with an identical acknowledgement (FR-13); direct event-timestamp update outside the correction flow fails (FR-11, FR-30).

**AC-G5 — Clock discrepancy (corrected method)**
Airplane mode, device clock set 2 hours wrong, sign in, reconnect → the event syncs with its stored device time **unchanged**, a consistency rule raises a visible discrepancy flag (device time vs receipt beyond tolerance), and the online time probe records a matching offset estimate. The queue duration is recorded as queue time, not skew. *(Replaces v1.0's invalid receipt-minus-device skew claim — T-C3.)*

**AC-G6 — Concurrency and conflict**
Two phones online, simultaneous actions → both records appear on both phones after refresh; no loss or duplication (SC4); both phones offline acting on the same child → first synchronised write wins, the losing event persists in the log flagged as conflicting, resolution via audited correction leaves both originals retrievable (FR-16, FR-32, AC-16.3).

**AC-G7 — Sign-out semantics**
Sign-out captures time automatically once; second tap (online or offline) changes nothing; row moves to "Signed out today" (FR-18, FR-20).

**AC-G8 — Messaging (verifiable claims only)**
Tapping Send **initiates navigation** to the WhatsApp deep link with correct number and pre-filled text containing both times, date, school name and privacy sentence (FR-24, FR-25, FR-28); Copy control always available and copies the full text (FR-24); offline → message stays *Pending*, no marker set (FR-26); launch sets the marker shown as **"WhatsApp opened"** — no screen or export claims "sent"/"delivered" (FR-27); names with apostrophes/accents (O'Brien, Chidiebere) render correctly; message times match on-screen Lagos 12-hour values (FR-22, FR-25).

**AC-G9 — Corrections and audit**
Name/phone edits write audit rows with who/when/old/new (FR-29); time correction updates displayed times, preserves the original in the audit log, marks the row *corrected* (icon + text), and feeds the corrected time to the message (FR-30); default edit mode leaves times read-only (FR-29); **concurrent offline corrections are flagged, not silently merged (AC-30.5)**.

**AC-G10 — End of day (incl. gated close)**
60 test children across two phones stay responsive (§19); counter equals list (FR-19); outstanding-messages view identifies every unlaunched message (FR-26); all records synced (FR-10); **close day blocked offline and blocked with pending events (AC-35.1/35.2); close succeeds only online and fully synced, purging only acknowledged data and never unsynchronised events (AC-35.3/35.4)**; outstanding-message state still reconstructable from server after close (AC-35.5); CSV export contains all day rows with "WhatsApp opened" wording (FR-33).

---

## 14. User Workflows and Business Processes

### 14.1 Normal arrival (online)
Type name + phone → **Sign in** → device timestamp captured (FR-07) → event saved durably locally, pushed immediately (FR-08/09) → appears in "In school" → form clears.

### 14.2 Normal arrival (offline)
Same, but no connection → event stored locally as *Saved on device (pending sync)* (FR-08) → child appears in "In school" → gate never stops.

### 14.3 Departure and message
Tap **Sign out** (once) → row moves to "Signed out today" → tap **Send message** → WhatsApp deep link launched with pre-filled text → staff tap Send in WhatsApp → row marked "WhatsApp opened". Offline: row shows *Pending message*; launch possible after reconnection; outstanding list drives completion (FR-26).

### 14.4 Synchronisation (automatic)
Connectivity return or app open/foreground triggers sync → probe records offset estimate (FR-12) → server accepts each event ID once, records receipt time, applies window rules (FR-13/15) → UI advances Pending → Synced, or → Failed (retry) / Failed — needs review (window rejection) → conflicts detected first-write-wins with evidence retained (FR-16).

### 14.5 Correction flow *(approved K3 + v1.1 conflict handling)*
Lead teacher opens row → corrects name/phone (Mode A) or a displayed time (Mode B) → save → displayed times update, audit entry written (original, new, who, when), row marked *corrected*, correction queued for sync with its base value → if the record changed elsewhere meanwhile, the correction is flagged for review instead of applied → parent message uses the corrected time.

### 14.6 Network failure contingency *(paper is last-resort only)*
- **Normal case:** no paper needed — offline-first (D4).
- **Paper fallback only for:** expired session with no connectivity (FR-04), storage/durability failure (FR-08), total device failure. A paper-recorded child entered later gets the entry time as recorded time → correct via FR-30, use the real time in the parent message.

### 14.7 End-of-day process *(updated for gated close)*
1. In-school counter zero or accounted for.
2. Outstanding-messages list empty (SC3) — staff confirm each launch **and actual send** (SQ3).
3. "All synced" badge confirmed; failed items resolved.
4. **Close day (online, blocked otherwise)** → local data purged only after full server acknowledgement (FR-35).
5. Photograph paper sheet (if used).
6. Change the staff PIN.
7. **On staff handover: re-login so attribution follows the new name (§8).**
8. *(School owner, end of term)* export records, then purge the database manually outside the app (D3).

---

## 15. Business Rules

| ID | Rule | Source |
|---|---|---|
| BR-01 | All staff share one PIN; each enters their first name at login, stamped on every record. **On a shared device this is the active session's name, not proof of the person at the phone.** | Existing; caveat extended technical fix v1.1 |
| BR-02 | PIN ≥ 6 digits; changed after each session day; shared by word of mouth, not group chat. | Existing |
| BR-03 | After 5 failed PIN attempts (per-browser identifier), block 5 minutes (online only). | Existing; identity defined technical fix v1.1 |
| BR-04 | Attendance times are captured automatically; no typed times during normal operation. | F4, K1 |
| BR-05 | **Each sign-in and sign-out is a distinct event with its own immutable device time and server receipt time.** The session's displayed times derive from accepted events; corrections change only the displayed times, preserving originals in audit. | Approved K1; corrected technical fix v1.1 |
| BR-06 | A session receives exactly one accepted sign-out; later sign-out events become flagged conflicts, never silent overwrites. | F6 + K6, technical fix v1.1 |
| BR-07 | Attendance records and events are never deleted through the application. | Existing |
| BR-08 | The only permitted time change is an authorised correction: original preserved, audit entry written, record marked corrected. | K3 |
| BR-09 | Name/phone edits log editor, time, old/new values. | F10 |
| BR-10 | Phones stored in international `+` format; local `0…` → `+234…`; other `+` numbers with 7–15 digits accepted as-is. | F3 + technical fix v1.1 |
| BR-11 | Server accepts events only from authenticated sessions, once per event ID, within the acceptance window (Lagos day, ≤5 min ahead — Q5); rejected events enter a visible review state, never a silent drop. | K1, FR-13/15 |
| BR-12 | Conflicts resolve first-write-wins; the losing event is preserved permanently and flagged; nothing silently overwritten or discarded. | K6 + technical fix v1.1 |
| BR-13 | The marker means "WhatsApp link launched". The system never asserts that a message was sent or delivered. | D5 + technical fix v1.1 |
| BR-14 | Messages are opened from the staff phone via pre-filled deep link; the server never sends messages. | Existing |
| BR-15 | All times displayed in Africa/Lagos, 12-hour format, with the date. | F13 |
| BR-16 | Role restrictions are a process rule, not a technical control; the audit log is the accountability mechanism. | D6 |
| BR-17 | **Day close is gated:** online + fully synchronised + confirmation; only acknowledged local data purged; unsynchronised events never purged. | K7a + technical fix v1.1 |
| BR-18 | End-of-term retention: owner exports, then deletes manually outside the application; in-app no-delete rule unchanged. | D3 |
| BR-19 | Bulk sign-out records actual execution time. | D2 |
| BR-20 *(new v1.1)* | Every event carries a client-generated unique identity created at capture, before persistence; retries re-send the same identity. | Technical fix v1.1 (T-C1) |
| BR-21 *(new v1.1)* | A record is never shown as saved until the local write is durably confirmed; storage failure surfaces as a blocking error. | Technical fix v1.1 (T-H3) |
| BR-22 *(new v1.1)* | The system states only what it can verify; unverifiable states (clock accuracy of offline events, message send/delivery) are flagged as unverified, never presented as facts. | Technical fix v1.1 (T-C3/T-H2) |

---

## 16. Data Requirements

### 16.1 Server-side conceptual model *(corrected in v1.1 — T-C1; three parts, additive to the source schema; no SQL here)*

**Part 1 — Event log (append-only; the immutability guarantee lives here)**

| Attribute | Purpose |
|---|---|
| Event ID | Client-generated UUID **at capture, before persistence**; unique; idempotency key (FR-13, BR-20) |
| Event type | `sign_in` \| `sign_out` \| `correction` |
| Session reference | Links events to one child-session |
| Device-captured time | Time of record for this event; immutable (BR-05) |
| Server receipt time | When the server received it; immutable (BR-05) |
| Captured-offline flag | Identifies offline origin (FR-12) |
| Device ID + local sequence | Skew consistency checks, ordering, attribution to device (FR-12/13) |
| Recording staff name | From active session (BR-01) |
| Conflict marker | Marks a losing/rejected/conflicting event as evidence (FR-16) |

*Why a log: a session has two (or more) independently captured events, each with its own timestamps and idempotency key; conflicting events from two devices must both be preserved; corrections must not mutate originals.*

**Part 2 — Session projection (mutable UI-facing state; one row per child-session)**

| Attribute | Purpose |
|---|---|
| Identity | student_name, parent_phone (edited via FR-29) |
| Accepted sign-in / sign-out times | Derived from accepted events; displayed; corrigible only via FR-30 |
| Day key | Lagos calendar date of the sign-in event (FR-15, §16.4) |
| Attribution | signed_in_by / signed_out_by |
| Sync state | synced / pending / failed / needs-review |
| Flags | corrected, conflict (+type), late-synced |
| Message state | `whatsapp_launched_at` (renamed from `message_opened_at` — T-L2) |

**Part 3 — Audit stores**
- **Corrections:** field, original value, new value, base value (for conflict detection), who, when, linked event/conflict (FR-30).
- **Conflicts:** both retained events, winner, resolution and resolver (FR-16).
- **Login attempts:** per-browser identifier, timestamp (FR-03).

**Data-layer protections (conceptual; no SQL in this document):** event timestamps immutable; session times changeable only through the audited correction; no deletes through the app; RLS enabled with no policies; only server code with the service role key accesses data.

### 16.2 Local (device) data *(approved D4/K7a; durability rules added v1.1)*

| Store | Contents | Lifetime |
|---|---|---|
| Outbox | Unsynced events (event ID, payload, device time, local sequence, state) | Until server acknowledgement; **never purged unsynchronised** |
| Day cache | Today's records for offline lists | Until gated day close (FR-35) |
| Pending messages | Cached outstanding-message list | Until launched; server copy survives (FR-26) |
| Session descriptor | Signed: first name, issued-at, expiry (**nothing else — no PIN, no verifier**) | 12 hours |

Durability rules (FR-08/14, BR-21): IndexedDB; browser **persistent storage** requested; write confirmed before any success UI; storage usage monitored with early warning; failure → blocking error (never false success). Acknowledged limitation: deliberate browser-data clearing or hardware loss can destroy unsynchronised events — mitigated by immediate sync when online and the end-of-day "All synced" check (E21).

### 16.3 Data volumes
~60 children × 2 events ≈ 120 events/day + audit rows. Single-day scope (D10).

### 16.4 Day boundaries *(clarified in v1.1 — T-M3)*
- Time zone Africa/Lagos (UTC+1, no DST).
- The **operational day** is the Lagos calendar date of `device_event_at` (the day the child actually attended) — **not** the sync date.
- An event captured offline and synchronised after midnight attaches to its **original** day, is flagged *late-synced*, and appears in that day's review. It is never dropped or re-dated (FR-15, E23).
- Lists, CSV and day review scope by day key.

### 16.5 Retention
- Operational: to end of term → owner CSV export → **manual purge outside the app** (BR-18, D3).
- Device: purged at gated day close (BR-17, D4).

---

## 17. Notification Requirements

| ID | Requirement | Pri |
|---|---|---|
| N1 | The **only** notification channel is WhatsApp, launched from the staff phone via a pre-filled `wa.me` link. No in-app notifications, push, email, SMS from the system, no WhatsApp Business API, no cost. *(existing)* | M |
| N2 | Message content per FR-25/FR-28; Lagos 12-hour times (FR-22). | M |
| N3 | Messages cannot be launched offline; they remain visibly pending until launched (FR-26); state server-held and survives day close. | M |
| N4 | "WhatsApp opened" marker set on **link launch only**; system never claims sent/delivered (FR-27, BR-13). | S |
| N5 | Copy-message control always available as fallback (SMS / paste) — replaces unreliable "WhatsApp missing" detection. | S |

---

## 18. Security and Privacy Requirements

| ID | Requirement | Source |
|---|---|---|
| S1 | PIN verified on the server; signed HTTP-only session cookie (12 hours). | Existing |
| S2 | No database keys in the browser. All reads/writes via server code using the **service role key**, held only in Vercel environment variables — never in front-end code, page source or chat. | Existing |
| S3 | RLS enabled on all tables with **no policies**, blocking the public key entirely. | Existing |
| S4 | PIN guessing limited: 5 wrong attempts → 5-minute wait (online), keyed to a per-browser identifier. | Existing + technical fix v1.1 |
| S5 | PIN ≥ 6 digits, changed after session day, shared verbally. | Existing |
| S6 | HTTPS only (Vercel). | Existing |
| S7 | Attribution: staff first name on every action — *who said they did it*, not cryptographic proof; on a shared device it is the active session's name. | Existing, D6, technical fix v1.1 |
| S8 | Retention: end of term → export → owner-level manual purge outside the app. | Existing, D3 |
| S9 | Privacy notice: parents told what is recorded and why, in the message (FR-28). | Existing |
| S10 | **Local data at rest is NOT encrypted.** Children's names and parent phone numbers sit in browser storage on staff devices in readable form. **A screen lock is a deterrence measure, not encryption** and is not presented as such. Mitigations: staff phone screen lock/passcode required (runbook), minimal data held (current day only), purge at gated day close (FR-35), no PIN/verifier stored, no sensitive data in system notifications. Residual risk explicitly accepted by stakeholder (K7a, SQ4). | Approved K7a + honest restatement technical fix v1.1 |
| S11 | Offline authentication stores **no PIN and no PIN verifier** — only the signed session descriptor (name, issued, expiry). The descriptor is signed; it cannot be forged to read server data because server APIs require the HTTP-only cookie. | Approved K4, corrected technical fix v1.1 |
| S12 | Server acceptance guards: authenticated sessions only, one acceptance per event ID, Lagos-day/±5-min window, offline events flagged, consistency checks recorded — this replaces the back-dating defence the server clock previously provided. | K1, FR-12/15 |
| S13 | Corrections and edits are audit-logged (who/when/original), giving after-the-fact accountability despite the shared PIN. | K3, D6 |
| S14 *(new v1.1)* | **Offline session limitation, documented:** offline expiry is enforced client-side against the device clock, which is untrusted. A device with a rolled-back clock may retain offline access beyond 12 hours until the next online contact. Bound by FR-15 window checks at sync; never used to alter records. Accepted trade-off (SQ4). | Technical fix v1.1 (T-C2) |

---

## 19. Performance Requirements

| ID | Requirement | Target | Source |
|---|---|---|---|
| P1 | Sign-in recorded within | < 15 seconds | Existing O1 |
| P2 | Local (offline) action response | UI feedback immediate; local durable write < 200 ms typical *(recommended, Q6)* | D4 |
| P3 | Online server action response | < 1.5 s on mobile data *(recommended, Q6)* | Recommended |
| P4 | Scale | 60 children ≈ 120 events/day; 2 (up to 4) phones | D7 |
| P5 | List performance | Responsive at 60+ rows; scroll/search fluid | Existing, D7 |
| P6 | Synchronisation | Auto on reconnect/open/foreground; pending batch completes in seconds when online *(recommended, Q6)* | D4 |
| P7 | Availability | All capture functions usable with **zero** connectivity | D4 |
| P8 *(new v1.1)* | Sync with conflict/flag evaluation | Conflict and consistency checks add no perceptible delay to sync of a day's events | Recommended |

---

## 20. Usability and Accessibility Requirements

| ID | Requirement | Source |
|---|---|---|
| U-A1 | Phone, one hand, large buttons; primary actions thumb-reachable. | Existing |
| U-A2 | Two screens + one edit window; no nested navigation during gate operations. | Existing |
| U-A3 | Sign-in form clears and refocuses after each save. | Existing |
| U-A4 | Status understandable without training: sync/message states use icon **and** text, never colour alone. | D4 |
| U-A5 | Touch targets ≈ 44×44 px; body text ≥ 16 px; WCAG AA contrast. *(recommended, Q6)* | Recommended |
| U-A6 | One-tap actions show clear resulting state (sign-out is once-only). | F6 |
| U-A7 | Installable home-screen PWA. | Existing |
| U-A8 | Special characters in names (O'Brien, Chidiebere) render correctly everywhere. | Existing |
| U-A9 | Offline is a **state**, not an error; every other error states what to do next. | D4 |
| U-A10 *(new v1.1)* | The UI never displays an unverifiable state as verified fact — e.g. "WhatsApp opened" not "Message sent"; flagged clock data shown as "flagged for review", not "wrong". | Technical fix v1.1 (T-H2/T-C3) |

---

## 21. Error Handling and Edge Cases

| # | Scenario | Required behaviour | FR ref |
|---|---|---|---|
| E1 | No connectivity at sign-in/out | Save locally (durably), show Pending, continue; auto-sync on return | FR-08/09/10 |
| E2 | Sync fails after retry | Flag Failed with Retry; never lose; never duplicate | FR-10/13 |
| E3 | Sync interrupted mid-flight | Idempotent retry — exactly one record, identical ack | FR-13 |
| E4 | Page refresh / browser closed with pending records | Records and states persist | FR-14 |
| E5 | Device clock wrong *(corrected v1.1)* | Detected via probe + consistency rules; flagged for review; stored times unchanged; **no claim that the true time is known** | FR-12 |
| E6 | Two devices act on same child offline | First-write-wins; losing event preserved and flagged; both retrievable | FR-16/32 |
| E7 | Double-tap Sign out | Second tap is a no-op | FR-18 |
| E8 | Duplicate sign-in of a child already in school | Warning (best-effort offline); dismissible (Q4) | FR-23 |
| E9 | Invalid/unnormalisable phone | Reject with clear message | FR-06 |
| E10 | Blank name or phone | Refuse with message | FR-05 |
| E11 | WhatsApp unavailable / link does not open | **Copy control always available** (SMS/paste fallback); no unreliable detection relied on | FR-24 |
| E12 | Offline while a message is due | Pending message shown; no marker until launch | FR-26/27 |
| E13 | Session expires while offline | "Session expired — connect to log in"; **no attendance data presented**; paper fallback | FR-04 |
| E14 | Wrong PIN | Error; 5 attempts → 5-minute wait with visible message | FR-01/03 |
| E15 | Event outside acceptance window *(clarified v1.1)* | Rejected into visible **Failed — needs review** state with reason; resolved via correction/re-entry; **never silently dropped** | FR-15 |
| E16 | Local storage cannot save *(hardened v1.1)* | **Blocking error** with paper instruction; **success/pending state never shown** for an unsaved record | FR-08, BR-21 |
| E17 | Server returns error on online action | Show error with retry; local copy remains pending | FR-10 |
| E18 | Conflict discovered after sync | Row flagged; lead teacher reviews; nothing overwritten | FR-16/32 |
| E19 | Correction applied after the message was launched *(clarified v1.1)* | Row flagged "corrected after message"; corrected time shown on re-open; staff decides about re-sending | FR-30 |
| E20 | Network drops mid-day | No effect on capture; paper only for session/device/storage failure | §14.6 |
| E21 *(new v1.1)* | Storage low / browser data cleared / device lost | Early low-storage warning + aggressive sync; acknowledged residual risk: unsynchronised events may be lost to deliberate clearing or hardware loss — flagged, not hidden (SQ4) | FR-08/14 |
| E22 *(new v1.1)* | Close day attempted offline or with pending events | **Blocked** with count message; no data removed | FR-35 |
| E23 *(new v1.1)* | Event synchronised after its Lagos day | Attached to original day, flagged *late-synced*, visible in that day's review; never dropped or re-dated | FR-15, §16.4 |

---

## 22. Reporting and Analytics Requirements

| ID | Requirement | Pri |
|---|---|---|
| R1 | Full-day review: both times, attribution, sync/correction/conflict status, message status (FR-31). | S |
| R2 | In-school counter for end-of-day reconciliation (FR-19). | M |
| R3 | Outstanding-messages view guaranteeing SC3 — server-held, survives day close (FR-26). | M |
| R4 | CSV export of the day's records, "WhatsApp opened" wording (FR-33). | C |
| R5 | **Product analytics/telemetry: none** *(confirm Q9)*. | — |

---

## 23. External Integrations

| Integration | Nature | Notes |
|---|---|---|
| **Supabase (Postgres)** | Datastore | Server-side only via service role key; RLS on, no policies; region nearest Lagos. |
| **Vercel** | Hosting | HTTPS automatic; function region near Supabase; env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STAFF_PIN`, `SESSION_SECRET`, `SCHOOL_NAME`. |
| **WhatsApp (consumer app)** | Message hand-off | `wa.me` deep link, pre-filled text; **no API, no account, no cost**; system verifies launch only (BR-13). |
| **Device browser storage** | Local persistence | IndexedDB-class; durability rules §16.2. |
| **Browser storage APIs** *(new v1.1)* | Durability support | Persistent-storage request, storage-usage monitoring (FR-08). |

No other integrations. The Google Sheet/Form fallback (A10) is referenced but its document was not supplied (Q3).

---

## 24. Assumptions and Dependencies

| # | Assumption / dependency | Type |
|---|---|---|
| A1 | Combined source document is the sole source of truth (D1). | Assumption |
| A2 | School name and strings supplied as placeholders until provided (D9). | Assumption |
| A3 | Supabase/Vercel accounts exist or will be created (Q2). | Dependency |
| A4 | Staff phones have WhatsApp installed; sending phone has the school's WhatsApp (runbook). | Dependency |
| A5 | Staff phones support home-screen PWA install; screen lock/passcode enabled (K7a). | Dependency |
| A6 | Target browsers support IndexedDB and service workers. **Sync must trigger on reconnect *and* on app open/foreground** (background sync not guaranteed, esp. iOS). | Assumption |
| A7 | Unreliable connectivity at the gate; offline-first is the primary design (D4). | Assumption |
| A8 | ~60 children, 2 staff phones (D7). | Assumption |
| A9 | Single-day MVP; weekly reuse only as future work (D10). | Assumption |
| A10 | Google Sheet/Form fallback from the earlier plan — **document not supplied** (Q3). | Dependency (unverified) |
| A11 | Offline-first accepted with schedule risk (K7b). | Assumption |
| A12 | Paper sheet and pen present as last-resort fallback (runbook). | Dependency |
| A13 *(new v1.1)* | Browsers honour a persistent-storage request; **residual risk of eviction/deliberate clearing acknowledged** (E21, SQ4). | Assumption |

---

## 25. Constraints and Limitations

| # | Constraint |
|---|---|
| C1 | **Deadline: Saturday 31 October 2026.** Offline-first increases the original ~5h20m estimate — schedule risk accepted (K7b), cut order §28. |
| C2 | **Zero-cost stack:** no paid messaging/services beyond free tiers; deep-link WhatsApp only (D8). |
| C3 | **Shared PIN:** one credential; role separation procedural only (D6); attribution is session-based and self-declared. |
| C4 | **Device clock is untrusted:** offline event times are only as accurate as the device; skew of a *past* offline event is **not measurable** (it is inseparable from queue time) — detection is by probe + consistency rules only; corrections are the remedy (K2, T-C3). |
| C5 | **Message status verification stops at link launch:** the system cannot verify that staff pressed Send or that the parent received the message, without a paid API (D5, C11). |
| C6 | **Offline duplicate warning is best-effort** — devices cannot see each other's unsynced data (K5). |
| C7 | **Single-day, single-school scope**; no multi-week history (D10). |
| C8 | **No deletes through the app**; retention purge is an owner-level external operation (D3). |
| C9 | PWA/browser limits: background sync not guaranteed; sync also occurs on open/focus (A6). |
| C10 | No parent-facing application. |
| C11 *(new v1.1)* | The browser can verify only *message prepared* and *link initiated* — not send, not delivery. |
| C12 *(new v1.1)* | **Offline session expiry is client-enforced against an untrusted device clock**; real enforcement requires connectivity (FR-04, S14, SQ4). |
| C13 *(new v1.1)* | Local data at rest is unencrypted; screen lock is deterrence, not protection (S10, SQ4). |

---

## 26. Risks and Mitigation Strategies

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RK1 | Internet drops at the school | Medium | Low | Offline-first (D4); paper for session/device failure only. |
| RK2 | Name or phone mistyped | High | Medium | Say the name back; edit window with audit (FR-29). |
| RK3 | Staff forget to sign a child out | Medium | Medium | In-school counter vs reality at day end (FR-19, §14.7). |
| RK4 | PIN shared too widely | Medium | Medium | Change after session day; names on records; audit (BR-01/02). |
| RK5 | **Build runs late (amplified by offline-first)** | **High** | High | Cut order §28; never cut offline chain/PIN/integrity; paper fallback; accepted (K7b). |
| RK6 | Parent has no WhatsApp | Low | Low | Copy control → SMS (FR-24, E11). |
| RK7 | Device clock wrong during offline capture | Medium | High | Probe + consistency flags (FR-12); time correction with preserved original (FR-30); message text editable before launch. |
| RK8 | Records lost by refresh/restart | Medium | High | Durable IndexedDB (FR-14); immediate sync; end-of-day sync check. |
| RK9 | Sync duplicates from retries | Medium | High | Client event IDs + server idempotent acceptance (FR-13); AC-G4. |
| RK10 | Conflicting offline entries from two phones | Medium | Medium | First-write-wins + preserved, flagged evidence (FR-16/32). |
| RK11 | Local PII exposure on lost/stolen staff phone | Low | High | **Unencrypted by design choice (S10)**; screen lock, day-close purge, no PIN stored, minimal data window. |
| RK12 | Back-dating attempt via clock manipulation | Low | High | Lagos-day/±5-min window, offline flags, consistency checks, full audit (S12); failed events surface for review (E15). |
| RK13 | iOS devices: no background sync → events linger | Medium | Medium | Sync on open/foreground as well as reconnect; pending badge makes lingering visible (FR-10, A6). |
| RK14 | Single-day deadline, no contingency date | High | High | Runbook, paper fallback, cut order; Google Sheet fallback unverified (A10/Q3). |
| RK15 *(new v1.1)* | Storage eviction, quota exhaustion or user clearing destroys unsynchronised events | Medium | High | Persistent-storage request, quota warning, immediate sync, blocking-failure UX, end-of-day sync gate; residual risk acknowledged (SQ4, E21). |
| RK16 *(new v1.1)* | Device clock rolled back to extend offline session | Low | Medium | Descriptor expiry + FR-15 window at sync + flags; acknowledged limitation (C12, S14). |
| RK17 *(new v1.1)* | Late sync after day close causes misplaced records | Low | Medium | Lagos day key; late events attach to original day, flagged (E23). |

---

## 27. Open Questions and Pending Decisions

### 27.1 Stakeholder decisions required (new from technical audit)

| # | Question | Recommendation |
|---|---|---|
| **Q13 (SQ1)** | May corrections be captured **offline** (queued, base-value conflict-checked), or online-only? | Offline supported. |
| **Q14 (SQ2)** | Confirm **Close day is blocked** unless online + fully synced, with outstanding-message warning? | Block. |
| **Q15 (SQ3)** | Confirm SC3 reworded to verifiable terms: *"WhatsApp link launched for every child; staff confirm actual sending via runbook"*? | Approve. |
| **Q16 (SQ4)** | Acknowledge residual risks: (a) offline session expiry depends on device clock; (b) local data at rest **not encrypted** — screen lock ≠ encryption; (c) storage-eviction exposure window bounded by immediate sync. | Acknowledge. |

### 27.2 Carried-forward open questions (v1.0)

| # | Question |
|---|---|
| Q1 | **School name** for the message (placeholder in use). |
| Q2 | Which Supabase/Vercel accounts (do they exist)? Which phone sends parent messages? |
| Q3 | Supply the "earlier plan" (Google Sheet/Form) referenced as fallback — or confirm not needed. |
| Q4 | Duplicate warning: confirm **warn-and-dismiss** (not block). |
| Q5 | Thresholds: clock-skew flag threshold (proposed 5 min); acceptance window tolerance (proposed Lagos day, ≤5 min ahead). |
| Q6 | Performance targets §19 (P2/P3/P6, U-A5) — confirm or adjust. |
| Q7 | Final wording of the parent privacy sentence (FR-28). |
| Q8 | KPI targets §6.2 — confirm. |
| Q9 | Confirm **no product analytics/telemetry** (R5). |
| Q10 | FR-20 priority elevation Should→Must — confirm. |
| Q11 | Have parents been told that arrival/departure times are recorded? |
| Q12 | Target devices (Android/iOS) — determines background-sync expectations (A6, RK13). |

### 27.3 Unresolved technical decisions before architecture approval

Full list with options: `PRD_AUDIT_v1.1.md` §6 (AD-1…AD-10): session-descriptor signature scheme · sync protocol details and backoff · probe schedule and thresholds · conflict-resolution UX · offline-corrections outcome (SQ1) · local write-verification method · late-sync policy · device identifier scheme · outstanding-message source of truth · day-close interaction (SQ2).

---

## 28. MVP Definition

**MVP = all Must Have requirements.** Required for Saturday 31 October 2026.

**MVP includes:** FR-01…FR-20, FR-22, FR-24…FR-28, FR-30, FR-32, FR-35 — PIN login + two-layer session + rate limiting; automatic timestamp capture; durable offline capture with local queue, automatic sync, visible sync states, per-event dual timestamps, offline flags + valid clock detection, idempotency, persistence, acceptance window with visible rejection, conflict resolution with evidence; in-school/signed-out lists, counter, Lagos display; WhatsApp launch link, template + privacy sentence, pending-message queue; simple audited time correction with conflict detection; conflict visibility; gated day-close purge.

**Cut order if time is short** *(existing order, offline integrity protected):*
1. CSV download (FR-33, C)
2. Search (FR-21, S)
3. Edit window for name/phone (FR-29, S)
4. Duplicate warning (FR-23, S)

**Never cut:** PIN login, time integrity (dual timestamps, idempotency, acceptance window, audit), **the entire offline capture/sync/persistence chain including durable-write confirmation**, the Lagos time display, the pending-message queue, conflict evidence preservation, or the gated day-close safety rules.

**Should Have (if time allows):** FR-21, FR-23, FR-27, FR-29, FR-31.
**Could Have (next iteration):** FR-33, FR-34.

---

## 29. Future Enhancements

*(existing list unchanged)*

- Individual staff logins instead of one shared PIN.
- QR cards so staff scan instead of typing.
- Automatic messages by SMS or the WhatsApp Business API.
- Student list imported once, so staff pick a name instead of typing.
- Daily and termly attendance reports.
- *(new)* Weekly/multi-session reuse: day-boundary model, per-week history (follows D10).
- *(new)* Encrypted local storage and remote wipe for lost devices (addresses S10 residual risk).
- *(new)* True delivery confirmation (WhatsApp Business API or read-receipt workflow) if cost becomes acceptable.
- *(new)* Sync telemetry/health view for staff phones.

---

## 30. Final Product Acceptance Criteria

The product is accepted for handover when **all** are demonstrated on real phones, on mobile data and Wi-Fi:

1. **Access:** wrong PIN refused; 5 wrong PINs trigger the 5-minute wait; main screen unreachable without login; offline within session works; **offline after expiry shows session-expired with no attendance data**; no database URL/service-role key in page source (AC-G1).
2. **Capture:** sign-in well under 15 seconds; times never typed; blank fields refused; phone normalisation incl. non-Nigerian numbers (AC-G2).
3. **Offline:** airplane mode fully functional for capture; pending states shown; records survive refresh, closure and restart; **storage failure never produces a success confirmation (AC-G3b/SC6)**.
4. **Sync:** automatic on reconnect with visible transitions; no loss; no duplicates; idempotent retries with identical acknowledgements (AC-G3, AC-G4).
5. **Dual timestamps:** per-event device and receipt times; re-sync changes neither; direct timestamp updates fail outside correction (AC-G4).
6. **Clock integrity:** wrong device clock offline → event syncs, stored time unchanged, visible flag raised via probe + consistency rules; queue time not mislabelled as skew (AC-G5).
7. **Concurrency:** multiple phones online and offline lose and duplicate nothing; conflicts are first-write-wins with the losing event **preserved and flagged**, resolution audited (AC-G6).
8. **Sign-out:** one tap, set once; second tap no-op (AC-G7).
9. **Messaging:** link launch with correct number and pre-filled text (both times, date, school, privacy sentence); special-character names correct; offline messages stay pending; status wording **"WhatsApp opened"** everywhere — never "sent"/"delivered"; Copy control always available (AC-G8).
10. **Corrections:** name/phone and time corrections audit-logged with originals preserved; records visibly marked corrected; corrected time used in the message; concurrent corrections flagged, not merged (AC-G9).
11. **End of day:** 60 children across two phones responsive; counter reconciles; outstanding list reaches zero; all synced; **close day blocked offline and blocked while unsynced; successful close purges only acknowledged data; outstanding state survives close (AC-G10)**.
12. **Runbook drill:** staff complete a full cycle — login, sign-in, sign-out, message, correction — unassisted, including one simulated offline period and one blocked-close demonstration.
13. **Handover complete:** runbook printed, final PIN set, staff briefed, placeholders replaced (Q1/Q2), open questions Q4–Q16 resolved or explicitly waived, technical decisions AD-1…AD-10 settled.

---

*End of PRD v1.1. No application code, SQL, migrations, API/UI implementation or System Architecture Document has been produced; mechanism-level items are stated as requirements and recommendations with stakeholder decisions flagged (SQ1–SQ4 / Q13–Q16). Traceability confirming zero requirement removals: `PRD_AUDIT_v1.1.md` §5.*
