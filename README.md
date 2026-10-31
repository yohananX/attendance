# Grace House School Attendance

Offline-first attendance sign-in PWA for Grace House School's Saturday lessons.
Staff sign children in and out on their phones (works in airplane mode), and a
timestamped WhatsApp message is prepared for each parent.

This repository currently contains the **deployment skeleton (task T1.1)** plus
the approved planning documents. Attendance features are not yet implemented.

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
- **PWA (service worker + IndexedDB)** — offline-first capture (planned, T1.3/T4.x)

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

Defined in `.env.example` (placeholders only, never real credentials). All of
these are **server-only** — never prefix them with `NEXT_PUBLIC_`, never render
them into pages, and never send them to the browser:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; server-only even in Vercel |
| `SESSION_SECRET` | Signs the session cookie (12-hour expiry, FR-02) |
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
   `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `STAFF_PIN`, `SCHOOL_NAME`
   for Production (and Preview/Staging if wanted). Mark the secret ones as
   sensitive. They must **not** be exposed to the browser — Next.js only sends
   `NEXT_PUBLIC_*` vars to client code, so keep the `NEXT_PUBLIC_` prefix off
   every variable in this project.
3. Deploy: push to `main` (via pull request — never push directly to `main`),
   or run `vercel --prod` from a machine that is logged in (`vercel login`).
4. Verify: open the deployment URL over HTTPS and view page source — it must
   contain no Supabase URL, no service-role key, no PIN, no session secret
   (AC-G1).

## Security notes

- No secrets in the repo: `.env`, `.env.local`, `.env.*.local` and `.vercel/`
  are git-ignored; only the placeholder `.env.example` is committed.
- The database is never reachable from the browser: RLS enabled with **no
  policies** on all tables; all access goes through server code using the
  service-role key (T1.2).
- The PIN and its verifier never leave the server and are never logged.

## Current state

- ✅ Next.js App Router + TypeScript skeleton deployed to Vercel (T1.1)
- 🔲 Supabase wiring + lockdown (T1.2) — code complete and tested: server-only
  Supabase client (`src/lib/supabase/server.ts`), `/api/health` operator-authenticated
  connectivity route (`x-health-secret`; `dbReady` requires a privileged-capability
  check, not mere anon-key connectivity), and the initial schema migration with
  RLS enabled + no policies, event/session/correction append-only guardrails,
  the sessions mutability guardrail with sanctioned mutation paths (AC-30.4),
  PD-D2 partial unique indexes (exactly one accepted sign-in/sign-out per session),
  PD-D1 configurable late-sync settings (`app_settings`, 7-day default), and the
  `health_privilege_check()` RPC. Unit tests added (`tests/`), `npm run test`,
  `npm run typecheck` and `npm run build` pass.
  Remaining: create a **non-production** Supabase project, add
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HEALTH_CHECK_SECRET`, `SESSION_SECRET`,
  `STAFF_PIN` to `.env.local` and Vercel, then apply the migration to the empty
  database. **Do not apply to production.**
- ⬜ PWA skeleton (T1.3)
- ⬜ Login, attendance capture, sync, messaging, review, day close (T2–T8)
