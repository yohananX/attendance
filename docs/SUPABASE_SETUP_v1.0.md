# Supabase setup (T1.2) — v1.0

This document explains how to configure a **non-production** Supabase project for the Grace House Attendance app and apply the initial schema migration.

> **Do not** commit credentials. `.env.local` is gitignored. Only add secrets to Vercel Environment Variables for deployed environments.

## 1) Create a Supabase project (non-production)
1. Go to [supabase.com](https://supabase.com) and create a new project. Use a separate project for dev/staging (not production) while validating.
2. Note the **Project URL** and **Service role key** (Settings → API). The service role key is privileged and must never reach the browser.

## 2) Configure environment variables
Copy `.env.example` to `.env.local` and fill in:

- `SUPABASE_URL` — e.g. `https://<project-ref>.supabase.co` (https required; http only allowed for local Supabase CLI on localhost)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only)
- `SESSION_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `STAFF_PIN` — minimum 6 digits (verified server-side only)
- `SCHOOL_NAME` — e.g. `Grace House School`

For Vercel: Project → Settings → Environment Variables. Add the same values; mark secrets as sensitive. Do **not** prefix with `NEXT_PUBLIC_`.

## 3) Apply the migration
The migration is at `supabase/migrations/20261031000000_initial_schema.sql`. 

Options:
- **Supabase SQL Editor** (easiest): Open the SQL Editor in your Supabase project and paste/run the migration contents. Run once against an empty database.
- **Supabase CLI** (if using local/linked project): `supabase db push` or apply the migration file as appropriate for your setup.

After applying, all five tables will exist with RLS enabled and **no policies** (only the service role can access). The `events` table has append-only triggers.

## 4) Verify
1. Start the dev server: `npm run dev`
2. Visit `http://localhost:3000/api/health` — with correct config it should return `{ "ok": true, "serverTime": "...", "dbReady": true/false, "schema": "..." }`. Note: the health endpoint behavior may change during remediation; see the T1.2 remediation plan.
3. Check build: `npm run typecheck && npm run build`

## Notes
- The browser never talks to Supabase directly. All access is server-side via `src/lib/supabase/server.ts` using the service role key.
- Never commit `.env.local` or credentials.
- Do **not** apply migrations to production without explicit approval and verification.
