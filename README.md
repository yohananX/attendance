# Grace House School Attendance

Simple, phone-first attendance for a single Grace House School Saturday
session. Staff sign in, record arrivals and departures, and open a pre-filled
arrival or departure WhatsApp message for each parent. Once a staff member has
signed in online, attendance can be captured without a connection and
synchronised when service returns.

## Project documents (authoritative baseline — do not edit casually)

| Document | Purpose |
|---|---|
| `docs/PRD_v1.2.md` | Product source of truth (requirements FR/BR/S/AC/…) |
| `docs/PRD_CHANGELOG_v1.2.md` | What changed v1.1 → v1.2 and why |
| `docs/SYSTEM_ARCHITECTURE_v1.0.md` | Architecture decisions AD-1…AD-10, data model, protocol |
| `docs/IMPLEMENTATION_PLAN_v1.0.md` | Task sequence T1.1 … T10.2 and acceptance tests |

## Stack

- **Next.js 16 (App Router) + TypeScript** — one deployable: client UI and
  server-only route handlers (architecture §1.3)
- **Supabase (Postgres)** — server-only access via the service-role key; the
  browser never talks to Supabase (S2/S3)
- **Vercel** — HTTPS hosting and environment variables
- **PWA (service worker + IndexedDB)** — cached app shell and device-local
  attendance outbox for offline capture

## Local setup

Prerequisites: Node.js ≥ 20 (developed on Node 24), npm.

```powershell
# 1. Install dependencies
npm install

# 2. Configure environment
Copy-Item .env.example .env.local
# Open .env.local and fill in real values (see below)

# 3. Run the dev server
npm run dev
# → http://localhost:3000
```

Other scripts:

```powershell
npm run build       # production build
npm run start       # serve the production build locally
npm run typecheck   # TypeScript check (tsc --noEmit)
```

## Environment variables

Defined in `.env.example` (placeholders only, never real credentials).
Credentials and secrets are **server-only** — never prefix them with
`NEXT_PUBLIC_`, render them into pages, or send them to the browser.
`ATTENDANCE_DATASET_ID` is a non-secret identifier returned to clients so
local records can be tied to the correct database:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; server-only even in Vercel |
| `ATTENDANCE_DATASET_ID` | Unique identity for this attendance database; rotate it when replacing or clearing the database |
| `SESSION_SECRET` | Signs the session cookie (12-hour expiry, FR-02) |
| `HEALTH_CHECK_SECRET` | Protects the operator-only `/api/health` endpoint |
| `STAFF_PIN` | Staff PIN, verified server-side only (FR-01) |
| `SCHOOL_NAME` | Public school name shown in the app and messages |

To generate a session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Deployment (Vercel)

1. Create the Vercel project (Dashboard → Add New → Project → import the
   `yohananX/attendance` GitHub repo, or via CLI: `vercel link`).
   Vercel auto-detects Next.js; no build configuration is needed.
2. In **Project → Settings → Environment Variables**, add `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ATTENDANCE_DATASET_ID`, `SESSION_SECRET`,
   `HEALTH_CHECK_SECRET`, `STAFF_PIN`, `SCHOOL_NAME`
   for Production (and Preview/Staging if wanted). Mark the secret ones as
   sensitive where appropriate. `ATTENDANCE_DATASET_ID` is an opaque unique
   identifier, not a secret. Do not expose server credentials to the browser
   — Next.js only sends `NEXT_PUBLIC_*` vars to client code, so keep that
   prefix off every variable in this project.
3. Deploy: push to `main` (via pull request — never push directly to `main`),
   or run `vercel --prod` from a machine that is logged in (`vercel login`).
4. Verify: open the deployment URL over HTTPS and view page source — it must
   contain no Supabase URL, service-role key, PIN, or session secret (AC-G1).

## Security notes

- No secrets in the repo: `.env`, `.env.local`, `.env.*.local` and `.vercel/`
  are git-ignored; only the placeholder `.env.example` is committed.
- The database is never reachable from the browser: RLS enabled with **no
  policies** on all tables; all access goes through server code using the
  service-role key (T1.2).
- The PIN and its verifier never leave the server and are never logged.

## Current state

- ✅ Next.js App Router + TypeScript skeleton deployed to Vercel (T1.1)
- ✅ Supabase wiring + lockdown (T1.2) — server-only
  Supabase client (`src/lib/supabase/server.ts`), `/api/health` operator-authenticated
  connectivity route (`x-health-secret`; `dbReady` requires a privileged-capability
  check, not mere anon-key connectivity), and the initial schema migration with
  RLS enabled + no policies, event/session/correction append-only guardrails,
  the sessions mutability guardrail with sanctioned mutation paths (AC-30.4),
  PD-D2 partial unique indexes (exactly one accepted sign-in/sign-out per session),
  PD-D1 configurable late-sync settings (`app_settings`, 7-day default), and
  the `health_privilege_check()` RPC.
- ✅ Staff PIN login and 12-hour server session cookie.
- ✅ Single-screen sign-in/sign-out flow, parent arrival/departure WhatsApp
  handoff, and local IndexedDB storage with an automatic sync attempt when
  connectivity returns.
- ✅ Day review with CSV export of student name, parent phone, sign-in, and
  sign-out times.
- ⚠️ Offline access is device-local and intended for this simple one-session
  workflow. Staff must log in online first; local pending attendance remains
  on that browser until it syncs. Avoid clearing browser data before sync.
- ✅ `ATTENDANCE_DATASET_ID` protects devices from re-uploading old local data
  after a database reset. Use a unique value for test and production, and
  change it after clearing/replacing a database. Devices detect the change,
  hide old records, and require staff to confirm clearing local attendance
  (including pending offline entries) before using the new dataset.
- ⬜ Production setup still needs a Supabase project/database migration,
  production secrets, and a Vercel deployment. Test the complete offline and
  reconnect flow on the actual phones before relying on it for attendance.

For testing-to-production, create a separate Supabase project and production
deployment with a new `ATTENDANCE_DATASET_ID`. Browser storage is isolated by
site origin, so production devices start clean. If resetting data on an
existing deployment, change the ID in its server environment and redeploy;
do not reuse the previous ID.

## School logo

The sign-in and attendance headers display the optimized transparent image at
`public/branding/school-logo.webp`. The supplied `school-logo.svg` is preserved
there as the original.
