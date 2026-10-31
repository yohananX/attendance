# DESIGN — Grace House School Attendance

Corrected design system for the attendance sign-in app. The previous UI carried
the classic "vibe-coded / AI-looking" fingerprints: saturated AI-blue primary,
radial + linear gradients, uniform border+shadow+white cards everywhere, one
radius on every element, and generic system type. This document locks the
replacement so the app stays premium and intentional.

## Goals
- Phone-first, one-handed use at the school gate (large touch targets).
- Institutional, trustworthy, warm — a school register, not a SaaS dashboard.
- Zero network-dependent styling: self-hosted fonts so the offline PWA works.

## Stack (unchanged)
Next.js App Router, vanilla CSS in `src/app/globals.css`, no Tailwind,
no new libraries. Fonts self-hosted via `next/font/google` (bundled at build).

## Tokens (`src/app/globals.css`)

Typography:
- `--font-sans` — Geist (body, numbers, UI). `font-variant-numeric: tabular-nums`
  used for times so digits align.
- `--font-serif` — Source Serif 4 (headings). Gives headings register-like
  presence; tight negative tracking, `text-wrap: balance`.
- Scale: h1 30px, h2 20px, body 15px, labels 13px, small 11–12px.

Colour — one accent only:
- Base: warm paper `--paper #faf9f6`, panel `#ffffff`, surface `#f2efe8`.
- Ink: warm near-black `--ink #252320`; soft `#848079`; faint `#b9b5ac`.
- Line: `--line #dbd8cf`.
- Single accent: deep institutional green `--accent #2e5e4e` (desaturated),
  soft tint `--accent-soft #e9efea`. No blue, no purple, no gradients.
- Semantic: green success, amber warning, red error — each with a soft tint.

Surfaces (replaces the generic card look):
- `.panel` — border + soft tinted shadow, raised layer (header, board).
- `.surface` — border only, slightly darker background, subtle layering.
- No `border + shadow + white` triple combo. No uniform radius:
  `--radius-sm 8px`, `--radius 11px`, `--radius-lg 18px`.

Interactivity:
- Buttons: filled `.button-primary` (accent), `.button-secondary` (bordered),
  `.button--ghost`, `.button--text`.
- Every button has hover + active (`scale(0.97)`) + focus ring (`--accent`).
- Transitions `140ms cubic-bezier(0.2, 0, 0, 1)`; `prefers-reduced-motion`
  disables them.

Layout:
- `min-height: 100dvh` (no iOS viewport jump), centered shell with max-width.
- Login: no gradients, single warm panel, serif title.
- Tabs: underline indicator in accent, active state via colour not fill.
- Completed rows: `.student-card--completed` sits in its own surface with
  radius and margin instead of a border-only row.

## What was removed (anti-AI checklist)
- Radial gradient glow on `.login-screen`.
- Linear gradient on `.login-panel-header`.
- Saturated `--blue #1b3fd0` primary and all derived blue-soft tokens.
- Generic `0 4px 18px rgba(...)` black-opacity shadows → tinted, hue-matched.
- Uniform `10px` border radius on every element.
- `height: 100vh` → `100dvh`.

## What was preserved (functionality untouched)
- All routes, server actions, Supabase service-role access, RLS, offline
  IndexedDB sync, WhatsApp `wa.me` handoff, PIN login and session cookie.
- All class names referenced by components kept stable; only their styling
  changed. No DOM structure or ARIA changed except adding `.sign-in-body`.

## Tests
`npx vitest run` — 65 passed, 1 skipped (pre-existing DB integration skip).
`npx next build` — clean. `npx tsc --noEmit` — clean.
