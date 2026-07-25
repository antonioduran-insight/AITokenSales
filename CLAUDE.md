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

**Bridge has no local run table — the backend owns all Bridge state.** Unlike the main scraper (`runs` is a first-class CRM table with `run_sdr_assignments`, quota tracking, etc.), Bridge's `GET /runs`, `GET /runs/[id]`, `GET /runs/[id]/logs` and `GET /candidates` are pure passthroughs; nothing is mirrored locally. `POST /bridge/runs` requires `run_id` in the request body (422 otherwise) — the proxy generates it with `randomUUID()` before forwarding, the same way the main scraper's `run_id` originates CRM-side rather than from the backend. The response is defensively backfilled with that `run_id` if the backend doesn't echo it back, so `bridgeApi.createRun()`'s `res.id ?? res.run_id` always resolves.

The scraper backend has **no** catch-all proxy — a `/api/scraper/[...path]` passthrough existed but was deleted (no consumers, and it was unauthenticated). Scraper traffic goes through purpose-built routes (`/api/runs*`, `/api/scraper/to-crm`) that each do their own auth and org scoping.

**Never add a generic passthrough proxy.** If a new backend endpoint is needed, either add a purpose-built route or follow the Bridge shape: verify session → verify role from the DB → gate on whatever the feature requires → overwrite `organization_id` server-side. Never trust a client-supplied `organization_id`.

**Every outbound backend call must use `backendHeaders()`** from `src/lib/scraper-backend.ts` — it adds the `X-Internal-Api-Key` shared secret (`INTERNAL_API_KEY`, server-only) that the backend requires. Never hand-write `{ 'Content-Type': 'application/json' }` for a backend fetch.

**When adding an add-on-gated feature, gate it in the UI *and* re-check server-side in the API route.** UI gating is never the security boundary.

### Styling Convention

**No Tailwind in component JSX.** All styles are inline style objects. A `const S: Record<string, React.CSSProperties>` object at the top of each file holds shared styles.

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

**Lead counting** — Never count leads via `prospects.organization_id` (column does not exist).
- Calendar-month totals live in `monthly_lead_counts`, keyed by `(organization_id, year_month)` where `year_month = 'YYYY-MM'`.
- The **quota that actually gates runs** renews on the org's `billing_day`, not the calendar month. Use `getLeadQuota()` in `src/lib/utils/lead-quota.ts`, which counts `scraper_leads` with `exported_to_crm = true` inside `currentBillingPeriod(billing_day)`.

**One SDR per scraper run** — A run has exactly one recipient. `POST /api/runs` and `/api/runs/[id]/assign` take **`sdr_id` (singular)**; `sdr_ids[0]` is still accepted defensively. There is no round-robin or split — every lead goes to that SDR. Exactly one `run_sdr_assignments` row per run.

**New Run market picker is region-first** — Phase 1 picks one region (`AreaName`), then multi-selects specific countries within it (all preselected from the org's activated markets, admin can uncheck). `POST /api/runs` takes `markets: string[]` (the checked countries) and `region` (reference/logging only, stored on `runs.region`). SDR eligibility filters on `region` directly — never re-infer it from a country name when the region was already explicitly chosen. `assigned_markets` on `run_sdr_assignments` must receive the full `markets` array both at creation **and** when `/api/runs/[id]/assign` re-upserts it on completion — sending only `market` (singular) there silently collapses a multi-country run down to one country.

**Never treat `run_sdr_assignments` as proof of assignment** — the Railway backend writes those rows itself when a run completes. Gating the auto-assign on `leads_assigned > 0` caused leads to never reach `prospects`. The assign endpoint is idempotent, so always call it.

**Auto-assign has a client-driven path AND a server-side safety net.** New Run's `poll()` (`src/app/[locale]/(scraper)/run/page.tsx`) calls `/api/runs/[id]/assign` the moment it observes `status === 'completed'` — this is still the primary, fastest path. Two consequences to keep in mind when touching that file:
- A transient status-read failure (backend redeploy, 5xx, network blip) must **never** be treated the same as `status === 'failed'`. Only an authoritative 404/403 (run gone / access lost) should stop polling and route to the failure screen; everything else should keep polling indefinitely and show a soft "reconnecting" state.
- `runAssign()` must not depend solely on `localStorage`/in-memory state for the `sdr_id` — that state is lost if the tab is closed and reopened later, or if a second run overwrites the single `scraper_active_run` localStorage key. Always fall back to `run_sdr_assignments[0].sdr_id` from the freshly-polled run (already returned by `GET /api/runs/[id]`), since that row is written server-side when the run is created.

Because the client path can still be missed entirely (tab closed before completion, admin navigates to History instead of staying on New Run — which is the *normal* flow, not an edge case), **`GET /api/cron/reconcile-runs` is a server-side safety net** run by Vercel Cron (`vercel.json`, once daily — see the Hobby-plan note below). It scans for `completed` runs with `scraper_leads.exported_to_crm = false` and exactly one `run_sdr_assignments` row (unambiguous recipient — every run created via New Run starts with exactly one), and assigns them. Runs with zero or multiple assignment rows are **skipped and reported, never guessed at** — a manual "Send to another SDR" can leave a run with several rows, and picking the wrong one has real business cost (quota, commission, lead ownership).

**`vercel.json`'s cron schedule must stay Hobby-compatible (once per day) unless the plan is confirmed Pro+.** Vercel validates every cron in `vercel.json` at deploy time and **rejects the whole deployment** — not just the cron — if any schedule would fire more than once a day on a Hobby plan. A `*/10 * * * *` schedule silently blocked every single deploy (including unrelated commits) until this was caught, with zero error visible in the GitHub push itself — check the Vercel Deployments tab, not just `git push` exit codes, when changing this file.

Both paths call the same `assignRunLeads()` in `src/lib/utils/run-assign.ts` — **never reimplement the assign logic inline in a route handler.** It's idempotent, so the client and cron paths racing each other is safe.

**Prospect uniqueness** — `prospects` is unique on `(organization_id, linkedin_url, assigned_to)`, so the same lead can live on more than one SDR's board. Insert paths must tolerate `23505` row-by-row rather than aborting a whole batch.

**Anthropic base URL** — Always run values through `normalizeAnthropicBaseUrl()` (`src/lib/utils/anthropic.ts`) before persisting. The backend appends `/v1` itself; storing a URL that already ends in `/v1` produces the `/v1/v1` error.

**INT limits** — Postgres `int4` max is `2147483647`. Ultra plan seats/leads use this value for "unlimited". Always `MAX_INT = 2147483647`. Display as `∞` when `value >= MAX_INT`.

**Plan defaults** — Defined once in `PLAN_DEFAULTS` (`src/lib/types.ts`); apply immediately when a plan is selected in any org form:
```typescript
basic:      { max_seats: 3,       max_leads_per_month: 1000 }
premium:    { max_seats: 7,       max_leads_per_month: 3000 }
enterprise: { max_seats: 15,      max_leads_per_month: 10000 }
ultra:      { max_seats: MAX_INT, max_leads_per_month: MAX_INT }
```

**Billing day default** — Always `10` (not 1).

**Markets are per-org, never hardcoded** — the catalogue lives in the backend-owned `markets` table (~49 countries across Asia / Latin America / Europe / USA) and each org activates a subset in `organization_markets`. Any surface that asks for a market must read the org's list via `useOrgMarkets()` and render `<MarketSelect>` — never a literal array of country names. Because the backend owns the table, `/api/markets` normalises the column names it reads (`name|country|label`, `region|area|continent`).

**Areas and market regions share one vocabulary** — `AreaName = 'asia' | 'latin_america' | 'europe' | 'usa'`, and `areas.name` (how SDRs are classified) uses exactly the same values as `markets.region`. A market's region *is* an area; there is no translation layer.

`inferAreaFromCountry(marketName, map)` is **synchronous** and takes a prebuilt `MarketAreaMap`. Build it once per page with `useMarketAreaMap()` (which reads the full catalogue) — never query per call, since list views resolve an area per row. Unknown markets return `null`, which callers treat as "no filter" (show every SDR) rather than "no matches". The old hardcoded `countryToArea` dictionary is gone.

**Add-ons** — `addon_type` is constrained in the DB. Adding a new one requires both an `ADDON_LIST` entry in `src/lib/types.ts` (which auto-renders it in Global Admin) **and** a migration widening the CHECK constraint.

**`scraper_access` is dead** — the column still exists on `users` but nothing reads it. Do not reintroduce it as a filter or toggle.

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
| Bridge HTTP client | `src/lib/bridge-api.ts` → `bridgeApi` |
| Org ID + impersonation hook | `src/lib/hooks/useOrgId.ts` |
| Billing period from `billing_day` | `src/lib/utils/billing-period.ts` |
| Lead quota for current period | `src/lib/utils/lead-quota.ts` |
| Shared run-assign core logic | `src/lib/utils/run-assign.ts` → `assignRunLeads()` |
| Cron: reconcile stuck completed runs | `src/app/api/cron/reconcile-runs/route.ts` (see `vercel.json`) |
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
