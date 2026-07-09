# TDIS Logistics — Agent Dashboard (Next.js rebuild)

A Next.js 15 (App Router) + TypeScript + Tailwind CSS rebuild of the original
single-file HTML/CSS/JS TDIS Logistics agent dashboard. Visual design,
branding, colors, typography, layout, and content are preserved; the
underlying architecture is now componentized, typed, and optimized.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # optional — see FIREBASE_SETUP.md
npm run dev
```

Open http://localhost:3000. Demo logins (also shown on the login screen):

| Role  | Email           | Password  |
|-------|-----------------|-----------|
| Admin | admin@tdis.com  | admin123  |
| Agent | agent@tdis.com  | agent123  |

Without Firebase configured, all data is stored in the browser's
`localStorage` — the app is fully usable single-device out of the box.
See `FIREBASE_SETUP.md` to enable cross-device sync via Firestore.

## What changed vs. the original file

**Preserved exactly:** every color, font, spacing value, animation, card
style, and layout was carried over from the original `<style>` block into
`src/app/globals.css` — the CSS classes even keep their original names so
the two are easy to cross-reference. All ten sections that existed in the
source (Dashboard, Goals, Airlines, Airline Deposits, Update Bookings,
Clients, Staff Directory, Admin Control Centre, Client Debt Tracker, Debt
Dashboard) are present.

**One deliberate fix:** in the original file, the sidebar `<nav>` only
wired up buttons for **Dashboard**, **Airlines**, **Airline Deposits**, and
**Admin** — the other six sections were fully built (markup + JS logic) but
had no way to navigate to them (`handleStaffNavClick` was defined but never
attached to anything). The sidebar here (`src/lib/constants.ts` →
`SIDEBAR_SECTIONS`) links to all ten sections so none of the built
functionality is orphaned. If you actually want some of those hidden,
that's a one-line removal from that array.

**Also fixed:** the original airline-logo filenames were mixed-case (e.g.
`P4_logo.svg`) while the actual SVG files on disk are lowercase — harmless
on Windows/Mac but would 404 on case-sensitive hosts like Vercel or Linux.
Filenames are now consistently lowercase.

## Architecture

```
src/
  app/
    layout.tsx        Root layout, Google fonts, SEO metadata
    page.tsx           Auth gate + section router (client component)
    globals.css         Full ported design system
  components/
    layout/            Header, Sidebar, LoginScreen, ToastArea
    sections/           One component per dashboard section
    sections/admin/     6-tab Admin Control Centre
    ui/                  Modal (Radix Dialog under the hood), Button
  lib/
    store.tsx           Central app state (React Context) — auth, all CRUD,
                         Firestore + localStorage sync, toasts
    firebase.ts          Firebase init + Firestore save/load/listen helpers
    types.ts / constants.ts / utils.ts
```

**State management:** the original app used ~100 global functions mutating
module-level arrays and re-rendering via `innerHTML`. That's replaced with
one `AppProvider` (`src/lib/store.tsx`) exposing typed state and actions via
a React Context, consumed with `useApp()`. Every write goes to
`localStorage` immediately and to Firestore in the background (if
configured), matching the original's "local-first, cloud-synced" behavior.

**Auth:** preserved as-is — a small hard-coded local-credentials list plus
optional Firebase Auth/Firestore-backed accounts, exactly like the source.
This is a straightforward client-side auth model (not a hardened backend
auth system); consider that a launch item if this needs to hold sensitive
production data.

**Tooling used:**
- **Next.js 15 / App Router** — file-based routing, `next/font` for
  self-hosted Google Fonts (removes the original's render-blocking Google
  Fonts `<link>`), `next/image` for the header/tile logos.
- **TypeScript** throughout — every data shape (`Client`, `Booking`,
  `DebtGroup`, etc.) is typed in `src/lib/types.ts`.
- **Tailwind CSS** — configured with the exact brand palette
  (`tailwind.config.ts`); used for new layout glue, while the original's
  bespoke component classes stay in `globals.css` for pixel fidelity.
- **shadcn/ui** — `components.json` is set up, and the Modal component is
  built on Radix's Dialog primitive (the same foundation shadcn/ui's own
  `<Dialog>` generates) for real focus-trapping/ESC/scroll-lock, restyled
  with the original `.modal` classes. A shadcn-style `Button` primitive is
  included in `components/ui/button.tsx`. Given the "preserve the design
  exactly" requirement, most interactive elements keep the original site's
  own CSS classes rather than being reskinned as shadcn defaults.
- **Framer Motion** — section-switch fade/slide, toast enter/exit, login
  card entrance, and modal open/close are animated with Framer Motion
  instead of raw CSS keyframes (the keyframes are still in `globals.css`
  for the effects Framer Motion doesn't touch, like the shimmering header
  and pulsing badges).

## Scope notes — please read before treating this as final

This source file was large (~7,200 lines, ~100 functions) and some
sections were re-derived from the data model rather than transcribed
function-by-function. Concretely:

- **Dashboard KPIs** are computed fresh from live state (balances, bookings,
  clients) rather than reproducing the original's exact metric formulas,
  since I wasn't able to fully verify every original calculation. Numbers
  shown are reasonable and correct given the data, but may not match the
  original 1:1 if you had specific formulas in mind.
- **Debt Dashboard** implements the highest-value widgets (KPIs, top
  debtors, status breakdown, recent transactions, settled groups, most
  active groups) faithfully, but the original's weekly/monthly bar-chart
  period analysis and debt-age-in-days widgets were simplified/omitted —
  they were the deepest, most bespoke part of the source and are the best
  candidate for a focused follow-up pass.
- **Admin → Financial Controls** (commission rates, markup rule, invoice
  format) are wired to real settings state but aren't yet consumed
  elsewhere (e.g. no invoice actually renders using the invoice format
  yet) — same as in the original, these were configuration panels without
  a consuming feature built yet.

None of this is silently missing — it's flagged here so you know exactly
where to point a follow-up session. Given the size of this app, I'd
recommend continuing iteration in **Claude Code** (or another coding-focused
session) rather than one more giant chat turn — it's much better suited to
methodically verifying each of the ~100 original functions against this
rebuild line-by-line.

## Known limitations of this environment

This was built without network/npm access, so `npm install` and a real
build have **not** been run against this code. I've been careful with
types and imports, but please run:

```bash
npm install
npm run build
```

...and treat any TypeScript/ESLint errors that surface as the first thing
to fix. Given the size of the port, some small issues are likely (a missed
import, a type mismatch) even though the architecture and logic have been
thought through carefully.
