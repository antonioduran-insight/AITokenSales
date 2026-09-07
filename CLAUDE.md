# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠ Next.js Version Warning

This project uses **Next.js 16.2.9** with **Turbopack** and **React 19**. APIs, conventions, and file structure differ significantly from older Next.js versions in your training data. Before writing any new page, route, or layout code, read the relevant guide in `node_modules/next/dist/docs/01-app/`. The `middleware` file convention is deprecated — this repo uses `src/middleware.ts` which still works but logs a deprecation warning.

## Commands

```bash
npm run dev      # Start dev server (Turbopack)
npm run build    # Production build + TypeScript check
npm run lint     # ESLint
npm run start    # Start production server
```

**Never use `npx next` or `./node_modules/.bin/next`** — always use `npm run` scripts. There are no tests.

## Architecture

### Route Structure

All user-facing pages live under `src/app/[locale]/` — the `[locale]` segment is always present (`zh`, `en`, `vi`, `es`; default `zh`). The locale is injected by `next-intl` middleware in `src/middleware.ts`.

Two parallel UI systems share the same URL space:

| Path prefix | Layout | Who sees it |
|---|---|---|
| `[locale]/global-admin/` | `GlobalAdminThemeProvider` + `GlobalAdminNavbar` | `admin_global` role only |
| All other `[locale]/` routes | `AppShell` + collapsible `Sidebar` | `admin` and `sdr` roles |

`AppShell` (server component) reads the session and org plan SSR, passes them to `UserProvider`. `GlobalAdminLayout` does its own SSR auth check and redirects non-`admin_global` users to `/kanban`.

**Admin-only pages within `AppShell` must gate themselves — `AppShell` does not do it for them.** Unlike `GlobalAdminLayout`, `AppShell` renders `children` for `admin` and `sdr` alike; RLS is what actually stops an SDR from seeing another area's/org's data, but a page that still mounts and renders an empty shell for a role that shouldn't be there is fragile (FUNC-F12) — any future component on that page doing a service-role fetch or showing an aggregate count could leak data without anyone noticing. `blockSdrAccess(locale)` (`src/lib/utils/route-guard.ts`) is the shared SSR check — call it at the top of an **async server component** page (not a client component) before rendering anything, mirroring `GlobalAdminLayout`'s own pattern. Applied to every admin-only page: `/admin/users`, `/audit`, `/history`, `/bridge`, `(scraper)/dashboard`, `(scraper)/run`, and `(scraper)/export`. Every one of these follows the same split where the page itself was a client component: `page.tsx` is a thin async server component that does only the check, and delegates rendering to a same-named `*Client.tsx` file in the same directory (`HistoryClient.tsx`, `DashboardClient.tsx`, `RunClient.tsx`, `ExportClient.tsx`, `BridgeClient.tsx`) — copy that shape for any new admin-only page rather than inlining the check into a client component (which can't do the SSR redirect at all).

### Three Supabase Client Types

Never mix these — they have different auth and RLS behavior:

```typescript
// 1. Browser client — ANON_KEY, RLS enforced
import { createClient } from '@/lib/supabase/client'

// 2. Server client (SSR/API routes) — ANON_KEY, session from cookies, RLS enforced
import { createClient } from '@/lib/supabase/server'   // async, must be awaited

// 3. Admin client — SERVICE_ROLE_KEY, bypasses RLS entirely, API routes only
import { createAdminClient } from '@/lib/supabase/admin'
// or inline:
import { createClient as createAdminClient } from '@supabase/supabase-js'
const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
```

The admin client is **only used inside `src/app/api/` route handlers**. Never in client or server components.

### Role System & Data Isolation

Four roles: `admin_global`, `admin`, `sdr`, `support`. Stored in `public.users.role`.

- `admin_global` — Global Admin panel; org data via service-role calls
- `admin` — full access to own org; RLS scopes all queries to `organization_id`. **Only role that can use the Scraper and Bridge.**
- `sdr` — sees only prospects in their assigned `area_id`. **No scraper or Bridge access at all.**

The middleware sets `user_role` and `user_org_id` cookies on every request. Client components read role from `useUser()` context. Admin status is derived two ways:
- **In CRM pages**: `useUser()` → `user.role === 'admin'`
- **In org-context hooks**: `useOrgId()` — also handles impersonation (`isAdmin = true` when impersonating)

### Impersonation

Global Admin views any org's CRM as read-only by appending `?impersonate_org_id=<uuid>&impersonate_org_name=<name>` to any CRM URL. Data-fetching components check `isImpersonating` from `useOrgId()` and route through `/api/crm/[table]` (service-role proxy) instead of direct Supabase calls. All write operations short-circuit when `isImpersonating` is true.

### API Routes Pattern

All cross-RLS operations are Next.js API routes using the admin client. Every route validates the caller with an internal session/role check before proceeding.

One proxy to the external Python backend:

| Proxy | Auth | Behaviour |
|---|---|---|
| `/api/bridge/[...path]` | session + `admin` + `bridge` add-on | **Overwrites** `organization_id` in the query and body with the session-derived value, and injects `apify_token` on `POST /bridge/runs`. `bridgeApi` in `src/lib/bridge-api.ts` wraps it. |

**`bridge_runs` follows the exact same create-then-call pattern as the main scraper's `runs` table** — it's a real table in the same Supabase project (`organization_id`, `seed_list_id`, `status` default `'pending'`, `total_candidates`, `started_at`/`completed_at`, `error_message`), just lighter (no `run_sdr_assignments`-equivalent, no quota tracking). The proxy's `POST /bridge/runs` handler **inserts this row first** and passes its real `id` as `run_id` in the backend request — the backend looks up and validates that row (422/404 if `run_id` is missing or doesn't exist) rather than minting its own, then updates it as the run progresses. `GET /bridge/runs/[id]` and `GET /bridge/runs/[id]/logs` stay pure passthroughs to the backend, which reads this same row — there is no separate local read path to keep in sync. On a backend rejection or network failure, the proxy marks the row `failed` with `error_message` so it never sits at `pending` forever. The response to the client always has `id`/`run_id` forced to the row's real id, regardless of what shape the backend echoes — do not go back to trusting/parsing the backend's response for this.

**Bare `GET /bridge/runs` (list, no id) is NOT proxied — the backend only implements `POST /bridge/runs` and 405s on GET.** The proxy short-circuits that one exact path+method to read `bridge_runs` directly via the admin client instead, the same way `/api/runs` (GET) reads `runs` straight from Supabase rather than asking the scraper backend to list anything. `GET /bridge/runs/[id]` (single, with id) is a *different* path string and keeps proxying to the backend as normal — don't conflate the two when touching this file.

**`POST /bridge/seed-lists` needs its payload transformed, not just passed through — the CRM form's field names never matched the backend's schema.** The form sends `companies`/`criteria: { industry, headcounts, market }`; the backend's Pydantic model expects `company_names`/`company_headcounts`/`geo_codes`/`industry_codes` and silently drops anything it doesn't recognise instead of erroring — every seed list created before this was caught had empty `company_names`/`company_headcounts`/`geo_codes`/`industry_codes` on the backend, with zero visible error anywhere. The proxy renames `companies` → `company_names` and `criteria.headcounts` → `company_headcounts` directly, resolves `criteria.market` (a single country name from `MarketSelect`) to `geo_codes` via a lookup against the `markets` table's `geo_code` column, and passes `criteria.industry_ids` straight through as `industry_codes`.

**The industry gap is closed — this file used to say no name-to-code mapping existed anywhere in the project, and that is no longer true.** `src/lib/industry-codes.ts` holds the 434 LinkedIn industry ids HarvestAPI's `industryIds` filter accepts, each with the coarse group the picker uses to make them navigable; it is a **generated file** (`node scripts/generate-industry-codes.mjs`, sourced from HarvestAPI's published CSV) — regenerate it, never hand-edit it. Because the picker in `BridgeClient.tsx` sends real ids, the proxy has nothing left to resolve: it filters the array to numbers and forwards it. The old free-text Industry field was decorative — it accepted text, counted toward "this seed list has criteria", and then filtered nothing.

**The same transform runs on `PATCH /bridge/seed-lists/{id}`, and must.** The edit form sends the same shape the create form does, so a PATCH carrying `companies`/`criteria` would be silently dropped by Pydantic exactly as the original creates were. On PATCH only the keys the client actually sent are translated — the backend distinguishes "absent" (leave alone) from "empty" (clear), so writing a default `[]` for an untouched key would erase filters the user never opened, and renaming a list would wipe its companies.

**Seed lists have no local table — deleting one is a pure passthrough `DELETE /bridge/seed-lists/[id]`, same as create/list.** Unlike `bridge_runs` (a real CRM-owned table), seed lists live entirely on the backend; the proxy has no special-casing for this path, it just forwards through the generic non-GET branch (which already injects `organization_id` into the body). **This depends on the backend actually implementing that DELETE route — unverified from the CRM side**, same caveat as the seed-list payload fix above; if it 404s/405s, that's the backend, not this proxy. Deleting a seed list that already has `bridge_runs` referencing it is allowed (not blocked) — those old runs are left with a `seed_list_id` that no longer resolves, which the UI already handles gracefully (falls back to a generic "Seed list" label instead of erroring).

The scraper backend has **no** catch-all proxy — a `/api/scraper/[...path]` passthrough existed but was deleted (no consumers, and it was unauthenticated). Scraper traffic goes through purpose-built routes (`/api/runs*`, `/api/scraper/to-crm`) that each do their own auth and org scoping.

**Never add a generic passthrough proxy.** If a new backend endpoint is needed, either add a purpose-built route or follow the Bridge shape: verify session → verify role from the DB → gate on whatever the feature requires → overwrite `organization_id` server-side. Never trust a client-supplied `organization_id`.

**Every outbound backend call must use `backendHeaders()`** from `src/lib/scraper-backend.ts` — it adds the `X-Internal-Api-Key` shared secret (`INTERNAL_API_KEY`, server-only) that the backend requires. Never hand-write `{ 'Content-Type': 'application/json' }` for a backend fetch.

**When adding an add-on-gated feature, gate it in the UI *and* re-check server-side in the API route.** UI gating is never the security boundary.

### Styling Convention

**No Tailwind in component JSX.** All styles are inline style objects. A `const S: Record<string, React.CSSProperties>` object at the top of each file holds shared styles.

**Responsive layout is an ongoing effort (mobile + tablet) — convention: CSS classes in `globals.css`, not inline styles, not a `useMediaQuery` hook.** Inline `style` objects can't express `@media` queries, and a JS resize-based hook would re-render on every resize and flash the wrong layout on first paint (no real value during SSR). Instead: a small, growing set of semantic classes in `globals.css` (`.crm-sidebar`, `.crm-mobile-menu-btn`, `.crm-sidebar-backdrop`, `.crm-stack-mobile`, `.crm-hide-mobile`, `.crm-hide-desktop`) hold only the *layout-critical* properties that must differ per breakpoint (`position`, `transform`, `width`, `display`) — applied via `className` alongside the existing inline `style` prop, which keeps handling colors/fonts/spacing exactly as before. Breakpoints: mobile/phone `<= 767px`, tablet `768–1024px`, desktop `>= 1025px` (no override — current behavior). Because these overrides sit in an external stylesheet competing with an inline style for the *same* property, the mobile-only rules use `!important` deliberately — that's the correct, standard way to override an inline style at a specific breakpoint, not a hack to avoid.

The shell (`AppShell.tsx` + `Sidebar.tsx`) was the first piece done, since a fixed 240px sidebar sitting beside content in a flex row broke every single page on phone width regardless of that page's own layout. Below 767px the sidebar becomes a slide-in drawer (`position: fixed`, `transform: translateX(-100%)` when closed) triggered by a hamburger button in `AppShell`'s header, with a click-to-close backdrop; state (`mobileNavOpen`) lives in `AppShell` and is passed down since the trigger (header) and the drawer (`Sidebar`) are different components. Every nav `<Link>` in `Sidebar` calls `onCloseMobile` so navigating closes the drawer automatically. Tablet and desktop are untouched — the existing collapse-to-icons toggle still works exactly as before at `>= 768px`. Global Admin has its own separate layout/navbar (not `AppShell`) and has **not** been made responsive yet — lower priority, internal-only tool.

**`isIconOnly`, not the raw `collapsed` state, drives every layout decision in `Sidebar.tsx`.** The desktop "collapse to icons" preference is persisted in `localStorage` and must never leak into the mobile drawer — a 240px-wide overlay has no reason to hide labels just because the user once collapsed the desktop sidebar. `isIconOnly = collapsed && !mobileOpen`; the raw `collapsed` state is only read by the toggle button itself (which is hidden on mobile via `.crm-hide-mobile` anyway) and by `toggleCollapsed()`/its `localStorage` persistence. If you add a new item to the sidebar, gate its label/padding/justify-content on `isIconOnly`, not `collapsed`.

**Kanban drag-and-drop needs explicit touch handling — the dnd-kit defaults don't work reliably on a touchscreen inside a horizontally-scrolling container.** `KanbanBoard.tsx`'s `<DndContext>` configures `PointerSensor` with `activationConstraint: { distance: 8 }` (a drag only starts after 8px of real movement, so a tap reliably opens the card instead of misfiring as a micro-drag) and `ProspectCard.tsx`'s draggable root sets `touchAction: 'none'` (without it, the browser's native scroll gesture — this container scrolls horizontally between columns — competes with dnd-kit's pointer tracking and drag effectively doesn't activate on touch). Both are required together; either alone leaves touch drag broken or flaky.

**Wide tables and multi-column boards are responsive via horizontal scroll, not a mobile-specific card layout.** `ProspectsTable.tsx`'s table and `KanbanBoard.tsx`'s column row both already sit in `overflow(-x): auto` containers — on phone width they scroll sideways rather than breaking the page (this only works because of the shell's `min-width: 0` fix; without it a flex child refuses to shrink below its content's intrinsic width and forces the whole page wider). This is a deliberate scope choice, not an oversight: restructuring a data table into per-row cards for mobile is a much larger, separate redesign, not attempted here. What *is* required on every filter/action bar is `flexWrap: 'wrap'` (plus `rowGap`) so it drops to a second line instead of overflowing — check for a bare `<div style={{ flex: 1 }} />` spacer used to push trailing buttons right (the Kanban header had one): that pattern doesn't wrap predictably and is better replaced with two `justify-content: space-between` groups, as done there.

**`RunClient.tsx` (New Run) needed zero responsive changes** — it was already built with `maxWidth` caps, `flexWrap` on its preset/pill rows, and `RegionMarketSelect`'s `gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))'` country grid, which is auto-responsive without a media query at all. Worth checking a page against the checklist before assuming it needs work.

**Two-column `display: 'grid', gridTemplateColumns: '1fr 1fr'` forms (e.g. Settings' Org fields, sender-profile create form) need the `crm-grid-1-mobile` class** — inline `gridTemplateColumns` can't be overridden per-breakpoint any other way, and two fixed columns get too narrow on phone width even though each field is individually `width: '100%'`. The class collapses to a single column below 767px; `gridColumn: 'span 2'` children are unaffected (harmless in a 1-column grid).

**Any `justify-content: space-between` row pairing an unbounded-length text field (name, email, title+company) with a fixed-width sibling (date, badge, action buttons) needs the text side wrapped in `flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'`.** Without `minWidth: 0` the text refuses to shrink and pushes the sibling off-screen or forces the row wider than its card — this pattern recurred three times in Settings alone (Active SDRs list, sender-profile list, and would recur anywhere a name/email pair is rendered this way). Fixed-width modals also need `maxWidth: '90vw', boxSizing: 'border-box'` alongside their pixel `width` — one modal (Settings' "Buy More Seats") was found missing it and would have overflowed a narrow phone screen edge-to-edge.

**A grid using `minmax(340px, 1fr)` (or any `Npx` bigger than the smallest supported phone) with `auto-fill`/`auto-fit` is a guaranteed overflow bug, not just a squeeze** — unlike a flex row, a grid track's `minmax` floor is a hard minimum: on a viewport narrower than that floor plus padding, the single implicit column still renders at the floor width and the grid overflows its container horizontally. Found in Convertidos' closed-deal card grid (`minmax(340px, 1fr)`, guaranteed overflow under ~388px viewport). Fix by wrapping the floor in `min()`: `minmax(min(340px, 100%), 1fr)` — the track shrinks to the container's full width instead of the fixed floor once the floor no longer fits, no media query needed. `RegionMarketSelect`'s `minmax(150px, 1fr)` never had this problem because 150px comfortably fits even the narrowest supported phone; the bug only bites when the floor is close to or bigger than a phone viewport.

**`crm-grid-1-mobile` isn't limited to `1fr 1fr` grids — it forces `grid-template-columns: 1fr !important` regardless of the original definition,** so it also fixes a fixed-plus-flexible mix like `'200px 1fr 1fr'` (found in `StatsDashboard`'s Conversion Rate cards). Reach for it any time a `display: 'grid'` container needs to become one column on phone width, not just literal two-equal-column ones.

**Global Admin (`crm-grid-1-mobile` and the other `globals.css` responsive classes work there too — they're plain CSS classes, not scoped to the CRM theme)** despite having its own color system (`useGlobalAdminTheme()` → `colors.*`, not `var(--crm-*)`) and its own layout (`GlobalAdminNavbar`, not `AppShell`/`Sidebar`). It had **zero** responsive treatment before Block 4 — every header row, table, and multi-column grid across Organizations/Vendors/Revenue needed the same fixes as the main CRM. One difference: `GlobalAdminNavbar` got a wrapping top nav (`flexWrap: 'wrap'` on the `<nav>` and its two inner groups, `height: 56` → `minHeight: 56`) rather than a hamburger/drawer — this is an internal, `admin_global`-only tool with only 3 nav links, so a wrapping navbar was judged sufficient without building a second drawer implementation. Its data tables (10-column Organizations list, 5-column Vendors, MRR-by-org/Revenue-by-vendor) used `overflow: 'hidden'` on the bordered wrapper (for rounded corners) instead of `overflow: 'auto'` — that silently clips overflowing columns rather than making them scrollable; the fix is always `overflow: 'auto'` (auto still respects `border-radius` for clipping, but adds a scrollbar instead of hiding content) plus a `minWidth` on the `<table>` sized to its column count.

**A `display: 'grid'` row with several fixed-pixel columns (e.g. a table-style header + row pair: `'1fr 100px 100px 140px 80px'`) needs the same horizontal-scroll treatment as a wide `<table>`, not `crm-grid-1-mobile`** — stacking a table-like row into one column per cell destroys the tabular alignment between the header and every data row. Instead wrap the row in its own `overflow-x: auto` div and give the grid an explicit `minWidth` (sum of the fixed columns + gaps + a reasonable floor for the `1fr` column) so it scrolls as a unit instead of squeezing unreadably thin. Found in Support's ticket list (header row + each ticket's summary row scroll independently, each with a matching `minWidth` so columns still visually align at scroll position 0) — this was the worst overflow bug found in the whole responsive pass (400px+ of non-shrinking fixed columns with zero protection).

**Dark theme only.** The CRM light theme and its toggle were removed — do not reintroduce `data-theme`, `crm_theme` or light-mode CSS variables. Tokens:

```
bg:            #0A0A0F
surface:       #13131A
surfaceRaised: #1C1C27
border:        #2A2A3A
textMuted:     #52526A
textSecondary: #8B8BA0
accent:        #6C63FF
```

### Global Admin Theme

Global Admin has its own theme system (`GlobalAdminThemeContext`) with dark/light toggle and zh/en i18n, separate from the CRM. Use `useGlobalAdminTheme()` inside Global Admin components to get `colors`, `t()`, and `toggleTheme()`. Persisted in `localStorage` (`ga_theme`, `ga_lang`). **This one stays** — only the CRM toggle was removed.

## Critical Data Gotchas

**Lead counting** — Never count *billable* leads via `prospects.organization_id`. The column **does exist** (FK to `organizations`; this file previously claimed otherwise, and the claim was verified false against production on 05/08 — it also contradicted the uniqueness note below, which references the same column). It is fine for scoping a query to one org; it is the wrong basis for **quota**, because a prospect row is not the billing unit — the same scraped lead can exist on several SDRs' boards, and CSV/manual prospects were never scraped at all.
- Calendar-month totals live in `monthly_lead_counts`, keyed by `(organization_id, year_month)` where `year_month = 'YYYY-MM'`.
- The **quota that actually gates runs** renews on the org's `billing_day`, not the calendar month. Use `getLeadQuota()` in `src/lib/utils/lead-quota.ts`, which counts `scraper_leads` with `exported_to_crm = true` inside `currentBillingPeriod(billing_day)`.

**One SDR per scraper run** — A run has exactly one recipient. `POST /api/runs` and `/api/runs/[id]/assign` take **`sdr_id` (singular)**; `sdr_ids[0]` is still accepted defensively. There is no round-robin or split — every lead goes to that SDR. Exactly one `run_sdr_assignments` row per run.

**New Run market picker is region-first** — Phase 1 picks one region (`AreaName`), then multi-selects specific countries within it (all preselected from the org's activated markets, admin can uncheck). `POST /api/runs` takes `markets: string[]` (the checked countries) and `region` (reference/logging only, stored on `runs.region`). SDR eligibility filters on `region` directly — never re-infer it from a country name when the region was already explicitly chosen. `assigned_markets` on `run_sdr_assignments` must receive the full `markets` array both at creation **and** when `/api/runs/[id]/assign` re-upserts it on completion — sending only `market` (singular) there silently collapses a multi-country run down to one country.

**Never treat `run_sdr_assignments` as proof of assignment** — the Railway backend writes those rows itself when a run completes. Gating the auto-assign on `leads_assigned > 0` caused leads to never reach `prospects`. The assign endpoint is idempotent, so always call it.

**Auto-assign has three layers now — a server-to-server webhook is the primary path, not the client.** In order of expected latency:
1. **`POST /api/runs/[id]/complete`** — the scraper backend (or a Supabase Database Webhook on `runs` for `status` → `completed`) calls this the instant a run finishes. Authenticated by `X-Internal-Api-Key` (the same shared secret as `backendHeaders()`, reused for the reverse direction — no new secret to provision). Trusts nothing from the request body: it resolves `sdr_id`/`assigned_markets` itself from the run's own `run_sdr_assignments` row, and only acts when that row is unambiguous (exactly one), same rule as the cron below.
2. **Client-side optimistic assign** — New Run's `poll()` (`src/app/[locale]/(scraper)/run/RunClient.tsx`) still calls `/api/runs/[id]/assign` the moment it observes `status === 'completed'`, for a fast UI-visible confirmation when the admin stays on screen. No longer the only path, so its unreliability (below) is now a UX nicety, not a correctness risk. Things to keep in mind when touching that file:
   - A transient status-read failure (backend redeploy, 5xx, network blip) must **never** be treated the same as `status === 'failed'`. Only an authoritative 404/403 (run gone / access lost) should stop polling and route to the failure screen; everything else should keep polling indefinitely and show a soft "reconnecting" state.
   - `runAssign()` must not depend solely on `localStorage`/in-memory state for the `sdr_id` — that state is lost if the tab is closed and reopened later, or if a second run overwrites the single `scraper_active_run` localStorage key. Always fall back to `run_sdr_assignments[0].sdr_id` from the freshly-polled run (already returned by `GET /api/runs/[id]`), since that row is written server-side when the run is created.
   - **The `scraper_active_run` localStorage pointer is only ever implicitly restored if it's recent.** It carries a `startedAt` timestamp now; on mount, anything older than `MAX_RESTORE_AGE_MS` (1 hour) — or missing a timestamp at all, which every entry written before this fix will be — is dropped and the key is cleared, regardless of what phase or status it points to. Without this, a `failed`/`cancelled` run's pointer (deliberately *not* cleared by `poll()`, so a same-session reload still shows the error) survives indefinitely until the user explicitly clicks "New Run"/"Try Again" — closing the tab or navigating away instead means the *next* visit to New Run silently resurrects a days-old run's Phase 2 or Phase 3 screen with zero explicit action from the user. An explicit `?run=` query param (e.g. from History's "View Details") is exempt from this check — that's an intentional navigation to a specific run, not an implicit restore, and should show that run's state no matter how old it is.
3. **`GET /api/cron/reconcile-runs`** — a daily Vercel Cron safety net (`vercel.json`) for whatever the webhook and the client both miss (webhook call fails, tab closed *and* the webhook never fires for some reason). Scans for `completed` runs with `scraper_leads.exported_to_crm = false` and exactly one `run_sdr_assignments` row, and assigns them. Runs with zero or multiple assignment rows are **skipped and reported, never guessed at** — a manual "Send to another SDR" can leave a run with several rows, and picking the wrong one has real business cost (quota, commission, lead ownership).

All three call the same `assignRunLeads()` (`src/lib/utils/run-assign.ts`) and are safe to race — the unique-key guard makes a duplicate assignment a no-op regardless of which layer got there first.

**UPDATE 29/07 — the project was transferred to the `Insight Software` Vercel team, which is on a
Pro TRIAL, so the once-per-day ceiling does not currently apply.** The schedule is now hourly
(`0 * * * *`), cutting the worst-case delay for a lead that both the webhook and the client
missed from 24h to 1h. Verified working: the cron is enabled, registered as `0 * * * *`, and its
last invocation returned `200`.

**"Pro trial", not paid Pro — treat the hourly schedule as borrowed, not owned.** The trial has
every Pro feature, but the team is deliberately not paying yet while they evaluate Vercel against
AWS. If the trial lapses without converting, the scope silently reverts to Hobby and the hourly
cron below becomes a deploy-blocker for **every** future push, including unrelated commits, with
no error surfaced in `git push`. Whoever notices the deploys failing should suspect this first and
set the schedule back to `0 3 * * *`.

`CRON_SECRET` and `INTERNAL_API_KEY` **are** configured in Vercel (Production + Preview, added
23–24/07). They are absent from the local `.env.local`, which matters only for `npm run dev` —
do not infer the Vercel state from the local file, they are unrelated stores.

**`vercel.json`'s cron schedule must stay Hobby-compatible (once per day) unless the plan is confirmed Pro+.** Vercel validates every cron in `vercel.json` at deploy time and **rejects the whole deployment** — not just the cron — if any schedule would fire more than once a day on a Hobby plan. A `*/10 * * * *` schedule silently blocked every single deploy (including unrelated commits) until this was caught, with zero error visible in the GitHub push itself — check the Vercel Deployments tab, not just `git push` exit codes, when changing this file.

Both paths call the same `assignRunLeads()` in `src/lib/utils/run-assign.ts` — **never reimplement the assign logic inline in a route handler.** It's idempotent, so the client and cron paths racing each other is safe.

**Prospect uniqueness** — `prospects` is unique on `(organization_id, linkedin_url, assigned_to)`, so the same lead can live on more than one SDR's board. Insert paths must tolerate `23505` row-by-row rather than aborting a whole batch. It is a partial unique **index** (`prospects_linkedin_assignee_unique`, `WHERE linkedin_url IS NOT NULL`), not a table constraint — so it does **not** appear in `pg_constraint`; check `pg_indexes` before concluding it's missing.

**`prospects_email_unique` is global, not per-org — this is a cross-tenant bug, not a design choice.** `CREATE UNIQUE INDEX prospects_email_unique ON prospects (email) WHERE email IS NOT NULL` has no `organization_id` in it, unlike the LinkedIn index directly above. Once two orgs prospect overlapping markets, whichever one gets an email address first permanently blocks every other org from ever holding that contact: the insert fails with `23505`, and because every insert path deliberately tolerates `23505` row-by-row, the second org's lead is **silently dropped with no error surfaced anywhere**. Not yet observed in production (one real org today), and it becomes likely the moment there are several. **Fixed by `supabase/migrations/20260805_prospects_email_unique_per_org.sql`**, which rebuilds it as `prospects_org_email_unique` on `(organization_id, email)` to match the LinkedIn index. That migration creates the new index *before* dropping the old one, deliberately: global uniqueness is strictly stronger than per-org uniqueness, so the CREATE cannot fail while the old index still exists — reversing the order risks leaving the table with no email protection at all.

**CSV import (`CSVImportWizard.tsx`) assigns to an SDR, not an area, and its dedup is org-wide.** Step 2 used to be "pick an area, the lead self-assigns to whichever admin runs the import" — it's now "pick an SDR" (the area is derived from that SDR's `area_id`), because a lead always needs a real owner and admin-self-assignment was never a meaningful destination. This applies to **every** CSV import now, not just ones with pre-written messages — the two were unified into one flow rather than kept as separate wizards, since column mapping already recognized `custom1`/`custom2` (connection/follow-up messages) before this change. A warning banner ("these leads already have messages generated for X") shows in the mapping step only when a message column is actually mapped, so a plain lead import doesn't show a warning that doesn't apply. `POST /api/import`'s dedup check was also widened from area-scoped to org-scoped, and now checks `scraper_leads` in addition to `prospects` (both by `linkedin_url`) — a lead already scraped-but-not-yet-exported, or already sitting on a *different* SDR's board, now correctly surfaces as a duplicate instead of only catching same-area collisions. An SDR importing for themselves is unaffected — they never see the SDR picker and still self-assign, same as before.

**`pipeline_stages` maps 1:1 to `outreach_status` via an explicit, fixed column — never positionally — and is now read-only from the app.** (FUNC-F8 fix, then the Settings → Pipeline editor itself was removed entirely as no longer useful once the mapping was fixed.) Every org always has exactly one `pipeline_stages` row per `OutreachStatus` value, enforced by `UNIQUE (organization_id, outreach_status)`. The table still exists and is still read — `KanbanBoard.tsx` always renders columns in the fixed `OUTREACH_STATUSES` funnel order and looks up each one's custom label/color via `stageMap.get(status)`, keyed by `outreach_status` (not `position`, which is a vestigial column kept only to avoid a schema rewrite) — so whatever `name`/`color` an org had configured keeps showing. There is simply **no UI left to change it anymore**: no Settings tab, no `/api/settings/pipeline-stages` route (deleted), no add/delete/reorder. A `name`/`color` change now requires a direct DB edit. See `supabase/migrations/20260726_pipeline_stage_status_mapping.sql` for the migration that established the 1:1 mapping in the first place.

**Closing a deal is gated behind a mandatory chat upload.** Moving a lead to `outreach_status = 'closed'` — from Kanban drag-and-drop (`KanbanBoard.handleDragEnd`) or the status dropdown in `ProspectDrawer` (shared by Kanban and Leads) — does not commit immediately. It opens `CloseDealModal` (`src/components/conversations/CloseDealModal.tsx`) first; the status write only happens once the modal resolves via "Save & close" (which also inserts a `conversations` row) or "Skip for now" (status only). Dismissing the modal (backdrop/X) aborts the move entirely — nothing is written. A closed prospect with zero `conversations` rows is flagged with a "Missing conversation" badge (red `MessageSquareWarning` icon) on both the Kanban card and the Leads table row, driven by `GET /api/conversations/counts` — the same derived-state approach the Convertidos page already used, now surfaced where reps actually work day-to-day instead of only on a separately-visited page.

**`icp_score` means something now, and it means something DIFFERENT from what it used to.** The scorer lives in the scraper repo (`scraper/icp_scorer.py`, which carries the full write-up at the top of the file). What changed:

- It scores a lead's title against **the run's own combos** — the org's chosen target titles, which since `20260904_org_owned_combos.sql` the org can write itself — plus seniority, plus a buying signal built from the org's `company_context`. The three constants that used to hand every lead 40 points for company size, industry and "LinkedIn activity" are gone, along with the hardcoded AI/CTO keyword lists that described only Insight Software's own buyer.
- Matching is phrase-based and script-aware (`scraper/text_match.py`), so `Director` no longer scores as a CTO (dire-**cto**-r), `Chief Technology Officer` no longer scores zero, and 資訊主管 matches inside 資深資訊主管.
- A component the ORG hasn't configured is left out of the denominator rather than scored as zero, so the number is always "this share of what we could actually check". An org with no `company_context` still gets a full 0-100 scale.

**Leads scored before that shipped keep their old numbers and are not comparable.** They are deliberately not backfilled: `scraper_leads` has no `about` column, so the buying-signal component cannot be recomputed for a past lead and a backfill would invent a third scale rather than restore the second. Treat a pre-cutover score as unknown; sort and filter within a period. This is visible to SDRs — a lead that was WARM under the old scale and a lead that is WARM under the new one did not pass the same test.

**Anthropic base URL** — Always run values through `normalizeAnthropicBaseUrl()` (`src/lib/utils/anthropic.ts`) before persisting. The backend appends `/v1` itself; storing a URL that already ends in `/v1` produces the `/v1/v1` error.

**INT limits** — Postgres `int4` max is `2147483647`. Ultra plan seats/leads use this value for "unlimited". Always `MAX_INT = 2147483647`. Display as `∞` when `value >= MAX_INT`.

**Plan defaults** — Defined once in `PLAN_DEFAULTS` (`src/lib/types.ts`); apply immediately when a plan is selected in any org form:
```typescript
basic:      { max_seats: 3,       max_leads_per_month: 1000 }
premium:    { max_seats: 7,       max_leads_per_month: 3000 }
enterprise: { max_seats: 15,      max_leads_per_month: 10000 }
ultra:      { max_seats: MAX_INT, max_leads_per_month: MAX_INT }
demo:       { max_seats: 3,       max_leads_per_month: 200 }
```

**`demo` is a trial plan, and tier gating goes through two predicates — never an inline plan list.** `planHasFullAccess(plan)` (true for `ultra` and `demo`) decides whether a plan sees every feature; `isBillablePlan(plan)` (false for `ultra` and `demo`) decides whether its org reaches MRR, the quarter breakdown and vendor commission. Both live in `types.ts`.

They exist because the gates used to be inline lists — `plan === 'ultra' || plan === 'enterprise' || ...` in `PremiumFeature`, `plan === 'ultra'` twice in each revenue view — so adding a plan meant finding every one of them, and missing one fails in the worst direction each time: a prospect hits a padlock mid-demo, or an unpaid trial shows up as revenue. Any new gate must call the predicate.

Three consequences worth knowing before touching the plan system:

- **A demo sees features Basic and Premium don't include.** That was chosen deliberately (a demo that hides half the product isn't a demo), and it means whoever runs the demo has to say which plan each feature actually lands on.
- **Every add-on lists `demo` in its `plans`,** so any of them can be switched on for a trial — including the Enterprise-only ones. None of it is invoiced.
- **There is no expiry.** A trial ends when someone deactivates the org with the existing toggle. `demo_expires_at` plus a cron is the obvious next step if trials start being forgotten; it was deliberately not built up front.

**Resetting a demo wipes DATA and keeps SETUP** — `reset_organization_data(uuid)` (`supabase/migrations/20260907_reset_organization_data.sql`, **run by hand**), behind `POST /api/global-admin/organizations/[id]/reset` and a button in the org's danger zone. Deletes leads, scraper leads, runs, conversations, notes, audit trail, CSV sessions, all Bridge data, support tickets and `monthly_lead_counts`; keeps the org row, users, areas, sender profiles, add-ons, markets, combos, pipeline stages and workspaces. Deleting `scraper_leads` is what gives the lead quota back — `getLeadQuota()` derives it from that table, not from `prospects`.

Three constraints on it, all deliberate:

- **`demo` plans only**, enforced in the route. It is irreversible and one click from a customer's whole pipeline; the plan check is what makes a misclick survivable. Resetting anything else means calling the function in the SQL editor, and that friction is the design.
- **It never touches `auth.users`.** Keeping the people is what keeps the whole thing inside one transaction — auth accounts live outside it and cannot roll back with it, which is exactly how `testorg` ended up half-destroyed in August. Removing a test SDR is a job for Users in the CRM, which handles auth through its own API.
- **Order follows the FK graph in `20260805_delete_organization_fn.sql`.** The NO ACTION edges pointing at `prospects` (`audit_log`, `conversations`, `notes`) must be cleared first, and each is deleted twice — by `organization_id` and by `prospect_id` — because a row with a null or stale org column still blocks the lead it references.

**`requireGlobalAdmin()` in `route-guard.ts` is the shared API-route gate.** Nine older route files each declare a private `verifyGlobalAdmin` copy; they agree by luck, not design. New global-admin routes import the shared one — a route that gets this check subtly wrong is a cross-tenant hole.

**The customer-facing price card in Settings needs a branch per plan, and its fallback is `$550`.** A plan without its own branch tells that customer they are paying Basic's price — which is how `demo` would have greeted a prospect with an invoice for a trial. Check that card whenever a plan is added.

**Billing day default** — Always `10` (not 1).

**Markets are per-org, never hardcoded** — the catalogue lives in the backend-owned `markets` table (~49 countries across Asia / Latin America / Europe / USA) and each org activates a subset in `organization_markets`. Any surface that asks for a market must read the org's list via `useOrgMarkets()` and render `<MarketSelect>` — never a literal array of country names. Because the backend owns the table, `/api/markets` normalises the column names it reads (`name|country|label`, `region|area|continent`).

**Areas and market regions share one vocabulary** — `AreaName = 'asia' | 'latin_america' | 'europe' | 'usa'`, and `areas.name` (how SDRs are classified) uses exactly the same values as `markets.region`. A market's region *is* an area; there is no translation layer.

`inferAreaFromCountry(marketName, map)` is **synchronous** and takes a prebuilt `MarketAreaMap`. Build it once per page with `useMarketAreaMap()` (which reads the full catalogue) — never query per call, since list views resolve an area per row. Unknown markets return `null`, which callers treat as "no filter" (show every SDR) rather than "no matches". The old hardcoded `countryToArea` dictionary is gone.

**Add-ons** — `ADDON_LIST` in `src/lib/types.ts` is the single source of truth: it drives the Global Admin toggles, the customer's Settings list and Revenue Reports at once. Adding one needs an `ADDON_LIST` entry **and** a migration widening the `addon_type` CHECK. **Retiring one needs only the `ADDON_LIST` removal** — do NOT narrow the CHECK, or the constraint starts rejecting rows the table already holds (`account_management`, retired 05/08/2026, is exactly this case).

Each entry carries `plans` (where it can be SOLD) and `includedIn` (where the plan already bundles it, so selling it again double-charges). Both are enforced server-side in `POST /api/global-admin/organizations/[id]/addons` and `create-org`, against the org's **saved** plan — never one supplied by the client. An add-on already active on a plan that can no longer sell it is deliberately **left on**: silently revoking a paid feature is worse than an inconsistent row, so Global Admin flags it in amber instead.

Two prices, deliberately in separate maps: `ADDON_MONTHLY_PRICE` (recurring) and `ADDON_ONE_TIME_PRICE` (charged once, recognised in the quarter of the `addon_audit_log` activation). One map with a "recurring?" flag is how `sso` ended up adding $99/mo of phantom MRR for months while `ADDON_LIST` said "$299 one-time". `multi_workspace` is **per site** — Revenue Reports multiplies it by (active sites − 1), so reading the constant alone understates a multi-branch org.

**`scraper_access` is dead** — the column still exists on `users` but nothing reads it. Do not reintroduce it as a filter or toggle.

**`prospects.custom3` is a dead UI field, not a dead data field.** The scraper only ever generates two message variants (`Lead.custom1`/`Lead.custom2` — `scraper_leads` has no third column), so `custom3` was removed from the drawer, `ProspectForm`, and CSV import mapping. The DB column itself, and `Prospect.custom3` in `types.ts`, are untouched — do not resurrect a `custom3` input anywhere without first confirming the org actually wants a 3rd manual field (it is not, and never was, an auto-generation target).

**Combo codes vs. combo labels** — `runs.combos`, `prospects.search_combo`, and a run's `combos` array are all stored as the opaque `scraper_combos_master.code` (e.g. `combo_D`), never the human-readable `name` ("CTO / VP Engineering"). Any UI showing a combo to a user must resolve it through `useComboLabels()` (`src/lib/hooks/useComboLabels.ts`, wraps `GET /api/scraper-combos`) — never render the raw code directly. Falls back to the raw code if the combo was deactivated org-wide since.

**`scraper_combos_master` holds two kinds of row, told apart by `organization_id`** (`supabase/migrations/20260904_org_owned_combos.sql`, **run by hand**). NULL is the global catalogue Insight Software maintains: every org reads it and toggles rows on/off via `org_combos`, and only `admin_global` can change what a global row searches for. A real org id is a combo that customer wrote themselves in Settings → Scraper — only they see it, only their admin edits or deletes it, and its code is minted server-side as `custom_<12 hex>` (never a letter, never guessable, never colliding with a global code, which stays globally UNIQUE). "Duplicate" on a catalogue row copies it into the org so it can be edited; the shared row is untouched.

**`org_combos.combo_code` is an FK to `scraper_combos_master(code)` and nothing more, so it does NOT prove ownership.** Before per-org combos, any code that satisfied the FK was by definition shared. Now an admin could POST another customer's `custom_...` code to the toggle endpoint and, without a check, run searches built from that customer's title keywords — invisibly, since their own Settings list is scoped. Both ends check: `POST /api/scraper-combos` 404s a code that is neither global nor theirs, and `get_combo_definitions` in the backend re-filters on `organization_id.is.null,organization_id.eq.<org>`. **The backend one is the real boundary** — it holds the service role key, so RLS does not constrain it. Any new query that resolves a combo definition needs the same filter.

**Anything that reads `scraper_combos_master` with the ADMIN client must filter `organization_id`.** RLS would have scoped it; the admin client bypasses RLS. `create-org`'s combo seeding is the live example — without `.is('organization_id', null)` it would seed every new org with every other customer's private combos.

**`prospects.search_combo` has no CHECK any more, and the old one was actively breaking runs.** It enumerated `combo_A`..`combo_F`, but the catalogue seeds A, B, C, D, E and **G** — there is no combo_F — so every lead found by combo_G violated it on insert, and since `assignRunLeads()` only tolerates duplicate-key errors row by row, one such lead failed the entire run's assignment with a 500. The same migration drops it. `SearchCombo` in `types.ts` is now `string` for the same reason: the valid set lives in the DB, per org. Use `normalizeSearchCombo()` for anything from a CSV or a human — it is the only remaining guard on that column.

**Scraped names get a name-only cleanup pass, manual/CSV names don't.** `cleanScrapedName()` (`src/lib/utils/clean-name.ts`) strips a job title the scraper sometimes leaves stuck onto the name field (`"Jassen Castillo - Software Engineer"` → `"Jassen Castillo"`), applied only where `assignRunLeads()` copies a scraped lead's `full_name` into `prospects.name`. Never apply it to `ProspectForm`/CSV-import names — a human typing a name that happens to contain a dash should never get silently truncated.

## Key Files

| Thing | Location |
|---|---|
| All TypeScript types + constants (incl. `Lead`, `RunStatus`, `RunLog`) | `src/lib/types.ts` |
| Supabase browser client | `src/lib/supabase/client.ts` |
| Supabase server client | `src/lib/supabase/server.ts` |
| Supabase admin client | `src/lib/supabase/admin.ts` |
| User context | `src/contexts/UserContext.tsx` |
| Global Admin theme/i18n | `src/contexts/GlobalAdminThemeContext.tsx` |
| Audit log helper | `src/lib/utils/audit.ts` → `logAuditEvent()` |
| Route-level SDR gate for admin-only pages | `src/lib/utils/route-guard.ts` → `blockSdrAccess()` |
| Mandatory chat-upload gate on closing a deal | `src/components/conversations/CloseDealModal.tsx` |
| Combo code → human label lookup | `src/lib/hooks/useComboLabels.ts` |
| Scraped-name cleanup (strips a stuck-on job title) | `src/lib/utils/clean-name.ts` → `cleanScrapedName()` |
| Bridge HTTP client | `src/lib/bridge-api.ts` → `bridgeApi` |
| Org ID + impersonation hook | `src/lib/hooks/useOrgId.ts` |
| Billing period from `billing_day` | `src/lib/utils/billing-period.ts` |
| Lead quota for current period | `src/lib/utils/lead-quota.ts` |
| Shared run-assign core logic | `src/lib/utils/run-assign.ts` → `assignRunLeads()` |
| Run-completion webhook (primary auto-assign trigger) | `src/app/api/runs/[id]/complete/route.ts` |
| Cron: reconcile stuck completed runs (backstop) | `src/app/api/cron/reconcile-runs/route.ts` (see `vercel.json`) |
| Fiscal quarters + billable months | `src/lib/utils/quarter.ts` |
| Anthropic base URL normaliser | `src/lib/utils/anthropic.ts` |
| Area normalisation + market→area lookup | `src/lib/utils/area-inference.ts` |
| Market→area map for a page | `src/lib/hooks/useMarketAreaMap.ts` |
| i18n messages | `src/messages/{en,zh,es,vi}.json` |

## Sidebar

Collapsible with state persisted in `localStorage` key `sidebar_collapsed`. Collapsed: 64px wide (icons only); expanded: 240px.

Sections:
- Core CRM links — all roles (some `adminOnly`)
- **Scraper** — `admin` only, hidden during impersonation
- **Bridge (Partnerships)** — `admin` only **and** only when `/api/settings/addons` reports the `bridge` add-on active

## Deployment

Deployed on Vercel. Pushing to `main` triggers a production build. All changes go directly to `main` — no feature branches survive to production.

Migrations in `supabase/migrations/` are **not** applied automatically — they must be run by hand in the Supabase SQL editor. When you add one, tell the user explicitly that it needs running.
