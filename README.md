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

## UI refinement pass (v2)

A follow-up pass modernized the interface without touching the TDIS brand
identity (colors, logo, fonts stayed the same):

- **Icons** — sidebar, breadcrumb, and the new dashboard tiles now use
  `lucide-react` for consistent, professional iconography instead of emoji.
  Other sections still use their original emoji for now — say the word if
  you want those swapped too.
- **Sidebar** — animated active-tab indicator (Framer Motion `layoutId`),
  cleaner icon alignment.
- **Breadcrumb** — added above each section (`TDIS / <section name>`).
- **Cards, tables, forms** — softer shadows, tighter border-radius scale,
  quieter table zebra-striping, calmer focus rings. Since these are shared
  CSS classes, this modernizes every section at once.
- **Loading state** — the old blank screen during the initial auth check is
  now a skeleton shell (`DashboardSkeleton.tsx`).
- **Tablet breakpoint** — added an intermediate 901–1180px layout so tablets
  don't jump straight from desktop to the mobile stacked layout.
- **Dashboard** — rebuilt around a "priority grid" of quick-access tiles
  (see below), with staggered entrance animation.

### Team Management removed (for now)

The Staff Directory section is unlinked from the sidebar and routing per
request, but the component (`StaffSection.tsx`) and its KPI logic are left
intact and untouched. To bring it back:
1. Add an entry back to `SIDEBAR_SECTIONS` in `src/lib/constants.ts`
2. Add a `case "staff": return <StaffSection />;` back into the `renderSection`
   switch in `src/app/page.tsx` (and re-add the import)

### "Update Bookings" → "Available TKT to Issue"

Renamed everywhere: sidebar label, section title, breadcrumb, and the
internal `SectionId` value (`updateBookings` → `availableTkt` in
`src/lib/types.ts`). The component file itself is still named
`UpdateBookingsSection.tsx` — only the exported name used at the import site
in `page.tsx` changed (`AvailableTktSection`), to avoid a risky rename
across the codebase. Rename the file too if you want the filename to match.

### Dashboard priority modules

Per the requested priority order, the dashboard now leads with a tile grid:

| Tile | Status |
|---|---|
| Airline Wallet Balances | **Real** — live total + count needing attention, click-through to Balances |
| Available TKT to Issue | **Real** — live count, click-through to that section |
| Report Generator | Placeholder ("Coming soon") — no report-generation feature exists yet |
| AI Operations Assistant | Placeholder ("Coming soon") — no AI assistant feature exists yet |
| Daily Sales | **Real** — computed from bookings in the last 24 hours |
| Weekly Sales | **Real** — computed from bookings in the last 7 days |
| Recent Reports | Placeholder ("Coming soon") — depends on Report Generator existing first |
| Manual Sync | **Real** — re-pulls all Firestore collections on demand, with a spinning-icon loading state and a "last synced" timestamp |

I didn't invent functionality behind Report Generator / AI Operations
Assistant / Recent Reports since they weren't part of the original app or
anything built so far — happy to scope and build any of them out as a next
step once you confirm what each should actually do.

## Airline Connector Framework

A separate subsystem that automates logging into airline B2B agent portals
(via Playwright) to read and record wallet balances. Phase 1 only — see
scope below.

### Architecture

```
Airline Portal (Crane platform)
        │  Playwright
        ▼
Connector Service  ── standalone Node process, NOT part of this Next.js app
        │
        ▼
PostgreSQL (source of truth)  ── prisma/schema.prisma
        │
        ▼
Sync Service
   ├── Firestore  ── mirrors the balance into the SAME document the
   │                 existing dashboard already listens to in real time,
   │                 so Airlines/Balances tabs update with zero client
   │                 code changes, and a toast fires automatically
   │                 (src/lib/store.tsx diffs the incoming snapshot)
   └── (future) Analytics / Reports
```

**Why two separate deployables:** Playwright needs a real, persistent OS
process with a browser binary — that doesn't run on Vercel/serverless. So:

- **This Next.js app** → deploy anywhere (Vercel is fine). It reads
  wallet/settings/history straight from Postgres (fast, no extra hop) and
  proxies only the actual sync/test *actions* to the connector service.
- **`connector-service/`** → deploy separately, anywhere that gives you a
  persistent process (small VPS, Docker container, Railway/Render/Fly.io
  worker). It's the only thing that ever launches a browser. Full details
  in `connector-service/README.md`.

They talk to each other over a small internal HTTP API, authenticated with
a shared secret (`CONNECTOR_SERVICE_API_KEY`) — never exposed to the
browser.

### What's real vs. placeholder

**Real and complete:**
- Full framework — `IAirlineConnector` interface, `BaseConnector` (retry/
  logging/lifecycle), `BaseCraneConnector` (shared login/nav/balance-read
  logic), `ConnectorRegistry` (DI/factory — Open/Closed compliant), Prisma
  schema (`AirlineWallet`, append-only `AirlineBalanceHistory`,
  `AirlineConnectorSettings`, `AirlineSyncLog`).
- AES-256-GCM credential encryption (`CredentialService.ts`) — plaintext
  never touches Postgres or the frontend.
- Retry with exponential backoff (3 attempts), structured step-by-step
  logging (`LOGIN_STARTED` → `LOGIN_SUCCESS` → `NAVIGATION` →
  `BALANCE_RETRIEVED` → `BALANCE_SAVED` → `LOGOUT`, or `ERROR`).
- Scheduler (`connector-service/src/scheduler.ts`) — per-airline manual /
  every-2-hours / daily-00:00, configurable from Admin without a restart.
- Admin → Airline Connectors tab (enable, credentials, test, manual sync,
  interval, live status) and the Firestore-mirror-triggered toast +
  balance display under each Airlines tab tile.
- All five API routes from the spec, under `/api/connectors/[airline]/*`.

**Placeholder — needs your input before it'll actually work:**
- **CSS selectors.** Every `usernameInput` / `loggedInMarker` /
  `totalBalance` etc. in each airline's config file (e.g.
  `src/modules/airline-connectors/connectors/airpeace/AirPeaceConnector.ts`)
  is a structurally-reasonable guess, not a verified value — I have no
  network access or valid agent credentials to inspect these live,
  authenticated portals. Use `npx playwright codegen <login-url>` against
  each real site to record working selectors, then paste them into that
  airline's config object. Nothing else needs to change — that's the whole
  point of the config-per-airline design.

### Scope (Phase 1 — do not expand without confirming first)

Implemented: Air Peace, Aero, Arik, Ibom, NG Eagle — all on the shared
Crane platform, via `BaseCraneConnector`.

**Not implemented, and not touched:** United, Rano, Enugu Air, XEJet
(different platforms/workflows entirely) — see
`src/modules/airline-connectors/connectors/README.md` for exactly how to
add one later without modifying any existing connector.

**Explicitly out of scope for this framework, by design:** flight search,
ticket issuance, booking automation, refunds, rescheduling. This only ever
reads a balance number and logs out.

### Setup

```bash
# 1. Postgres + Prisma
cp .env.local.example .env.local   # fill in DATABASE_URL at minimum
npx prisma migrate dev --name init

# 2. Generate an encryption key (put the same value in .env.local AND
#    connector-service/.env)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Connector service (separate terminal / separate deploy target)
cd connector-service
npm install
npx playwright install --with-deps chromium
cp .env.example .env   # DATABASE_URL, CONNECTOR_ENCRYPTION_KEY (same as above),
                         # CONNECTOR_SERVICE_API_KEY, FIREBASE_ADMIN_*
npm run dev
```

Then in the main app's `.env.local`, set `CONNECTOR_SERVICE_URL` (e.g.
`http://localhost:4100` for local dev) and the matching
`CONNECTOR_SERVICE_API_KEY`.

### Known gap — API route auth

`/api/connectors/*` routes aren't gated to admin users at the server level
— the existing app's auth is entirely client-side (local-credentials or
Firebase Auth in the browser; see `src/lib/store.tsx`), so there's no
server-side session to check yet. Same limitation the rest of the app
already has, just worth calling out again here since these routes can
trigger real automated logins with real credentials. Add proper
server-side session verification before this handles production
credentials.

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
