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

Two proxies to the external Python backend:

| Proxy | Auth | Behaviour |
|---|---|---|
| `/api/scraper/[...path]` | session + `admin` | Verifies any `/runs/{id}` in the path belongs to the caller's org, then injects `organization_id`. `scraperApi` in `src/lib/scraper-api.ts` wraps it. |
| `/api/bridge/[...path]` | session + `admin` + `bridge` add-on | Injects `organization_id` (and `apify_token` on `POST /bridge/runs`) server-side. `bridgeApi` in `src/lib/bridge-api.ts` wraps it. |

Both proxies **overwrite** `organization_id` in the query and body with the session-derived value — never trust a client-supplied one. Any new backend-facing route must follow the same shape.

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

**Never treat `run_sdr_assignments` as proof of assignment** — the Railway backend writes those rows itself when a run completes. Gating the auto-assign on `leads_assigned > 0` caused leads to never reach `prospects`. The assign endpoint is idempotent, so always call it.

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

**Add-ons** — `addon_type` is constrained in the DB. Adding a new one requires both an `ADDON_LIST` entry in `src/lib/types.ts` (which auto-renders it in Global Admin) **and** a migration widening the CHECK constraint.

**`scraper_access` is dead** — the column still exists on `users` but nothing reads it. Do not reintroduce it as a filter or toggle.

## Key Files

| Thing | Location |
|---|---|
| All TypeScript types + constants | `src/lib/types.ts` |
| Supabase browser client | `src/lib/supabase/client.ts` |
| Supabase server client | `src/lib/supabase/server.ts` |
| Supabase admin client | `src/lib/supabase/admin.ts` |
| User context | `src/contexts/UserContext.tsx` |
| Global Admin theme/i18n | `src/contexts/GlobalAdminThemeContext.tsx` |
| Audit log helper | `src/lib/utils/audit.ts` → `logAuditEvent()` |
| Scraper HTTP client | `src/lib/scraper-api.ts` → `scraperApi` |
| Bridge HTTP client | `src/lib/bridge-api.ts` → `bridgeApi` |
| Org ID + impersonation hook | `src/lib/hooks/useOrgId.ts` |
| Billing period from `billing_day` | `src/lib/utils/billing-period.ts` |
| Lead quota for current period | `src/lib/utils/lead-quota.ts` |
| Fiscal quarters + billable months | `src/lib/utils/quarter.ts` |
| Anthropic base URL normaliser | `src/lib/utils/anthropic.ts` |
| Country/market → area mapping | `src/lib/utils/area-inference.ts` |
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
