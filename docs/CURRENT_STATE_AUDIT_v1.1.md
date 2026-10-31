# Current-State Audit — Grace House School Attendance Application
# Deliverable A — v1.1 (audit and development rebaseline)

| | |
|---|---|
| **Document** | Current-State Audit v1.1 |
| **Version** | 1.0 |
| **Date** | 31 October 2026 |
| **Author** | Lead Software Architect / Senior Full-Stack Engineer |
| **Repository** | https://github.com/yohananX/attendance |
| **Production application** | https://attendance-bice-sigma.vercel.app |
| **Branch audited** | `main` (latest), clean working tree, up to date with `origin/main` |
| **Commit audited** | `4de664b53029058d0d5403abfeb81254f1f6098e` — 2026-10-31 — "design: three-line student rows with phone and sync on line 2" |
| **Open pull requests** | None (GitHub API `state=open` returned empty) |
| **Related baseline docs** | `docs/PRD_v1.2.md`, `docs/SYSTEM_ARCHITECTURE_v1.0.md`, `docs/DATABASE_CONTRACT_v1.0.md`, `docs/API_CONTRACT_v1.0.md`, `docs/SYNC_CONTRACT_v1.0.md`, `docs/STAKEHOLDER_DECISION_REGISTER_v1.0.md`, `docs/IMPLEMENTATION_PLAN_v1.0.md` |

---

## 1. Audit scope and method

This is an audit and planning task only. No application code was changed, no migration was applied, and no production database was touched. Every classification below is based on inspection of the actual `main` branch source, the migration file, the test suite, and the executed test/build results. Where a feature is mentioned in the PRD or implementation plan but not present in code, it is classified as **Not implemented** or **Partially implemented**, never inferred.

Test results executed during this audit (Node 24, vitest 2.1.9):

- `npm run test` — **65 passed, 12 skipped** (the 12 skipped are `tests/db-integration.test.ts`, gated on a live `DATABASE_URL` that is not present in this environment).
- `npm run typecheck` — clean.
- `npm run build` — clean (production build succeeds; all routes render).

Production behaviour reported by the user (successful use on 31 October 2026) is treated as **user-reported**, not independently verified by this audit. No claim of production readiness or security readiness is made without evidence.

---

## 2. Repository facts

### 2.1 Commit and branches

| Item | Value |
|---|---|
| Latest commit SHA | `4de664b53029058d0d5403abfeb81254f1f6098e` |
| Commit date | 2026-10-31 |
| Commit message | "design: three-line student rows with phone and sync on line 2" |
| Author | Yohanan Emeka |
| Local branch | `main` (only local branch) |
| Remote branches | `origin/main` (HEAD), `origin/HEAD -> origin/main` |
| Working tree | Clean, nothing to commit |
| Open pull requests | None (GitHub API returned empty for `state=open`) |
| Preceding relevant commits | `20f106c feat: complete attendance app — login, sessions, dashboard, offline capture, WhatsApp handoff`; `04dc68a fix(t1.2): RLS on app_settings, health_privilege_check service_role, correction audit trail, server_version on sign-out` |

### 2.2 Project directory structure (source-relevant entries)

```
supabase/migrations/20261031000000_initial_schema.sql   -- the single migration (the full server schema)
src/
  app/
    layout.tsx, page.tsx (redirects to /dashboard), manifest.ts
    dashboard/page.tsx + AttendanceDashboard.tsx      -- the single attendance screen (sign-in, lists, sign-out, messages)
    review/page.tsx + DayReview.tsx                   -- day review + CSV export
    login/page.tsx                                    -- PIN login
    sign-in/, sign-out/, whatsapp/, offline/          -- stub routes, all redirect to /dashboard
    logout/route.ts                                   -- POST /logout (session cookie clear)
    api/
      login/route.ts          -- POST /api/login (E1)  PIN verify + cookie, no rate limit, no descriptor
      events/route.ts         -- POST /api/events (E2) batch ingest, sign_in/sign_out only
      day/route.ts            -- GET /api/day (E3) day cache sync
      messages/[sessionRef]/launched/route.ts  -- POST (E4) WhatsApp launch marker
      session/route.ts        -- GET /api/session (NOT in PD-A1 catalogue)
      sign-out/route.ts       -- POST /api/sign-out (NOT in PD-A1 catalogue; server-clock sign-out)
      health/route.ts         -- GET /api/health (NOT in PD-A1 catalogue; operator-authenticated)
  lib/
    session.ts              -- server cookie signing/validation (HMAC SHA256), Lagos date helpers
    phone.ts                -- phone normalisation to E.164 +234…
    attendance-dataset.ts   -- ATTENDANCE_DATASET_ID resolution ("development" off-prod)
    attendance-store.ts     -- IndexedDB wrapper (single "attendance" store keyed by sessionRef)
    attendance-csv.ts       -- client-side CSV builder
    whatsapp.ts             -- message templates + wa.me URL builder
    supabase/{env,server,rpc}.ts  -- server-only Supabase service-role client + sanctioned RPC helpers
  components/
    ServiceWorkerRegister.tsx
public/
  sw.js                   -- app-shell service worker (precaches shell; never caches /api/*)
  branding/, icons/
tests/
  login, session, launched, day, health, env, whatsapp, attendance-csv, attendance-dataset, dataset-sync, db-integration, migration
.env.local                -- gitignored; contains real credentials for the linked Supabase project (NOT committed)
.env.example              -- committed placeholder template
next.config.ts, vitest.config.ts, tsconfig.json, package.json
```

### 2.3 Implemented database schema and migrations

Single migration: `supabase/migrations/20261031000000_initial_schema.sql`.

It implements the DATABASE_CONTRACT_v1.0 three-part model:

- `sessions` (session projection), `events` (append-only log), `conflicts`, `corrections`, `login_attempts`, plus `app_settings` (PD-D1 configurable thresholds, 7-day default).
- RLS enabled with **no policies** on all six tables (S2/S3).
- Append-only triggers on `events`, `corrections`, `conflicts` (no UPDATE/DELETE at the data layer).
- Sessions mutability guardrail: `sessions_no_direct_update` trigger requiring a transaction-local `app.session_mutation_authorized = 'true'` GUC set only by sanctioned functions `sessions_apply_projection`, `sessions_apply_correction`, `sessions_set_launch_marker`, `sessions_flag_conflict` (AC-30.4, H3).
- `sessions_apply_correction` RPC writes an append-only `corrections` audit row + a `correction` event row, bumps `server_version`, sets `corrected = true`, and implements the base-version check (FR-30, AC-30.x).
- PD-D2 partial unique indexes: `idx_events_one_sign_in_per_session` and `idx_events_one_sign_out_per_session` (where `conflict_marker = 'none'`) — defence-in-depth for exactly-one-accepted sign-in/sign-out per session.
- `health_privilege_check()` RPC for the H2 privileged-capability probe.
- `queued_duration >= 0` check; `losing_event_ids` non-empty check; `updated_at` trigger on `sessions`.

**Migration status:** validated by unit tests (`tests/migration.test.ts` — 8 pass). DB-integration tests (9) are **skipped** because no live `DATABASE_URL` is available in this environment. The migration has **not** been applied to any database in this environment and must not be applied to production (SUPABASE_SETUP_v1.0.md, T1.2 review report).

Note: `.env.local` exists locally (gitignored) and contains real values for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `STAFF_PIN`, `HEALTH_CHECK_SECRET`, `ATTENDANCE_DATASET_ID`. These are **never** committed and none of their values are quoted in this document.

---

## 3. Implemented API endpoints vs the approved catalogue (PD-A1)

API_CONTRACT_v1.0 §2 (PD-A1, **approved**) defines the pilot endpoint catalogue as E1–E7:

| # | Contracted endpoint | Status in code | Notes |
|---|---|---|---|
| E1 | `POST /api/login` | **Implemented** | PIN verify + HttpOnly cookie (12 h). **Missing:** rate limiting (FR-03) and signed session descriptor issuance (FR-04/T-C2). |
| E2 | `POST /api/events` | **Implemented** | Batch ingest, sign_in/sign_out only. **Missing:** `correction` eventType support; full conflict-engine (conflicts table, losing-event retention, needs_review, late_synced, consistency flags); idempotency duplicate-ack is implemented. |
| E3 | `GET /api/day` | **Implemented** | Day cache sync + outstanding messages + counts. |
| E4 | `POST /api/messages/{sessionRef}/launched` | **Implemented** | WhatsApp launch marker, idempotent (PD-D7). |
| E5 | `POST /api/corrections` | **Not implemented** | No route. RPC `sessions_apply_correction` exists in the migration but is not exposed by any endpoint (FR-30, AC-30.x cannot be exercised over HTTP). |
| E6 | `POST /api/day-close/check` | **Not implemented** | No route, no close-day dialog, no purge token (FR-35, BR-17, AC-35.x). |
| E7 | `GET /api/time` | **Not implemented** | No clock-probe endpoint (FR-12(a), AD-3); no offset storage, no consistency flags beyond the basic acceptance-window rejections. |

**Endpoints present but NOT in the PD-A1 catalogue:** `GET /api/session`, `POST /api/sign-out`, `POST /api/logout`, `GET /api/health`. These are operational/development endpoints outside the approved catalogue; `/api/sign-out` diverges from the event model (see §8.2).

### 3.1 Notable endpoint-level defects

- `POST /api/sign-out` sets `signed_out_at` from the **server clock** (`new Date().toISOString()`), not the device-captured time. This contradicts FR-07/FR-11 (times captured automatically on the device; device time is the time of record). The dashboard's `handleSignOut` instead builds a local `sign_out` event with device time and sends it via `/api/events`, so the sign-out route appears to be a divergent/dead code path — but it is live on the deployment and must be reconciled or removed.
- `POST /api/events` validates `eventType` as `sign_in` \| `sign_out` only; `correction` is rejected with `event_type_invalid`, so E5-style corrections cannot be ingested through the event log at all.
- `POST /api/login` performs **no rate limiting** (no `login_attempts` writes, no 5-attempts → 5-minute lockout), contradicting FR-03/S4/AC-03.x. The `login_attempts` table exists but is unused by the route.

---

## 4. Existing frontend functionality

### 4.1 What is implemented (single-screen attendance app)

- **Login** (`/login`): staff name + PIN (>= 6 digits), server-verified, sets HttpOnly 12-hour cookie, caches `{staffName, expiresAt}` (unsigned) in `localStorage` (`gh_staff_session`). Redirects to `/dashboard`. Offline login blocked with a message.
- **Dashboard** (`/dashboard`, `AttendanceDashboard.tsx`): sign-in form (name + parent phone), "In school" list (newest first, sign-out button, per-row sync chip), "Signed out today" list (both times, send-message button, copy button), live in-school counter, search box, sync badge with manual retry, pending/failed counts, day review link, logout.
- **Sign-in capture**: generates `eventId` (UUID), `sessionRef` (UUID, new per sign-in), device timestamp, normalised phone, saves to IndexedDB (`attendance-store.ts` `saveSignIn`), then syncs via `/api/events` when online.
- **Sign-out capture**: one-tap guard locally (`signingOut` set + `record.signedOutAt` check), saves via `saveSignOut`, syncs via `/api/events`. Second tap is a local no-op.
- **WhatsApp handoff**: `wa.me` deep link with pre-filled message (sign-in or sign-out variant), always-visible Copy control, server-held launch marker via `/api/messages/{sessionRef}/launched`, local `whatsappLaunchedAt` cache.
- **Sync**: `getPendingEvents()` reads pending events from IndexedDB and POSTs them one-by-one to `/api/events`; auto-sync on reconnect/foreground/online; per-event result handling (`accepted`/`duplicate` → cleared; `conflict` → shown as failed with a message).
- **Day review** (`/review`, `DayReview.tsx`): full-day table (name, phone, sign-in, sign-out), CSV export (client-side `buildAttendanceCsv`), offline-aware local read.
- **PWA**: `manifest.ts`, `public/sw.js` app-shell precache (shell assets only; `/api/*` never cached), `ServiceWorkerRegister.tsx`, installable to home screen.
- **Dataset isolation**: `ATTENDANCE_DATASET_ID` gates all API calls (409 `dataset_mismatch` on mismatch); local `gh_attendance_dataset` in localStorage; a "Clear old device data" flow wipes local IndexedDB when the dataset changes.
- **Lagos display**: times formatted with `Intl.DateTimeFormat` `Africa/Lagos`, 12-hour, with date.

### 4.2 What is partially implemented or missing (frontend)

| Feature | Status | Gap |
|---|---|---|
| Signed session descriptor (FR-04/T-C2) | **Not implemented** | `localStorage` holds unsigned `{staffName, expiresAt}`; no Ed25519/ES256 signature, no `keyId`, no offline signature verification, no session-expired screen rendering no data. |
| Login rate limiting (FR-03) | **Not implemented** | No attempt counting or lockout on the server or client. |
| Device-captured sign-out time (FR-07/FR-11) | **Partially implemented** | Dashboard sends device time via `/api/events`, but the live `/api/sign-out` route overwrites with server clock. |
| Conflict evidence preservation (FR-16/BR-12) | **Partially implemented** | Partial unique indexes defend against duplicate accepted sign-outs, but the ingest route does **not** persist a losing event with `conflict_marker = 'losing'` nor write a `conflicts` row — the losing event is dropped on index violation. Session `needs_review`, `late_synced`, and consistency flags are not set by the route. |
| Outbox state machine (SYNC_CONTRACT §5) | **Partially implemented** | Local states are only `pending` \| `failed`. No `inflight`, `failed-review`, `acked`; no read-back verification before success UI (AD-6); no persistent-storage request; no quota monitoring/warning; no blocking-error durability failure state (AC-G3b). |
| Clock probe & consistency flags (FR-12) | **Not implemented** | No `/api/time` probe, no offset storage, no ahead-of-receipt / sign-out-before-sign-in / day-mismatch / sequence-regression flags. |
| Audited corrections UI + endpoint (FR-29/FR-30/E5) | **Not implemented** | No `/api/corrections` route, no correction UI. Migration RPC exists but is unreachable over HTTP. FR-30 is priority M and is required for conflict resolution (FR-16). |
| Gated day close (FR-35/E6) | **Not implemented** | No `/api/day-close/check`, no close-day dialog, no purge token, no local purge. |
| Clock-probe endpoint (E7) | **Not implemented** | See above. |
| Bulk sign-out (FR-34) | **Not implemented** | Cut item for pilot (PRD §28). |
| Duplicate warning (FR-23) | **Not implemented** | Cut item. |
| Name/phone edit window (FR-29) | **Not implemented** | Cut item; required for the new student registry. |
| Student registry (stable student identity) | **Not implemented** | No `students` table, no stable student ID, no student selection/find/edit/deactivate. This is the major new requirement (see Deliverable D). |
| WhatsApp message template per FR-25 | **Partially implemented** | Messages use "X has arrived/left the school" with Sign-in/Sign-out labels; the PRD template ("Hello, this is [School name]. [Student name] arrived at… and left at… on [date]. Thank you." + privacy sentence) and the FR-28 privacy sentence are not used. |
| "WhatsApp opened" honesty wording (BR-13/Q15) | **Defect** | `AttendanceDashboard.tsx:827` renders `✓ Sent {time}` when `whatsappLaunchedAt` is set — this claims "Sent", which the system cannot verify and must never claim. Must read "WhatsApp opened". |

---

## 5. Tests and coverage

| Test file | Cases | Status | What it verifies |
|---|---|---|---|
| `tests/migration.test.ts` | 8 | Pass | Migration SQL content: 5 tables + `app_settings`, RLS/no policies, append-only triggers, sessions mutability guardrail, sanctioned functions, PD-D2 indexes, PD-D1 settings, `health_privilege_check`. |
| `tests/db-integration.test.ts` | 12 | **Skipped** | Executes the migration against live Postgres; append-only guards, sanctioned projection/correction, PD-D2 index, PD-D1 settings, health RPC. Requires `DATABASE_URL` — not available here. |
| `tests/login.test.ts` | 5 | Pass | `/api/login`: malformed input, wrong PIN, cookie flags (HttpOnly/Secure/SameSite/Max-Age), missing secrets fail closed, missing dataset fails closed. **No rate-limit test exists** (rate limiting is not implemented). |
| `tests/session.test.ts` | 8 | Pass | Cookie token create/validate, tamper rejection, expiry, missing secret. |
| `tests/launched.test.ts` | 10 | Pass | `/api/messages/{sessionRef}/launched`: 401, unknown session, not-signed-out, 200 marker, idempotency (PD-D7), 503 when Supabase unconfigured. |
| `tests/day.test.ts` | 8 | Pass | `/api/day`: auth, day payload, counts, outstanding messages, default day key, malformed day key. |
| `tests/health.test.ts` | 8 | Pass | `/api/health`: operator secret auth, privileged-capability probe (`dbReady`), connectivity probe, serverTime. |
| `tests/env.test.ts` | 6 | Pass | Supabase config validation (URL, key, https, localhost tolerance, trailing slash). |
| `tests/whatsapp.test.ts` | 6 | Pass | Message template builders and `wa.me` URL encoding. |
| `tests/attendance-csv.test.ts` | 1 | Pass | CSV escaping and columns. |
| `tests/attendance-dataset.test.ts` | 4 | Pass | `getAttendanceDatasetId` resolution rules. |
| `tests/dataset-sync.test.ts` | 1 | Pass | `/api/events` dataset-mismatch 409 before Supabase contact. |

**Coverage assessment:** Unit tests cover route handlers, session crypto, config validation, and migration SQL content. There are **no client-side tests** (IndexedDB store, React components, sync engine, offline capture), **no end-to-end tests**, and **no production-sync/concurrency tests**. The skipped DB-integration tests cannot run without credentials. Coverage is therefore narrow: server route contracts and migration structure only.

---

## 6. Deployment and environment configuration

- **Hosting:** Vercel (production URL `https://attendance-bice-sigma.vercel.app`, user-reported as used in production on 31 October 2026).
- **Build:** Next.js 16 App Router, TypeScript, static + dynamic routes as shown by `npm run build`. Build and typecheck are clean.
- **Environment variables (per `.env.example` / local `.env.local`):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `STAFF_PIN`, `HEALTH_CHECK_SECRET`, `ATTENDANCE_DATASET_ID`, `SCHOOL_NAME`. All server-only; none prefixed `NEXT_PUBLIC_`.
- **Supabase:** single migration ready to apply to a linked project. Per the T1.2 review report, no non-production Supabase project credentials were available in this environment to apply/verify the migration live; production application status is user-reported, not independently verified here.
- **PWA:** service worker `sw.js` (version `gh-attendance-shell-v6`) precaches the app shell; navigation falls back to cached shell offline; `/api/*` is never cached by the service worker.
- **CI/deployment:** README describes pushing to `main` (via PR, never direct push) or `vercel --prod`. `.vertex`/`.vercel` directory exists locally (gitignored).

---

## 7. Feature classification summary

Classifications apply to the **actual code on `main`**, not to what the PRD/intention describes.

| # | Feature | Classification | Evidence / notes |
|---|---|---|---|
| 1 | Staff PIN authentication (server-verified cookie) | Implemented and verified | `src/app/api/login/route.ts`; `tests/login.test.ts` (5 pass). |
| 2 | 12-hour HttpOnly session cookie | Implemented and verified | Cookie flags asserted in `tests/login.test.ts`; `src/lib/session.ts`. |
| 3 | Student sign-in (name + phone, device time, offline capture) | Implemented but not fully verified | Dashboard `handleSignIn`; IndexedDB `saveSignIn`; sync via `/api/events`. Unit-tested at route level only; no real-phone offline test executed by this audit. |
| 4 | Student sign-out (one tap, local no-op guard) | Implemented but not fully verified | `handleSignOut` + `saveSignOut`. Note `/api/sign-out` route uses server clock (defect, §8.2). |
| 5 | Attendance dashboard (lists, counter, search, Lagos display) | Implemented and verified | `AttendanceDashboard.tsx`; exercised in production per user report (not independently verified). |
| 6 | Supabase persistence (service-role, RLS no-policies) | Implemented and verified | Migration + `src/lib/supabase/server.ts`; bundle leakage audited clean (T1.2 report); DB-integration tests skipped (no live DB). |
| 7 | IndexedDB local storage | Implemented but not fully verified | `src/lib/attendance-store.ts`; no client-side tests; durability-before-success (read-back, persistent storage, quota warning, blocking error) **not implemented**. |
| 8 | Offline capture and synchronisation | Partially implemented | Local save + sync on reconnect/foreground; but outbox state machine incomplete (no inflight/failed-review/acked), no read-back verify, no blocking-error state, no `failed-review` handling. |
| 9 | Idempotent event ingestion | Implemented and verified | `eventId` idempotency lookup in `/api/events`; `tests/dataset-sync.test.ts` + route logic. |
| 10 | WhatsApp arrival/departure handoff | Implemented but not fully verified | `buildWhatsAppUrl` + launch marker; wording defect ("✓ Sent") and template divergence from FR-25 (§8.2). |
| 11 | Day review and CSV export | Implemented but not fully verified | `DayReview.tsx` + `buildAttendanceCsv`; CSV unit-tested; day-close gating not implemented. |
| 12 | PWA functionality | Implemented and verified | `manifest.ts`, `sw.js`, `ServiceWorkerRegister.tsx`; build-verified. |
| 13 | Attendance dataset isolation | Implemented and verified | `ATTENDANCE_DATASET_ID` gating; 409 on mismatch; local dataset key; clear-old-data flow. |
| 14 | Login rate limiting (FR-03) | Not implemented | `login_attempts` table unused by `/api/login`. |
| 15 | Signed offline session descriptor (FR-04/T-C2) | Not implemented | Unsigned `{staffName, expiresAt}` in localStorage; no signature/verification/keyId/session-expired screen. |
| 16 | Clock probe & consistency flags (FR-12/E7) | Not implemented | No `/api/time`; no offset storage; no flags. |
| 17 | Audited corrections endpoint & UI (FR-29/FR-30/E5) | Not implemented | No `/api/corrections`; no correction UI; migration RPC exists but unreachable over HTTP. FR-30 is priority M. |
| 18 | Gated day close (FR-35/E6) | Not implemented | No `/api/day-close/check`; no close-day dialog/purge/token. |
| 19 | Conflict evidence preservation (FR-16) | Partially implemented | Partial unique indexes present; losing event **not persisted** and no `conflicts` row written by ingest route (defect, §8.2). |
| 20 | Permanent student registry (stable student ID) | Not implemented | No `students` table; name+phone entered per session (the major new requirement). |
| 21 | Bulk sign-out (FR-34), duplicate warning (FR-23) | Not implemented | Cut items for pilot (PRD §28). |
| 22 | Security completion (rate limiting, descriptor signing, blocking-error durability) | Partially implemented | RLS/service-role isolation good; rate limiting, descriptor signing, AC-G3b missing. |

---

## 8. Data integrity review

### 8.1 Event log vs session projection

The migration and ingest route follow the three-part model (append-only `events` log + mutable `sessions` projection + append-only `corrections`/`conflicts` audit stores), which is the correct architectural foundation. The mutability guardrail (`sessions_no_direct_update` + sanctioned functions) prevents direct session updates outside projection/correction/launch-marker/conflict-flag paths. `events`, `corrections`, and `conflicts` are append-only at the trigger level.

**Accepted events cannot be lost:** once a batch is authenticated and well-formed, the route iterates per event; transport failure fails the whole batch and leaves every entry pending (never all-or-nothing loss). Per-event idempotency (`eventId` lookup → `duplicate` returns the original acknowledgement) prevents duplicate rows on retry.

### 8.2 Material data-integrity defects (prioritised)

These are defects in the relationship between the append-only event log and the mutable projection, or in honesty/security guarantees. They should be fixed before the system is relied on for weekly attendance.

**D1 — Losing conflicting sign-out events are not persisted (FR-16 / BR-12 violation).**
In `src/app/api/events/route.ts`, the projection is applied (`sessions_apply_projection`) **before** the event row is inserted. When a second `sign_out` for the same session arrives, `sessions_apply_projection` updates `signed_out_at ... WHERE signed_out_at IS NULL` (0 rows affected — no error), then the `events` insert violates `idx_events_one_sign_out_per_session` and is caught, returning `result: "conflict"` **without inserting the losing event**. The losing event is therefore dropped, contradicting FR-16 ("the losing event is retained permanently in the log") and BR-12 ("nothing silently overwritten or discarded"). The fix: insert losing events with `conflict_marker = 'losing'` (outside the partial unique indexes) and write a `conflicts` audit row, exactly as the contract specifies.

**D2 — UI claims "Sent" for WhatsApp (BR-13 / Q15 violation).**
`src/app/dashboard/AttendanceDashboard.tsx:827` renders `<span className="message-opened">✓ Sent {formatTime(record.whatsappLaunchedAt)}</span>`. The system can only verify link launch, never send or delivery. This must read "WhatsApp opened" everywhere (chips, day review, CSV). No screen or export may claim "sent" or "delivered".

**D3 — Sign-out time source divergence (FR-07 / FR-11 violation).**
`src/app/api/sign-out/route.ts` sets `signed_out_at` from the server clock. Times must be device-captured (the time of record). The dashboard's own path uses device time via `/api/events`, so this route is a divergent live code path. Reconcile: remove or repoint `/api/sign-out`, or make it create a `sign_out` event with the client-supplied `deviceEventAt` through the normal ingest path.

**D4 — No signed session descriptor (FR-04 / T-C2 / S11 gap).**
`src/lib/attendance-store.ts` caches `{staffName, expiresAt}` unsigned in `localStorage` (`gh_staff_session`). The architecture requires a server-signed descriptor (Ed25519/ES256, `{staffName, iat, exp, keyId, nonce}`) verifiable offline with the public key, containing no PIN material. Current localStorage session is trivially forgeable by any script in the origin and offers no offline cryptographic gate. This is a divergence from the approved two-layer session design, though it does not expose server data (server APIs still require the cookie).

**D5 — No login rate limiting (FR-03 / S4 gap).**
`/api/login` verifies PIN but never writes to `login_attempts` and never enforces 5-attempts → 5-minute lockout. Brute-force PIN guessing is only bounded by network latency.

**D6 — Dataset mismatch clears pending unsynchronised records.**
`clearAttendanceForDataset()` (`src/lib/attendance-store.ts:135`) clears the entire IndexedDB `attendance` store, including pending (unsynchronised) events, when `ATTENDANCE_DATASET_ID` changes. Unsynchronised records can therefore be destroyed by a dataset reset, contradicting FR-14/FR-35 ("unsynchronised events are never purged") and BR-17. The clear should be scoped to acknowledged/synced records or blocked while unacknowledged events exist.

**D7 — Missing contracted endpoints (E5, E6, E7).**
`/api/corrections`, `/api/day-close/check`, and `/api/time` do not exist. FR-30 (audited corrections, priority M), FR-35 (gated day close), and FR-12(a) (clock probe) cannot be exercised over HTTP. The `sessions_apply_correction` RPC exists in the migration but is unreachable.

**D8 — Ingest route does not implement the full conflict/flag engine.**
`/api/events` never sets `session.needs_review`, `late_synced`, or consistency flags (ahead-of-receipt tolerance, sign-out-before-sign-in, day mismatch, device-sequence regression). It does not write `conflicts` rows or retain losing events (see D1). Orphaned sign-out handling (PD-D3 — accept into log + provisional session + `needs_review`) is not implemented.

**D9 — Outbox durability guarantees not met locally (AC-G3b / BR-21 / AD-6).**
No read-back verification after the IndexedDB write before showing success; no `navigator.storage.persist()` request; no quota monitoring/low-storage warning; no blocking-error durability-failure state. A storage failure could show success for an unsaved record.

### 8.3 What holds (no defect found)

- Append-only triggers on `events`/`corrections`/`conflicts` are present and unit-tested (migration content tests).
- Idempotent `eventId` acceptance with duplicate-acknowledgement is implemented in `/api/events`.
- `sessions_apply_correction` base-version check and audit-row write are implemented in the migration (DB-integration tests would verify, but are skipped without a live DB).
- Partial unique indexes (PD-D2) enforce at most one accepted sign_in and one accepted sign_out per session (defence-in-depth).
- RLS with no policies + service-role-only access; no secrets in client bundles (T1.2 security review verified bundle leakage clean).
- `server_received_at` stamped server-side at ingestion; `device_event_at` preserved per event.

### 8.4 Unverified claims

- "Successfully used in production on 31 October 2026" — user-reported only. This audit did not observe a live session, inspect production logs, or verify production data integrity.
- Production database state (whether the migration is applied to the linked Supabase project) — not independently verifiable from this environment (no production credentials access; `.env.local` is local-only and gitignored).
- Real-phone offline/sync behaviour (AC-G1…G10) — not executed by this audit; unit tests cover routes only.

---

## 9. Features not yet started (relevant to the new weekly direction)

- **Permanent student registry:** no `students` table, no stable student ID, no find/select/edit/deactivate/attendance-history. Every session currently re-enters name + parent phone. This is the central new capability (Deliverable D).
- **Student profile editing & audit history:** no endpoint or UI (FR-29 cut item; now required).
- **Attendance record correction over HTTP:** no `/api/corrections`; no correction UI (FR-30 is M).
- **Gated day close:** no `/api/day-close/check`; no close-day flow (FR-35).
- **Historical attendance access across weeks:** single-day scope (D10); no multi-week queries or student attendance history.
- **Backup/restore and retention procedures:** documented as owner-level manual purge (D3/BR-18) but no documented backup process.

---

## 10. Decisions requiring owner input (carried forward + new)

Carried forward and still **pending** (must not be treated as approved): **Q5** (clock tolerance / late-sync window), **Q13** (offline corrections), **Q14** (gated day close), **Q15** (WhatsApp wording), **Q16** (residual-risk acknowledgement). Per `STAKEHOLDER_DECISION_REGISTER_v1.0.md` and `PRD_CHANGELOG_v1.2.md` §4, all five remain open.

New decisions introduced by the student-registry requirement (all **proposed, not approved**, see Deliverable D):
- Student identity attributes and matching rules (name + phone + tolerances; do not match on name alone).
- Historical attendance reconciliation strategy (which legacy sessions attach to which student records).
- Duplicate student registration handling (block, flag, or merge-with-audit).
- Profile-edit authorisation model under the shared-PIN constraint (process rule vs technical control).
- Retention and minimisation for the student registry (PII held longer than a single day).

---

## 11. Conclusion (final report format)

1. **What we currently have:** A working offline-first attendance application on `main` (commit `4de664b`, 2026-10-31): PIN login with HttpOnly cookie, student sign-in/sign-out with device-captured times, a single-screen dashboard with lists/counter/search, IndexedDB offline capture with automatic sync, Idempotent Supabase ingestion via service-role-only routes with RLS and no policies, append-only event log + session projection + audit stores, WhatsApp `wa.me` handoff with server-held launch marker, day review + CSV export, PWA shell, and dataset isolation. Build, typecheck, and 65 unit tests pass.

2. **What has materially changed since the original build plan:** The codebase now diverges from the approved v1.0/v1.2 architecture in specific ways: no signed session descriptor (unsigned localStorage session), no login rate limiting, no clock probe, no corrections endpoint/UI, no gated day-close endpoint, a live `/api/sign-out` route that uses the server clock (contradicting device-captured time), a WhatsApp UI chip that incorrectly says "Sent", and an ingest route that drops losing conflict events instead of preserving them. The approved endpoint catalogue (E1–E7) is incomplete: E5, E6, E7 are missing.

3. **What is genuinely unfinished:** Corrections (FR-30, M), gated day close (FR-35), clock probe/consistency flags (FR-12/E7), login rate limiting (FR-03), signed offline descriptor (FR-04), full conflict-evidence preservation (FR-16), honest WhatsApp wording (BR-13), AC-G3b durability guarantees (read-back, persistent storage, quota warning, blocking error), and — the major new gap — a permanent student registry with stable student identity.

4. **What the new weekly student requirement changes:** Students must gain a stable identity across weekly sessions; attendance sessions must remain separate from student records; the system must support find/select returning students, profile editing with audit, deactivation without deleting history, duplicate handling, and reconciliation of historical records. This requires a new `students` table, foreign-key relationship from `sessions` (or events) to students, new server APIs, and offline implications — none of which exist yet. The student lookup UI is deliberately **not** part of this baseline.

5. **The proposed architecture for student records and editing:** A `students` table (stable `student_id`, name, parent phone, active flag, audit timestamps) referenced by attendance `sessions`/`events`; profile edits and attendance corrections as distinct, audited, authorised operations that never mutate original events; student identity separate from session identity; historical sessions reconciled to students only where matching is reliable and explicitly authorised.

6. **The recommended implementation sequence:** See Deliverable B (`docs/IMPLEMENTATION_PLAN_v1.1.md`) — phases 0–5, with security/data-integrity defect fixes (D1–D9) first, then the student registry, then editing/corrections, then reliability completion.

7. **Decisions requiring the owner's input:** Q5, Q13, Q14, Q15, Q16 (still pending), plus the new student-registry decisions listed in §10 and Deliverable D. None should be marked approved in this baseline.

8. **The first development task I recommend starting:** Fix data-integrity defect D1 (persist losing conflict events + write `conflicts` rows in `/api/events`) and implement the missing contracted endpoints E5 (`/api/corrections`) and E6 (`/api/day-close/check`) — these are the smallest unblocking, integrity-critical pieces before any student-registry work. Detailed ordering is in Deliverable B, Phase 0.
