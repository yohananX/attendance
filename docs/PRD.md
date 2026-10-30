# Product Requirements Document
# School Attendance Sign-In (Offline-First)

| | |
|---|---|
| **Document title** | Product Requirements Document — School Attendance Sign-In |
| **Version** | 1.0 |
| **Date** | 30 October 2026 |
| **Author** | Senior Product Manager / Business Analyst (drafted from source materials) |
| **Status** | Draft for stakeholder approval |
| **Audience** | Software engineers, UI/UX designers, QA engineers, technical project managers |
| **Source of truth** | `prd_build-plan.txt` (combined PRD + Build Plan) plus approved clarification decisions D1–D10 and K1–K7 recorded below |

---

## 1. Document Control and Version History

### 1.1 Version history

| Version | Date | Author | Summary |
|---|---|---|---|
| 0.1 | 30 Oct 2026 | School (source author) | Original combined PRD + Build Plan (`prd_build-plan.txt`) produced for Saturday 31 Oct 2026 delivery. |
| 1.0 | 30 Oct 2026 | This document | Restructured into the 30-section PRD format. Incorporates stakeholder clarification decisions D1–D10 and conflict resolutions K1–K7. Introduces the approved **offline-first** requirement set (source doc was online-only). No requirement removed; all amendments are traceable (§1.3). |

### 1.2 Reading conventions

Every requirement in this document is tagged with its provenance:

| Marker | Meaning |
|---|---|
| *(existing)* | Documented in the source PRD/Build Plan, carried forward unchanged. |
| *(approved)* | New or changed as a result of an explicit stakeholder decision (references D# or K#). |
| *(recommended)* | A recommendation by the author. **Not yet approved** — listed in §27 Open Questions where it requires confirmation. |

### 1.3 Traceability of amendments to the original document

The following source requirements were amended. **None were removed.** Each amendment was explicitly approved.

| Source requirement | Original text (intent) | Approved amendment | Decision |
|---|---|---|---|
| Goals: "Set every time on the server, so staff cannot type or back-date it" | Server clock is the single time source | Dual-timestamp model: time is **captured automatically on the device** (never typed), server records receipt; back-dating defended by bounded acceptance window + skew detection | K1 |
| F4: "The sign-in time is set by the database, never by the browser" | Database sets sign-in time | Rewritten as FR-07: timestamps are **captured automatically by the app**, never manually entered; `device_event_at` is the time of record, `server_received_at` records receipt | K1, offline req 1/5 |
| F8: "The sign-in time cannot be edited by anyone, including through the database API" | Absolute immutability | Rewritten as FR-07/FR-11/FR-30: original timestamps are immutable and always preserved; a **simple authorised correction** (edit the recorded time) is audit-logged and never overwrites the original silently | K3, offline req 8 |
| Test item: "Set the phone clock 2 hours wrong and sign in. The saved time is still correct." | Server clock neutralises wrong device clock | Replaced: a wrong device clock is **detected and flagged at synchronisation**, never silently accepted or silently rewritten | K2 |
| F11 "Message sent" marker / success criterion "every parent receives a message" | Marker implies delivery proof | Renamed **"Message opened"** — self-reported confirmation that staff opened WhatsApp | D5 |
| Security: "Keep the records until the end of term, then export and delete" | Delete via app/DB | **Owner-level manual purge outside the app**; the no-delete trigger remains intact | D3 |
| Runbook: paper sheet during network drops, back-fill later | Online-only design | **Offline-first**: paper sheet retained only as the fallback for session-expiry/total-device-failure | D4, K4 |
| F15: "Sign out everyone still in school at a chosen closing time" | A chosen clock time | Records the **actual execution time**; renamed "Sign out all remaining" | D2 |
| U6: "As lead teacher, I fix a typo" (role-limited editing) | Technically unenforceable with a shared PIN | Retained as a **process rule**; the enforcement gap is documented | D6 |

---

## 2. Executive Summary

The School Attendance Sign-In application is a small, phone-first web application that records when each child arrives at and leaves Saturday's extra lesson, so the school can send every parent timestamped proof of attendance the same day. Staff log in with a shared PIN and their first name, type a child's name and parent phone number, tap **Sign in**, later tap **Sign out**, and then send the parent a pre-written WhatsApp message containing both times.

**The offline-first mandate (approved, D4).** The application must work normally with no internet connection. Attendance actions are captured with an automatically recorded device timestamp, queued locally on the device, and synchronised to the server automatically when connectivity returns, with visible pending/succeeded/failed states. Every event preserves both its device-captured timestamp and its server-received timestamp; originals are never silently overwritten; offline-captured events are flagged; device-clock discrepancies are detected at synchronisation; duplicate records are prevented across retries; unsynchronised records survive page refresh and browser closure; and WhatsApp messages that cannot be opened while offline remain in a visible pending queue.

**Core integrity promise (amended, K1/K3).** Staff can never type a time during normal operation. The device-captured timestamp is the time of record; the server-received timestamp establishes provenance. Original timestamps are immutable; the only time change permitted is an explicit, authorised, audit-logged correction in which the original is preserved.

**Success in one sentence (source):** every child present has an arrival and a departure time that staff cannot type, and every parent receives that proof the same day.

Delivery target is **Saturday 31 October 2026**. The stakeholder has accepted the schedule risk created by offline-first (K7b), with a documented cut order and a paper-sheet fallback retained in the runbook.

---

## 3. Product Vision

*(existing, carried from source goals)*

Deliver believable, tamper-resistant proof of arrival and departure for every child at Saturday's extra lesson, with the least typing possible at the gate, such that:

1. A child's arrival is recorded in under 15 seconds.
2. A departure is recorded with one tap from a list of children currently in school.
3. Times are captured automatically — staff never type or back-date them — and are immutable once recorded (subject only to audited correction).
4. Every parent receives a ready-to-send WhatsApp message containing both times, the same day.
5. The application keeps working when the internet does not.

---

## 4. Problem Statement

*(existing)*

Saturday's extra lesson currently has no reliable mechanism to prove when each child arrived and left. Parents expect timestamped confirmation of their child's attendance; the school needs a record that staff cannot retrospectively alter. Manual paper records are slow, illegible, and provide no direct route to the parent. Existing general-purpose school management systems are far larger than this need, require parent logins, incur cost, and do not operate at a rural/intermittent-connectivity gate.

The problem is further sharpened by connectivity: **the gate is exactly where the network is least reliable.** A solution that depends on live connectivity would force the school back to paper, re-entry, and incorrect timestamps — which is precisely what this product must prevent.

---

## 5. Product Objectives

*(existing + approved offline-first objective)*

| # | Objective | Provenance |
|---|---|---|
| O1 | Record a child's arrival in under 15 seconds. | *(existing)* |
| O2 | Record departure with one tap from a list of children currently in school. | *(existing)* |
| O3 | Prevent staff from typing or back-dating any attendance time; times are captured automatically and protected at the database layer. | *(existing, amended K1)* |
| O4 | Give staff a ready-to-send WhatsApp message for each parent containing both times. | *(existing)* |
| O5 | Keep the application fully usable for sign-in, sign-out and list viewing with no internet connection, synchronising automatically on reconnection. | *(approved, D4)* |
| O6 | Never lose an attendance event: unsynchronised records survive refresh and browser closure; synchronisation never duplicates records. | *(approved, D4)* |
| O7 | Give staff clear visibility of synchronisation and message-sending status at all times. | *(approved, D4)* |

---

## 6. Success Metrics and KPIs

### 6.1 Success criteria — product level

*(existing; wording amended per D5/K1)*

| # | Criterion | Measurement |
|---|---|---|
| SC1 | Every child present on Saturday has one row with a sign-in time, and a sign-out time once they leave. | End-of-day row count equals attendance count on the paper sheet. |
| SC2 | No row's original sign-in time can be changed after it is saved; the only permitted change is an audit-logged correction that preserves the original. | Attempting a direct update fails; every correction appears in the audit log with who/when/original. |
| SC3 | Every parent receives a message with both times before the day ends. | End-of-day review: zero rows in "not opened" state. |
| SC4 | Two or more staff phones can use the app at once — online and offline — without losing or duplicating records. | Concurrency test (§13, AC-G6); duplicate check after offline retry. |
| SC5 | Offline attendance events synchronise automatically and visibly when connectivity returns. | All pending events transition to synced; UI reflects status; no data loss. |

### 6.2 Recommended KPIs

*(recommended — targets require confirmation, see §27 Q8)*

| KPI | Target | Note |
|---|---|---|
| Median sign-in time at the gate | < 15 seconds | Directly from goal O1; measured by observation during Saturday. |
| Parent message completion rate | 100% of children before day end | = SC3. |
| Unsynced events at end of day | 0 | All device events acknowledged by the server. |
| Sync failure rate per event | < 1% after automatic retries | Offline requirement 4. |
| Lost/duplicate records | 0 | SC4. |
| Clock-skew flags raised | 0 expected; 100% reviewed if raised | Offline requirement 6. |

---

## 7. Target Users and Stakeholders

*(existing)*

| Stakeholder | Description |
|---|---|
| **Gate staff** | Teacher or volunteer at the entrance. Signs children in, signs them out, sends the parent message. Primary, all-day user; one-handed, on a phone, at a gate. |
| **Lead teacher** | Person in charge of the lesson. Does everything gate staff do, plus corrects mistakes and checks the day's list. |
| **Parent / guardian** | Never logs in. Receives a WhatsApp message with arrival and departure times. |
| **School owner / administration** | Provides the PIN and school name; performs end-of-term retention purge outside the app; accountable for data handling. |
| **Developer / technical handover contact** | Receives the runbook, environment variables, and this PRD. |

**Volume assumption (D7):** approximately **60 children** per session, **2 staff phones** (per runbook roles; 2–4 tolerated).

---

## 8. User Roles and Permissions

*(existing; role enforcement gap documented per D6)*

| Role | What they do | Enforcement |
|---|---|---|
| Gate staff | Log in, sign in, sign out, open parent messages, view lists. | Shared PIN authentication. |
| Lead teacher | Everything gate staff do, plus edit name/phone, correct times, review the full day, review conflicts. | **Process rule only** — the shared PIN cannot technically distinguish roles. Every edit and correction is audit-logged with the sign-in name. *(approved D6: documented gap)* |
| Parent | Receives a WhatsApp message. | No authentication; no access to the application. |

**Documented limitation (approved D6):** all staff share one PIN and each person self-declares their first name at login. The system therefore records *who said they did it*, not cryptographic proof of who acted. Role restrictions for editing/correcting are training instructions, backed by the audit log for after-the-fact accountability — not by technical enforcement.

---

## 9. Product Scope

### 9.1 In scope *(existing)*

- Shared-PIN staff login with first name attribution and 12-hour session.
- Sign-in capture (student name, parent phone, automatic timestamp).
- Sign-out (one tap, once only).
- "In school" and "Signed out today" lists with search and a live in-school counter.
- **Offline operation**: local capture, local queue, automatic synchronisation with visible status, duplicate prevention, persistence across refresh. *(approved D4)*
- Dual timestamps per event (device-captured, server-received) with offline flag and clock-skew detection. *(approved D4/K1)*
- Pending WhatsApp message queue with "Message opened" marker. *(approved D4/D5)*
- Edit name/phone and simple audit-logged time correction. *(existing F10; approved K3)*
- Full-day review list with attribution and message status. *(existing)*
- Conflict flagging (first-write-wins) across devices. *(approved K6)*
- Local device-data purge after day close. *(approved K7a)*
- Africa/Lagos 12-hour time display. *(existing)*
- CSV download of the day's records, bulk sign-out. *(existing, Could-have)*

### 9.2 Out of scope *(existing non-goals, unchanged)*

- Parent logins or a parent portal.
- QR cards or barcode scanning.
- Automatic/scheduled SMS or WhatsApp sending (no WhatsApp Business API, no messaging accounts, no cost).
- Fees, grades, timetables, or any wider school management.
- Individual staff accounts / individual logins *(future enhancement)*.
- Multi-week history, termly reporting, or multi-school support *(single-day MVP; see D10)*.
- Product analytics / telemetry *(none — confirm, §27 Q9)*.
- Any payment, advertising, or third-party tracking.

---

## 10. Functional Requirements

Legend — Priority: **M** = Must Have (required for 31 Oct 2026), **S** = Should Have (if time allows), **C** = Could Have (later). Provenance: *(existing)*, *(approved D#/K#)*, *(recommended)*.

### 10.1 Authentication and session

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-01 | Staff log in with a shared PIN and their first name. *(existing F1)* | M | First name + PIN fields; PIN verified **on the server** against a secret setting; on success a signed HTTP-only session cookie is set and the main screen opens showing the name. | AC-01.1 Wrong PIN shows an error and does not open the main screen. AC-01.2 Right PIN opens the main screen with the entered name displayed. AC-01.3 Blank name or blank PIN is refused client-side. |
| FR-02 | Session lasts 12 hours. *(existing F1)* | M | Signed, HTTP-only cookie holding the staff first name; expiry 12 hours from login. | AC-02.1 Closing and reopening the browser within 12 hours keeps the session and lists intact. AC-02.2 After 12 hours the user must log in again. |
| FR-03 | Failed PIN attempts are rate-limited. *(existing security requirement)* | M | After 5 wrong PIN attempts from one device, no further attempt is accepted for 5 minutes; a visible message states the wait. | AC-03.1 Five wrong PINs trigger the 5-minute wait. AC-03.2 During the wait, a correct PIN is also refused with a message showing the remaining wait. AC-03.3 After the wait, login works normally. *(Rate limiting applies when online — see FR-04.)* |
| FR-04 | Session continues to work offline. *(approved K4)* | M | Login requires connectivity **once**. After that the cached signed session is accepted locally until its 12-hour expiry, so the app opens and operates with no network. An expired session with no network cannot be re-established. | AC-04.1 After one online login, airplane mode → app still opens and performs sign-in/sign-out. AC-04.2 An expired session in airplane mode shows a clear "connect to log in" message and does not expose attendance data. AC-04.3 No PIN or PIN verifier is stored on the device. |

### 10.2 Attendance capture (sign-in and sign-out)

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-05 | Sign-in form takes student name and parent phone; both required. *(existing F2)* | M | Two fields + Sign in button. After save the form clears with the name field ready for the next child. | AC-05.1 Blank name or blank phone is refused with a visible message. AC-05.2 After a successful save the fields are cleared. |
| FR-06 | Phone numbers are cleaned and saved with the country code. *(existing F3)* | M | e.g. `0803 123 4567` → `+2348031234567`; spaces, dashes and parentheses stripped; stored in international `+` format. | AC-06.1 `0803 123 4567` is stored as `+2348031234567`. AC-06.2 An already-international number (`+234…`) is stored unchanged. AC-06.3 A number that cannot be normalised is rejected with a clear message. |
| FR-07 | Times are captured automatically — never typed. *(existing F4, amended K1; offline req 1)* | M | When the staff member taps Sign in or Sign out, the app records the device timestamp automatically. There is **no time input field** in normal operation. | AC-07.1 No UI control exists for manually entering an attendance time during normal sign-in/out. AC-07.2 The saved time matches the device clock at the moment of the tap. |
| FR-08 | Offline actions are saved locally and remain available. *(approved D4, offline req 3)* | M | If there is no connection, the event is written to local storage (IndexedDB), the UI updates immediately as if saved, and the child appears in the list. | AC-08.1 In airplane mode, sign-in and sign-out both succeed and the lists update instantly. AC-08.2 Local write completes without network; no error is shown for being offline (a "Pending sync" state is shown instead). |
| FR-09 | Online actions synchronise immediately. *(approved D4, offline req 2)* | M | When online, events are pushed to the server as part of the action flow; the UI shows the synced state. | AC-09.1 Online sign-in reaches the server without manual intervention. AC-09.2 The row transitions from Pending → Synced automatically. |
| FR-10 | Visible synchronisation status: pending, successful, failed. *(approved D4, offline req 4)* | M | Per-row sync indicator plus a global sync badge (e.g. "All synced · 3 pending · 1 failed"). Failed items expose a Retry control; reconnection triggers automatic retry. | AC-10.1 A pending row is visibly marked until acknowledged by the server. AC-10.2 A failed sync is visibly marked and retry succeeds without duplicating the record. AC-10.3 On connectivity return, pending events retry automatically without user action. |
| FR-11 | Every event preserves both timestamps; originals are never silently overwritten. *(approved D4/K1, offline req 5)* | M | `device_event_at` (time of record) and `server_received_at` (provenance) are both stored; neither is altered by synchronisation; the only time change is the audited correction in FR-30. | AC-11.1 An offline event shows both times after sync. AC-11.2 Re-syncing or refreshing never changes either timestamp. AC-11.3 A direct attempt to update an original timestamp outside the correction flow fails. |
| FR-12 | Offline events are flagged; device-clock discrepancies are detected. *(approved D4/K2, offline req 6)* | M | Events carry an `captured_offline` flag. At synchronisation the device clock is compared with the server clock; a discrepancy above threshold (proposed: 5 minutes — *(recommended)*, §27 Q8) is recorded and the row is flagged for review. **The system never silently rewrites a timestamp.** | AC-12.1 An offline-captured event is identifiable as such after sync. AC-12.2 With the device clock set 2 hours wrong in airplane mode, the event syncs **and** raises a visible clock-discrepancy flag. AC-12.3 The stored device timestamp is unchanged after the flag is raised. |
| FR-13 | Duplicate attendance records are prevented on retry/interruption. *(approved D4, offline req 7)* | M | Each event carries a client-generated unique ID generated **at the moment of capture**; the server accepts each ID once (idempotent upsert); retries and interrupted syncs are no-ops. | AC-13.1 Retrying a sync after a mid-flight interruption creates exactly one server row. AC-13.2 The same event ID submitted twice yields one record. |
| FR-14 | Unsynced records survive refresh and temporary browser closure. *(approved D4, offline req 10)* | M | Durable local store (IndexedDB), not in-memory or per-tab state. | AC-14.1 Sign in offline, refresh the page → records and pending state remain. AC-14.2 Close and reopen the browser (or PWA) → unsynced records remain and sync on reconnect. |
| FR-15 | Server writes are authenticated and time-bounded. *(approved K1)* | M | Only authenticated sessions may submit events; a submitted `device_event_at` must fall within an acceptable window (proposed: same calendar day and ≤ 12 hours before receipt — *(recommended)*, §27 Q8) to defend against back-dating; out-of-window events are rejected with a clear error. | AC-15.1 An unauthenticated request cannot create or modify records. AC-15.2 An event timestamped more than the allowed window in the past is rejected. AC-15.3 Legitimate same-day offline events within the window are accepted. |
| FR-16 | Cross-device conflicts resolve first-write-wins and are flagged. *(approved K6)* | M | If two offline devices act on the same child, the first event synchronised wins; the later conflicting event is stored and **flagged**, never silently discarded or silently overwriting. | AC-16.1 Two devices sign out the same child offline → one sign-out time stands; both events exist in the audit trail. AC-16.2 A flagged conflict is visible to staff; nothing is silently overwritten. |

### 10.3 Lists and display

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-17 | "In school" list. *(existing F5, U3)* | M | Every child with no sign-out time, newest first; each row shows name, sign-in time and a Sign out button. Works offline from local + synced data. | AC-17.1 The list shows every unsynced and synced child with no sign-out time, newest first. AC-17.2 The list is correct in airplane mode. |
| FR-18 | Sign-out sets the time once; a second tap changes nothing. *(existing F6)* | M | One tap; time captured automatically; repeat taps are no-ops (client guard + server-side once-only rule). | AC-18.1 Tapping Sign out twice does not change the recorded time — online or offline. AC-18.2 After sign-out the row moves to "Signed out today". |
| FR-19 | Live in-school counter. *(existing screen spec)* | M | Small counter showing how many children are currently in school; used for the end-of-day check. | AC-19.1 The counter equals the number of rows in the "In school" list and updates after every action. |
| FR-20 | "Signed out today" list with Send message control. *(existing F11/U5 — priority elevated, see note)* | M | Each row shows name, both times, a Send message control, and message status. *(Priority elevated from Should to Must because existing Must-have F7 "Send message button opens a WhatsApp link" has no home without this list — see §27 Q10.)* | AC-20.1 Every signed-out child appears with both times. AC-20.2 The Send message control is present on each row. |
| FR-21 | Search the lists by name. *(existing F12)* | S | Search box above the lists filters both lists by name, works against locally available data. | AC-21.1 Typing a partial name shows only matching rows in both lists. AC-21.2 Clearing the search restores all rows. |
| FR-22 | Times display in Africa/Lagos, 12-hour format, with the date. *(existing F13)* | M | Formatted with `Intl.DateTimeFormat` so every phone shows the same time; format `8:47 AM` and `Sat 31 Oct 2026`. | AC-22.1 Displayed times match Lagos time regardless of the device's own time zone setting. AC-22.2 Times render in 12-hour format with the date shown. |
| FR-23 | Duplicate warning on sign-in. *(existing F9, offline-degraded per K5)* | S | Warn when the same name and phone are already signed in and not yet signed out. Checks local device data plus last successful sync — **best-effort offline** (approved K5). | AC-23.1 Signing in the same name + phone that is currently "in school" raises a warning. AC-23.2 The warning can be dismissed to proceed (warn-don't-block — *(recommended)*, §27 Q4). AC-23.3 Warning check functions offline against local data. |

### 10.4 Parent messaging

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-24 | Send message opens WhatsApp with the number and pre-written text. *(existing F7; D8)* | M | Opens `https://wa.me/<number-without-+>?text=<url-encoded message>` with the text **fully pre-filled** so staff only tap Send. If WhatsApp is unavailable, offer "copy text" fallback. | AC-24.1 Tapping Send message opens WhatsApp addressed to the parent's number with the message pre-filled. AC-24.2 The text contains both times and the date as displayed in the app. AC-24.3 If WhatsApp cannot be opened, the message text is offered for copy so SMS can be used instead (existing risk mitigation). |
| FR-25 | Message template with school name from settings. *(existing template)* | M | `Hello, this is [School name]. [Student name] arrived at [8:47 AM] and left at [12:15 PM] on [Sat 31 Oct 2026]. Thank you.` — `[School name]` from environment setting; times from the record (corrected time if one exists). | AC-25.1 The message names the school, child, date, arrival and departure times. AC-25.2 Times and date use Africa/Lagos 12-hour format identical to on-screen values. |
| FR-26 | Pending message queue visible until used. *(approved D4, offline req 9)* | M | Rows whose WhatsApp message has not been opened are visibly "Pending" — including while offline, when sending is impossible. The list shows exactly which messages still need to be sent. | AC-26.1 Offline sign-out leaves the row in "Pending message" state. AC-26.2 After reconnect, pending messages remain listed until opened. AC-26.3 End of day: staff can identify every child whose message has not been opened. |
| FR-27 | "Message opened" marker. *(existing F11, renamed per D5)* | S | Set when the WhatsApp link is successfully opened (online only). Self-reported: the app cannot confirm the message was actually sent. | AC-27.1 Opening the WhatsApp link marks the row "Message opened". AC-27.2 The marker is never set when the link cannot be opened (e.g. offline). AC-27.3 The UI wording is "Message opened", not "Message sent". |
| FR-28 | Privacy notice to parents. *(existing security requirement; resolved wording — recommended)* | M | The message carries one short sentence telling parents what is recorded and why (existing security requirement; source template omitted it). Proposed: *"We record arrival and departure times for your child's safety."* | AC-28.1 The message text includes a statement of what is recorded and why. AC-28.2 Final wording approved by the school (§27 Q7). |

### 10.5 Corrections and review

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-29 | Edit name and phone; every edit logged. *(existing F10, U6)* | S | Edit window opens from a pencil icon; changes name and phone only; times display read-only in this window; each edit writes who/when + old/new values to the audit log. Role restriction is a process rule (D6). | AC-29.1 Name and phone can be edited; times cannot be edited in this window. AC-29.2 Every edit writes an audit row with editor name, timestamp, and old/new values. |
| FR-30 | Simple time correction with original preserved. *(approved K3; offline req 8)* | M | Authorised staff **edit the recorded time directly** (the recorded sign-in/sign-out time field becomes editable in correction mode). Saving updates the displayed record and writes an audit entry containing the original value, the new value, who and when. The original timestamp is never lost. The parent message uses the corrected time when one exists. | AC-30.1 From the row, a staff member can change a recorded time and save; the new time displays and is used in the message. AC-30.2 The audit log retains the original time, new time, editor name and edit time. AC-30.3 After a correction the record shows it has been corrected (no silent change). AC-30.4 This is the **only** path that changes a time; direct updates outside it still fail. |
| FR-31 | Full-day review list. *(existing U7)* | S | One list showing every child, both times, who recorded each action, sync state, conflict flags, correction status, and message status. | AC-31.1 The view shows all records for the day with both times and attribution. AC-31.2 Message, sync and conflict status are visible per row. |
| FR-32 | Conflict flag visible on affected rows. *(approved K6)* | M | Any row involved in a first-write-wins conflict carries a visible flag identifying it for lead-teacher review. | AC-32.1 After an offline conflict, the affected row shows a conflict indicator in the list and in the day review. |

### 10.6 Data utility and housekeeping

| ID | Requirement (description) | Pri | Expected behaviour | Acceptance criteria |
|---|---|---|---|---|
| FR-33 | Download the day's records as CSV. *(existing F14)* | C | Export all of today's rows with both timestamps, attribution, sync state, correction and message status. | AC-33.1 A CSV file downloads containing every row for the day with the documented columns. |
| FR-34 | Sign out all remaining children. *(existing F15, amended per D2)* | C | "Sign out all remaining" signs out every child still in school, recording the **actual execution time** (server-side) for each; individual rules still apply (once only). | AC-34.1 One action signs out all rows currently without a sign-out time. AC-34.2 Each recorded time equals the moment of execution, not a chosen clock time. AC-34.3 Already-signed-out rows are unaffected. |
| FR-35 | Local day-data purged after day close. *(approved K7a)* | M | After all events are synchronised and the day is closed (runbook step), locally stored children's names, phone numbers and records are purged from the device. Older-than-today synced data is cleared on next app start. | AC-35.1 With everything synced, closing the day removes attendance data from local storage. AC-35.2 Unsynced records are **never** purged. AC-35.3 The next session starts with an empty local store. |

---

## 11. Detailed Feature Specifications

### 11.1 Screen 1 — Login *(existing + offline addition)*

| Element | Spec |
|---|---|
| Fields | First name; PIN (password-style input, numeric ≥ 6 digits). |
| Button | Log in (large, primary, thumb-reachable). |
| States | *Default* — form ready. *Loading* — button disabled while verifying. *Error* — wrong PIN message; rate-limit message with remaining wait time. *Offline, no session* — "Internet needed to log in. Connect and try again." *Offline, valid cached session* — straight through to attendance. |
| Behaviour | PIN verified server-side (FR-01). On success, session cached for offline continuity (FR-04). |

### 11.2 Screen 2 — Attendance (single page, three parts) *(existing + offline additions)*

1. **Sign-in form (top):** student name, parent phone, Sign in button. After save the form clears; the name field is focused for the next child. No time input, ever (FR-07).
2. **In-school list:** rows = name, sign-in time, Sign out button; newest first (FR-17). Each row carries a sync-state icon (synced / pending / failed / conflict / corrected).
3. **Signed-out today list:** rows = name, both times, Send message control, status chip: *Pending (offline)* / *Not opened* / *Message opened* (FR-20, FR-26, FR-27).

**Global chrome:** search box above the lists (FR-21); in-school counter (FR-19); **sync badge** — "All synced" / "N pending" / "N failed — Retry" (FR-10); staff first name displayed.

### 11.3 Sync indicator

| State | Visual | Action available |
|---|---|---|
| All synced | Neutral badge | — |
| Pending (offline) | Amber badge + per-row icon | None — automatic |
| Syncing | Animated | — |
| Failed | Red badge + per-row icon | Retry (also auto-retries) |
| Conflict flagged | Warning icon on row | Opens row for lead-teacher review |

### 11.4 Pending message queue

Embedded in the "Signed out today" list (no separate screen): a filter/chip "Messages outstanding: N" shows children whose message has not been opened (FR-26). This is the end-of-day checklist for SC3.

### 11.5 Edit window *(existing + correction mode)*

- Opens from a pencil icon on any row.
- **Mode A (default):** edit name and phone; times shown read-only (FR-29).
- **Mode B (correction):** the recorded time field becomes editable (FR-30); saving writes an audit entry (original, new, editor, when) and marks the row "corrected".
- Technical note: the database time-lock trigger must be adjusted so that **only** this audited correction path can change a time — all other updates continue to fail. *(Engineering impact flagged; no code in this document.)*

### 11.6 Day review *(existing U7)*

Full-day table: name, sign-in time, sign-out time, who signed in, who signed out, corrected?, conflict?, sync state, message status. Basis for the end-of-day runbook checks. CSV export control lives here (FR-33).

### 11.7 Design constraints *(existing)*

Phone held in one hand, large buttons, two screens plus one edit window, PWA "add to home screen".

---

## 12. User Stories

Format: *As a [user], I want [capability], so that [benefit].* Stories U1–U8 are the source stories reformatted to the required structure without changing their meaning; U9–U15 cover the approved offline-first requirements.

| ID | User story | Acceptance summary ("done when") |
|---|---|---|
| U1 | As gate staff, I log in with the PIN and my name, so that only staff can use the app. | Wrong PIN shows an error; right PIN opens the main screen with my name shown. |
| U2 | As gate staff, I sign a child in by typing their name and parent number, so that their arrival is recorded without delay. | The child appears in "In school" with the sign-in time captured automatically (never typed). |
| U3 | As gate staff, I see who is currently in school, so that I always know who is present. | The list shows name, sign-in time and a Sign out button, newest first — including while offline. |
| U4 | As gate staff, I sign a child out with one tap, so that departure is recorded at the moment of hand-over. | The sign-out time is saved once and the child moves to "Signed out today"; a second tap changes nothing. |
| U5 | As gate staff, I send the parent a message after sign-out, so that they receive proof of attendance. | WhatsApp opens with the parent's number and a pre-written text with both times; only a tap of Send is needed. |
| U6 | As lead teacher, I fix a typo in a name or phone number, so that records stay accurate. | Name and phone can be edited; attendance times cannot be edited in this window; every edit is logged. |
| U7 | As lead teacher, I check the whole day, so that I can verify every child is accounted for. | One list shows every child, both times, who recorded them, and message/sync status. |
| U8 | As a parent, I get a clear message, so that I know exactly when my child arrived and left. | The text names my child and gives the date, arrival time and departure time. |
| U9 | As gate staff, I can sign children in and out with no internet, so that a network outage never stops the gate or forces me back to paper. | In airplane mode all actions succeed locally and the lists update instantly. |
| U10 | As gate staff, I can see which records have synchronised and which have not, so that I know nothing has been lost. | A visible badge and per-row indicators show pending, synced and failed states. |
| U11 | As gate staff, I want pending records to sync automatically when the connection returns, so that I never have to re-enter anything. | On reconnect, pending events upload without action; failures are flagged and retryable without duplicating records. |
| U12 | As gate staff, my unsaved records survive closing and reopening the app, so that a refresh or crash cannot lose attendance data. | Records and pending states persist across refresh and browser closure. |
| U13 | As gate staff, I can see which parent messages still need to be opened, so that no parent is forgotten before the day ends. | A visible list/count of outstanding messages remains until each is opened. |
| U14 | As lead teacher, I can correct a recorded time simply, so that a wrong device clock or a forgotten entry can be fixed with the truth preserved. | Editing the recorded time saves the correction, keeps the original in the audit log, and flags the record as corrected. |
| U15 | As lead teacher, I am alerted when two phones made conflicting entries for the same child, so that I can resolve it deliberately. | Conflicting rows are flagged (first write wins); nothing is silently overwritten. |
| U16 | As the school, I want every recorded action attributed to a named staff member, so that we can review who did what. | Each record carries the login first name for sign-in, sign-out and corrections. |

---

## 13. Acceptance Criteria

Objective, end-to-end, testable scenarios. Each maps to FRs; all must pass on a real phone, on mobile data **and** Wi-Fi, and in airplane mode where stated.

**AC-G1 — Login and access**
Given no session, when a wrong PIN is entered, then access is denied with an error (FR-01, FR-03); when the correct PIN is entered online, then the main screen opens showing the name; when the browser is closed and reopened within 12 hours, then the session and lists are intact (FR-02, FR-14); when five wrong PINs are entered, then a 5-minute wait is enforced (FR-03); when the database URL and service role key are inspected in page source and network calls, then neither appears (FR-01, §18).

**AC-G2 — Online capture**
Given an online device, when a child is signed in with name and phone, then the child appears in "In school" with an automatically captured time (FR-05, FR-07, FR-09, FR-17); when `0803 123 4567` is entered, then it is stored as `+2348031234567` (FR-06); when a blank name or phone is submitted, then it is refused (FR-05).

**AC-G3 — Offline capture and persistence**
Given airplane mode, when children are signed in and out, then all actions succeed locally with instant list updates and a "pending" state (FR-07, FR-08, FR-17, FR-18); when the page is refreshed and the browser reopened, then all unsynchronised records remain (FR-14); when connectivity returns, then pending events sync automatically and transition to "synced" (FR-09, FR-10, FR-11).

**AC-G4 — Integrity, dual timestamps, idempotency**
For an offline event, after sync both `device_event_at` and `server_received_at` exist and neither changes on re-sync (FR-11); an offline event is flagged as offline-captured (FR-12); when a sync is retried after interruption, then exactly one record exists (FR-13); when a direct update of an original timestamp is attempted outside the correction flow, then it fails (FR-11, FR-30).

**AC-G5 — Clock discrepancy**
Given airplane mode with the device clock set 2 hours wrong, when a child is signed in and connectivity returns, then the event syncs, the stored device time is unchanged, and a visible clock-discrepancy flag is raised (FR-12). *(Replaces the source test item "saved time is still correct" — approved K2.)*

**AC-G6 — Concurrency and conflict**
Given two phones signed in, when both act simultaneously online, then both records appear on both phones after refresh with no loss or duplication (SC4); given both act offline on the same child, then the first synchronised write wins, the conflicting event is retained and flagged, and nothing is silently overwritten (FR-16, FR-32).

**AC-G7 — Sign-out semantics**
When Sign out is tapped, the time is captured automatically once; when tapped again — online or offline — nothing changes and the row moves to "Signed out today" (FR-18, FR-20).

**AC-G8 — Messaging**
When Send message is tapped online, WhatsApp opens with the correct number and pre-filled text containing both times, the date, the school name and the privacy sentence (FR-24, FR-25, FR-28); when offline, the message shows as pending and no marker is set (FR-26); when the link opens, the row is marked "Message opened" (FR-27); names with apostrophes or accents (O'Brien, Chidiebere) render correctly (FR-25); times in the message match on-screen values in Africa/Lagos 12-hour format (FR-22, FR-25).

**AC-G9 — Corrections and audit**
When a name or phone is edited, an audit row is written with who/when and old/new values (FR-29); when a recorded time is corrected, the new time displays and is used in the message, the original is preserved in the audit log, and the row shows "corrected" (FR-30); times in the edit window's default mode remain read-only (FR-29).

**AC-G10 — End of day**
Given 60 test children signed in across two phones, the page stays fast (§19); the in-school counter equals the in-school list (FR-19); the outstanding-messages view identifies every unopened message (FR-26); all records are synced (FR-10); closing the day purges local data only after full sync (FR-35); CSV export contains all day rows (FR-33).

---

## 14. User Workflows and Business Processes

### 14.1 Normal arrival (online) *(existing)*
1. Child arrives → staff type name + parent phone → tap **Sign in**.
2. Device timestamp captured automatically (FR-07); record saved locally, synced immediately (FR-09).
3. Child appears in "In school"; form clears for the next child.

### 14.2 Normal arrival (offline) *(approved D4)*
1–2. Same as above; no connection → event saved locally, shown as **Pending** (FR-08, FR-10).
3. Child appears in "In school" as normal — the gate never stops.

### 14.3 Departure and message
1. Child is collected → tap **Sign out** on the row (one tap, once) → row moves to "Signed out today".
2. Tap **Send message** → WhatsApp opens with the number and pre-written text → staff tap Send in WhatsApp → row marked "Message opened".
3. Offline: the row shows **Pending message**; after reconnection the message can be opened; outstanding list drives completion (FR-26).

### 14.4 Synchronisation (automatic) *(approved D4)*
1. Any connectivity return or app open triggers sync of pending events.
2. Server accepts each event once by unique ID; records device and server timestamps; flags offline capture and any clock discrepancy.
3. UI advances Pending → Synced, or → Failed (retry available, never duplicating).
4. Conflicts are resolved first-write-wins and flagged for review.

### 14.5 Correction flow *(approved K3)*
1. Lead teacher opens the row → corrects name/phone (Mode A) or the recorded time (Mode B).
2. Save → record updates, audit entry written (original, new, who, when), row marked corrected.
3. The parent message uses the corrected time.

### 14.6 Network failure contingency *(amended — paper is now last-resort only)*
- **Normal case:** no paper needed — the app works offline (replaces the source runbook's paper-first procedure).
- **Paper remains as fallback only for:** expired session with no connectivity (FR-04), total device failure/battery loss. Any paper-recorded child is then entered into the app; the entry time will be used as the recorded time and should be corrected via FR-30, with the real time used in the parent message.

### 14.7 End-of-day process *(existing runbook, updated)*
1. Check the in-school counter is zero or accounted for against reality.
2. Check the outstanding-messages list is empty (SC3).
3. Verify all records synced ("All synced" badge).
4. Close the day → local data purged (FR-35).
5. Photograph the paper sheet (if any was used).
6. Change the staff PIN.
7. *(School owner, end of term)* export records, then purge the database manually outside the app (D3).

---

## 15. Business Rules

| ID | Rule | Source |
|---|---|---|
| BR-01 | All staff share one PIN; each person enters their own first name at login, which is stamped on every record they create. | Existing *(attribution caveat documented, D6)* |
| BR-02 | PIN must be at least 6 digits; changed after every session day; shared by word of mouth, not in group chat. | Existing |
| BR-03 | After 5 failed PIN attempts from one device, block further attempts for 5 minutes (online only). | Existing |
| BR-04 | Attendance times are captured automatically; no user may type a time during normal operation. | Existing F4, amended K1 |
| BR-05 | `device_event_at` is the attendance time of record; `server_received_at` records server receipt; both are immutable once synchronised. | Approved K1 |
| BR-06 | A sign-out time may be set exactly once per record; subsequent attempts are no-ops. | Existing F6 |
| BR-07 | Attendance records may never be deleted through the application. | Existing |
| BR-08 | The only permitted change to a time is an authorised correction, which must preserve the original in the audit log and flag the record. | Approved K3 |
| BR-09 | Name and phone may be edited; every edit logs editor, time, and old/new values. | Existing F10 |
| BR-10 | Phone numbers are stored in international `+` format; Nigerian local numbers normalise to `+234…`. | Existing F3 |
| BR-11 | Server accepts events only from authenticated sessions, only once per event ID, and only within the same-day acceptance window. | Approved K1, FR-13, FR-15 |
| BR-12 | Conflicting offline actions resolve first-write-wins; nothing is silently overwritten or discarded. | Approved K6 |
| BR-13 | The "Message opened" marker is set only when the WhatsApp link is actually opened; the app makes no claim of delivery. | Approved D5 |
| BR-14 | The parent message is opened from the staff phone via a pre-filled WhatsApp link; the server never sends messages. | Existing |
| BR-15 | All times are displayed in Africa/Lagos, 12-hour format, with the date. | Existing F13 |
| BR-16 | Role restrictions (lead teacher edits/corrections) are a process rule, not a technical control; the audit log is the accountability mechanism. | Approved D6 |
| BR-17 | Local device data is purged after day close, once fully synced; unsynced data is never purged. | Approved K7a |
| BR-18 | End-of-term retention: school owner exports records, then deletes them manually outside the application; the in-app no-delete rule is unchanged. | Approved D3 |
| BR-19 | Bulk sign-out records the actual execution time, not a chosen clock time. | Approved D2 |

---

## 16. Data Requirements

### 16.1 Server-side data (amended from source schema; columns additive)

**`attendance` (main proof table)**

| Column | Type | Notes | Source |
|---|---|---|---|
| `id` | uuid | PK, generated | Existing |
| `event_id` | uuid | Client-generated at capture; **idempotency key** (FR-13) | Approved D4 |
| `student_name` | text | Required | Existing |
| `parent_phone` | text | Required, stored `+234…` | Existing |
| `device_event_at` | timestamptz | **Time of record**, captured automatically; immutable except via audited correction | Approved K1 (replaces role of `signed_in_at`/`signed_out_at` as the truth) |
| `signed_in_at` / `signed_out_at` | timestamptz | Retained as the record's in/out fields; sign-out set exactly once; changeable only via FR-30 correction | Existing, amended K3 |
| `server_received_at` | timestamptz | Default `now()`; provenance timestamp; never altered | Approved K1 |
| `captured_offline` | boolean | Flags offline origin (FR-12) | Approved D4 |
| `device_id` | text | Identifies the capturing device (skew attribution) | Approved D4 |
| `clock_skew_seconds` | numeric, nullable | Measured discrepancy at sync; row flagged if beyond threshold | Approved D4/K2 |
| `conflict_flag` | boolean | Set when first-write-wins overrode a later event | Approved K6 |
| `corrected_flag` / correction refs | — | Marks rows corrected under FR-30 | Approved K3 |
| `signed_in_by`, `signed_out_by` | text | Staff first name from login | Existing |
| `message_opened_at` | timestamptz | Set when the WhatsApp link opens (renamed from `message_sent_at`) | Approved D5 |
| `created_at` | timestamptz | Default `now()` | Existing |

**`attendance_edits`** — existing audit table, extended: existing name/phone old/new columns, **plus** time old/new values, `edited_by`, `edited_at` (FR-29, FR-30).

**`login_attempts`** — existing; failed PIN attempts per device for rate limiting (FR-03).

**Protection (existing, unchanged):** RLS enabled on all tables with **no policies** (public key reads/writes nothing); only server code with the service role key accesses data; no-delete trigger retained; time-lock trigger retained **with one adjustment** so that only the audited correction path (FR-30) may change a time — all other time updates still fail.

### 16.2 Local (device) data *(approved D4, K7a)*

| Store | Contents | Lifetime |
|---|---|---|
| Outbox | Unsynced events (event ID, payload, device timestamp, state) | Until acknowledged by server; **never purged unsynced** |
| Day cache | Today's synced records for offline list rendering | Until day close purge (FR-35) / cleared on next-session start |
| Pending messages | Rows whose WhatsApp link has not been opened | Until opened, then cleared |
| Session | Signed session token + expiry (no PIN, no PIN verifier) | 12 hours |

Technology constraint: durable browser storage (IndexedDB-class), surviving refresh and closure (FR-14).

### 16.3 Data volumes
~60 children × (1 sign-in + 1 sign-out) ≈ 120 records/day, plus audit rows. Single-day scope (D10).

### 16.4 Retention
- Operational: records retained until end of term; school owner exports CSV, then **manually purges outside the app** (BR-18, D3).
- Device: purged at day close (BR-17, D4).

---

## 17. Notification Requirements

*(scope confirmation: manual WhatsApp only)*

| ID | Requirement | Pri |
|---|---|---|
| N1 | The **only** notification channel is WhatsApp, opened from the staff phone via a pre-filled `wa.me` link. No in-app notifications, no push, no email, no SMS from the system, no WhatsApp Business API, no cost. *(existing)* | M |
| N2 | Message content per template FR-25/FR-28, times formatted Africa/Lagos 12-hour (FR-22). | M |
| N3 | Messages cannot be opened offline; they remain in a visible pending queue until opened (FR-26). | M |
| N4 | "Message opened" status is set only on successful link opening (FR-27). | S |
| N5 | Fallback when WhatsApp is unavailable: message text offered for copy so staff may send it by SMS (existing risk mitigation). | S |

---

## 18. Security and Privacy Requirements

*(existing requirements carried forward, plus offline additions)*

| ID | Requirement | Source |
|---|---|---|
| S1 | PIN verified on the server; signed, HTTP-only session cookie (12 hours). | Existing |
| S2 | No database keys in the browser. All reads/writes via server code using the Supabase **service role key**, held only in Vercel environment variables — never in front-end code, page source, or chat. | Existing |
| S3 | Row Level Security enabled on all tables with **no policies**, blocking the public key entirely. | Existing |
| S4 | PIN guessing limited: 5 wrong attempts → 5-minute wait (online). | Existing |
| S5 | PIN ≥ 6 digits, changed after session day, shared verbally not in group chat. | Existing |
| S6 | HTTPS only (Vercel). | Existing |
| S7 | Attribution: staff first name stored on every action; explicitly documented as *who said they did it*, not cryptographic proof (shared PIN). | Existing, D6 |
| S8 | Retention: keep to end of term → export → owner-level manual purge outside the app. | Existing, D3 |
| S9 | Privacy notice: parents are told what is recorded and why, in the first message (FR-28). | Existing (template gap closed) |
| S10 | **Device data at rest:** children's names and parent phones are stored locally on staff devices. Mitigations: staff phones must have a **screen lock/passcode** (runbook requirement), local data purged after day close (FR-35), no sensitive data in system notifications. | Approved K7a |
| S11 | Offline authentication stores **no PIN and no PIN verifier** on the device; only the signed session token with expiry. | Approved K4 |
| S12 | Server-side acceptance guards: authenticated sessions only, one acceptance per event ID, same-day/≤12-hour timestamp window, all offline events flagged, all discrepancies recorded — this is the back-dating defence that the server clock previously provided. | Approved K1, FR-12/FR-15 |
| S13 | Corrections and edits are audit-logged (who/when/original), giving after-the-fact accountability despite the shared PIN. | Approved K3/D6 |

---

## 19. Performance Requirements

Baseline targets marked *(recommended)* require confirmation (§27 Q8).

| ID | Requirement | Target | Source |
|---|---|---|---|
| P1 | Sign-in recorded within | < 15 seconds (goal) | Existing O1 |
| P2 | Local (offline) action response | Immediate feel; UI updates < 200 ms *(recommended)* | Approved D4 |
| P3 | Online server action response | < 1.5 s on mobile data *(recommended)* | *(recommended)* |
| P4 | Scale | 60 children ≈ 120 events/day; 2 (up to 4) concurrent staff phones | D7, existing |
| P5 | List performance | Remains responsive at 60+ rows; scroll and search stay fluid (existing test: "sign in 30 test children, the page stays fast" — re-verified at 60) | Existing, D7 |
| P6 | Synchronisation | Automatic on reconnect; batch of pending events completes within seconds of connectivity return *(recommended)* | Approved D4 |
| P7 | Availability | App must be usable with **zero** connectivity for all capture functions (hard requirement) | Approved D4 |

---

## 20. Usability and Accessibility Requirements

| ID | Requirement | Source |
|---|---|---|
| U-A1 | Designed for a phone held in one hand with large buttons; primary actions thumb-reachable. | Existing |
| U-A2 | Two screens + one edit window; no nested navigation during gate operations. | Existing |
| U-A3 | Sign-in form clears and refocuses after each save to minimise typing. | Existing |
| U-A4 | Status must be understandable without training: sync states and message states use icon + text, not colour alone. *(recommended)* | Approved D4 |
| U-A5 | Minimum touch target ≈ 44×44 px; body text ≥ 16 px; contrast meeting WCAG AA. *(recommended)* | *(recommended)* |
| U-A6 | Destructive/irreversible actions are one-tap but reversible in effect (sign-out is once-only — hence clear confirmation of state on the row). | Existing F6 |
| U-A7 | Installable as a home-screen PWA ("add to home screen") so it opens like a normal app. | Existing |
| U-A8 | Special characters in names (O'Brien, Chidiebere) render correctly everywhere. | Existing test item |
| U-A9 | No error state may block the gate: offline is a state, not an error; all other errors state what to do next. *(recommended)* | Approved D4 |

---

## 21. Error Handling and Edge Cases

| # | Scenario | Required behaviour | FR ref |
|---|---|---|---|
| E1 | No connectivity at sign-in/sign-out | Save locally, show Pending, continue working; auto-sync on return | FR-08/09/10 |
| E2 | Sync fails after retry | Flag Failed with Retry; never lose the event; never duplicate | FR-10/13 |
| E3 | Sync interrupted mid-flight | Idempotent retry — exactly one record | FR-13 |
| E4 | Page refresh / browser closed with pending records | Records and states persist | FR-14 |
| E5 | Device clock wrong (any amount) | Detected at sync, flagged, original preserved, never silently rewritten | FR-12 |
| E6 | Two devices act on the same child offline | First-write-wins, conflict flagged, both events retained | FR-16/32 |
| E7 | Double-tap Sign out | Second tap is a no-op | FR-18 |
| E8 | Duplicate sign-in of a child already in school | Warning (best-effort offline); dismissible | FR-23 |
| E9 | Invalid / unnormalisable phone number | Reject with clear message | FR-06 |
| E10 | Blank name or phone | Refuse with message | FR-05 |
| E11 | WhatsApp not installed / cannot open | Offer message text for copy (SMS fallback) | FR-24 |
| E12 | Offline while a message is due | Pending message shown; no marker set until opened | FR-26/27 |
| E13 | Session expires while offline | Clear "connect to log in" message; no data exposed; paper fallback | FR-04 |
| E14 | Wrong PIN | Error; after 5 attempts, 5-minute wait with visible countdown/message | FR-01/03 |
| E15 | Event timestamp outside acceptance window | Reject with clear error; staff must not back-date | FR-15 |
| E16 | Local storage unavailable/full | Surface a blocking, explicit error — do not pretend the record was saved | FR-08 *(recommended)* |
| E17 | Server returns error on online action | Show error with retry; keep local copy pending | FR-10 |
| E18 | Conflict discovered after sync | Row flagged; lead teacher reviews; nothing overwritten | FR-16/32 |
| E19 | Correction applied to a record already messaged | Message for that child uses the corrected time on next open; flag prompts re-send consideration *(recommended)* | FR-30 |
| E20 | Network drops mid-day | No effect on capture (offline-first); paper only for device/session failure | §14.6 |

---

## 22. Reporting and Analytics Requirements

| ID | Requirement | Pri |
|---|---|---|
| R1 | Full-day review list: every child, both times, who recorded each action, sync/correction/conflict status, message status (FR-31). | S |
| R2 | In-school counter for the end-of-day reconciliation (FR-19). | M |
| R3 | Outstanding-messages view to guarantee SC3 (FR-26). | M |
| R4 | CSV export of the day's records (FR-33). | C |
| R5 | **Product analytics/telemetry: none.** No tracking, no third-party analytics. *(recommended confirmation, §27 Q9)* | — |

No other reports, dashboards, or termly analytics in scope (future enhancement).

---

## 23. External Integrations

| Integration | Nature | Notes |
|---|---|---|
| **Supabase (Postgres)** | Datastore | Server-side only via service role key; RLS on with no policies; region nearest Lagos (London/Frankfurt per build plan). |
| **Vercel** | Hosting/serverless | HTTPS automatic; function region set near Supabase region; environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STAFF_PIN`, `SESSION_SECRET`, `SCHOOL_NAME`. |
| **WhatsApp (consumer app)** | Message hand-off | `wa.me` deep link with pre-filled text; **no API, no account, no cost**; opened from the staff phone. Detects no delivery (D5). |
| **Device browser storage** | Local persistence | IndexedDB-class store; part of the offline contract (§16.2). |

No other integrations. The earlier plan's Google Sheet/Form fallback is referenced in the source build plan but the document itself was not supplied *(dependency, §24)*.

---

## 24. Assumptions and Dependencies

| # | Assumption / dependency | Type |
|---|---|---|
| A1 | The combined source document is the sole source of truth (D1). | Assumption |
| A2 | School name, and any school-specific strings, supplied as placeholders until provided (D9). | Assumption |
| A3 | Supabase project and Vercel account exist or will be created (source open question — pending confirmation, §27 Q2). | Dependency |
| A4 | Staff phones have WhatsApp installed; the sending phone has the school's WhatsApp (runbook). | Dependency |
| A5 | Staff phones support home-screen PWA install; **screen lock/passcode enabled** (K7a). | Dependency |
| A6 | Staff phones' browsers support durable local storage (IndexedDB). If iOS Safari is used, background sync is unavailable — sync must trigger on app open/focus (technical constraint, §26). | Assumption |
| A7 | Internet is generally available but unreliable at the gate; offline-first is the primary design (D4). | Assumption |
| A8 | ~60 children, 2 staff phones (D7). | Assumption |
| A9 | Single-day MVP for Saturday 31 Oct 2026; weekly reuse only as future work (D10). | Assumption |
| A10 | Fallback to "the Google Sheet and Form from the earlier plan" if the build fails — **that document was not supplied** (§27 Q3). | Dependency (unverified) |
| A11 | Delivery accepted as offline-first with schedule risk acknowledged (K7b). | Assumption |
| A12 | Paper sheet and pen still present at the gate as last-resort fallback (runbook). | Dependency |

---

## 25. Constraints and Limitations

| # | Constraint |
|---|---|
| C1 | **Deadline: Saturday 31 October 2026.** Build estimate originally ~5h20m; offline-first increases this — schedule risk explicitly accepted (K7b) with a defined cut order (§28). |
| C2 | **Zero-cost stack:** no paid messaging, no paid services beyond free tiers; WhatsApp via deep link only (D8 — no API, no bypass). |
| C3 | **Shared PIN:** one credential for all staff; role separation is procedural only (D6); attribution is self-declared. |
| C4 | **Device clock is untrusted:** offline event times are only as accurate as the device; mitigated by detection, flagging and correction — never silently (K2). |
| C5 | **Message cannot be confirmed sent:** the app proves only that WhatsApp was opened (D5). |
| C6 | **Offline duplicate warning is best-effort** — devices cannot see each other's unsynced data (K5). |
| C7 | **Single-day, single-school scope**; no multi-week history, no multi-tenant support (D10). |
| C8 | **No deletes through the app**, ever; retention purge is an owner-level external operation (D3). |
| C9 | PWA/browser platform limits: background sync not guaranteed (especially iOS) — sync also occurs on app open/focus (A6). |
| C10 | No parent-facing application of any kind. |

---

## 26. Risks and Mitigation Strategies

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RK1 | Internet drops at the school | Medium | Low | **Offline-first** (D4) — capture unaffected; paper retained only for session/device failure. |
| RK2 | Name or phone mistyped | High | Medium | Say the name back to the parent; edit window with full audit (FR-29). |
| RK3 | Staff forget to sign a child out | Medium | Medium | In-school counter checked against reality at end of day (FR-19, §14.7). |
| RK4 | PIN shared too widely | Medium | Medium | Change after session day; names on every record; audit log (BR-01/02). |
| RK5 | **Build runs late (amplified by offline-first)** | **High** | High | Cut order in §28; offline queue, PIN, dual timestamps, Lagos display are never cut; paper fallback; stakeholder accepted (K7b). |
| RK6 | Parent has no WhatsApp | Low | Low | Copy message text and send as SMS (FR-24 fallback). |
| RK7 | **Device clock wrong during offline capture** | Medium | High | Skew detection + flag at sync (FR-12); simple time correction with preserved original (FR-30); message text editable before send. |
| RK8 | **Records lost by device failure/refresh** | Medium | High | Durable local storage (FR-14); immediate sync when online; end-of-day sync check. |
| RK9 | **Sync duplicates from retries** | Medium | High | Client event IDs + server idempotent acceptance (FR-13); tested in AC-G4. |
| RK10 | **Conflicting offline entries from two phones** | Medium | Medium | First-write-wins + conflict flag (FR-16/32). |
| RK11 | **Local PII exposure on a lost/stolen staff phone** | Low | High | Screen-lock requirement, day-close purge, no PIN/verifier stored (S10/S11, FR-35). |
| RK12 | Back-dating attempt via clock manipulation | Low | High | Same-day acceptance window, offline flags, skew records, full audit (S12). |
| RK13 | iOS devices: no background sync → events linger | Medium | Medium | Sync on app open/focus as well as on reconnect; pending badge makes lingering visible (FR-10, A6). |
| RK14 | Single-day deadline with no contingency date | High | High | Runbook, paper fallback, documented cut order, Google Sheet fallback (dependency A10 unverified). |

---

## 27. Open Questions and Pending Decisions

| # | Question | Status |
|---|---|---|
| Q1 | **School name** for the message (placeholder in use, D9). | Pending stakeholder |
| Q2 | Which Supabase/Vercel accounts will be used, and do they exist? Also: which phone sends the parent messages (source open question)? | Pending stakeholder |
| Q3 | Please supply the "earlier plan" (Google Sheet/Form) referenced as fallback — or confirm it is not needed. | Pending stakeholder |
| Q4 | Duplicate warning (FR-23): confirm **warn-and-dismiss** (not block). | Recommended, awaiting confirmation |
| Q5 | Clock-skew flag threshold (proposed 5 minutes) and acceptance window (proposed same-day, ≤12 h). | Recommended, awaiting confirmation |
| Q6 | Performance targets in §19 (P2/P3/P6) — confirm or adjust. | Recommended, awaiting confirmation |
| Q7 | Final wording of the parent privacy sentence (FR-28). | Recommended, awaiting confirmation |
| Q8 | KPI targets in §6.2 — confirm. | Recommended, awaiting confirmation |
| Q9 | Confirm **no product analytics/telemetry** (R5). | Recommended, awaiting confirmation |
| Q10 | FR-20 priority elevated from Should → Must (F7 has no home without the signed-out list) — confirm the elevation. | Recommended, awaiting confirmation |
| Q11 | Have parents been told that arrival and departure times are recorded? (source open question; S9 provides in-message notice). | Pending stakeholder |
| Q12 | Confirm target devices (Android/iOS) — determines background-sync expectations (A6, RK13). | Pending stakeholder |

---

## 28. MVP Definition

**MVP = all Must Have requirements.** Required for Saturday 31 October 2026.

**MVP includes:** FR-01…FR-20, FR-22, FR-24…FR-28, FR-30, FR-32, FR-35 — specifically: PIN login + 12-hour session + rate limiting + offline session continuity; automatic timestamp capture; full offline capture with local queue, automatic sync, visible sync states, dual timestamps, offline flags + clock-skew detection, idempotency, persistence across refresh, acceptance window, conflict resolution; in-school and signed-out lists, counter, Lagos display; WhatsApp pre-filled link, message template + privacy sentence, pending-message queue; simple time correction with audit; conflict visibility; day-close local purge.

**Cut order if time is short** *(existing order, offline additions protected):*
1. CSV download (FR-33, C)
2. Search (FR-21, S)
3. Edit window for name/phone (FR-29, S)
4. Duplicate warning (FR-23, S)

**Never cut:** PIN login, time integrity (dual timestamps, idempotency, acceptance window, audit), **the entire offline capture/sync/persistence chain**, the Lagos time display, the pending-message queue, or the day-close purge.

**Should Have (ship if time allows):** FR-21, FR-23, FR-27, FR-29, FR-31.
**Could Have (next iteration):** FR-33, FR-34.

---

## 29. Future Enhancements

*(existing "later improvements" unchanged)*

- Individual staff logins instead of one shared PIN.
- QR cards so staff scan instead of typing.
- Automatic messages by SMS or the WhatsApp Business API.
- Student list imported once, so staff pick a name instead of typing it.
- Daily and termly attendance reports.
- **New:** weekly/multi-session reuse — day-boundary model, per-week history and reports (follows from D10).
- **New:** encrypted local storage and remote wipe for lost devices.
- **New:** automated conflict resolution heuristics and sync telemetry for staff phones.

---

## 30. Final Product Acceptance Criteria

The product is accepted for handover when **all** of the following are demonstrated on real phones, on both mobile data and Wi-Fi:

1. **Access:** wrong PIN refused; 5 wrong PINs trigger the 5-minute wait; main screen unreachable without login; no database URL or service role key in page source/network (AC-G1).
2. **Capture:** sign-in of a child completes well under 15 seconds; times are never typed; blank fields refused; phone normalisation verified (AC-G2).
3. **Offline:** in airplane mode, sign-in/sign-out work fully; lists update instantly; pending indicators shown; records survive refresh and browser closure (AC-G3).
4. **Sync:** on reconnection, all pending events upload automatically with visible state transitions; no event is lost; no duplicate is created on retry (AC-G3, AC-G4).
5. **Dual timestamps:** every record shows device and server times; re-sync changes neither; direct timestamp updates fail outside the correction flow (AC-G4).
6. **Clock integrity:** with the device clock 2 hours wrong offline, the event syncs and raises a visible discrepancy flag without altering the stored time (AC-G5).
7. **Concurrency:** two phones, online and offline, produce no lost or duplicated records; conflicts are first-write-wins and flagged (AC-G6).
8. **Sign-out:** one tap, set once; second tap changes nothing (AC-G7).
9. **Messaging:** WhatsApp opens with the correct number and fully pre-filled text (both times, date, school name, privacy sentence); names with apostrophes/accents render correctly; offline messages stay visibly pending; marker reads "Message opened" (AC-G8).
10. **Corrections:** name/phone edits and time corrections are audit-logged with originals preserved; corrected records are visibly flagged; the corrected time is used in the message (AC-G9).
11. **End of day:** 60 children across two phones stay responsive; counter reconciles; outstanding-messages list reaches zero; all records synced; local data purged only after full sync (AC-G10).
12. **Runbook drill:** staff complete a full cycle — login, sign-in, sign-out, message, correction — unassisted, including one simulated offline period.
13. **Handover complete:** runbook printed, final PIN set, staff briefed, placeholders replaced (§27 Q1/Q2), open questions Q4–Q10 resolved.

---

*End of PRD v1.0. No application code, architecture diagrams, or database implementation have been produced; schema and architecture impacts are recorded as requirements and flags only (§16, §11.5, §10.2).*
