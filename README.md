# AITokenKing — B2B LinkedIn Outreach CRM

Multi-tenant CRM platform for managing LinkedIn outreach campaigns across geographic regions. Built for sales teams with SDRs working dedicated markets, full admin oversight, an AI-powered LinkedIn scraper, a Bridge partnership-discovery add-on, conversation logging, and a Global Admin control plane for managing all client organizations.

---

## 🔗 Important Links (for the team)

| What | Link |
|---|---|
| **Production App** | https://ai-token-sales.vercel.app |
| **Landing Page** | https://ai-token-sales.vercel.app/landing |
| **GitHub Repository** | https://github.com/antonioduran-insight/AITokenSales |
| **Vercel Dashboard** | https://vercel.com (login with org account) |
| **Supabase Dashboard** | https://supabase.com/dashboard/project/cyhfwixemswyusvcbmrn |
| **Scraper Backend** | https://pwa-aitokensales-production.up.railway.app |
| **Railway Dashboard** | https://railway.app (scraper backend deployment) |

> **For Antonio (Project Manager):** Production deploys automatically when code is pushed to `main`. The landing page at `/landing` is public — no login required. The CRM at the root requires authentication.

---

## Table of Contents

- [What's New](#whats-new)
- [Features](#features)
- [Plans & Add-ons](#plans--add-ons)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [User Roles](#user-roles)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)
- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [API Reference](#api-reference)
- [Documentation](#documentation)
- [Key Design Decisions](#key-design-decisions)

---

## What's New

### Bridge — partnership discovery (add-on)

A separate product from the lead scraper. Bridge finds **B2B partnership contacts** inside target companies so the admin can explore partnership opportunities manually. It does **not** generate outreach messages — it discovers and organises candidates for human review.

- **Seed Lists** — named target definitions with a channel family (Reseller, Referral, Technology Integration, Affiliate, Channel Distribution). Two sources that can be **combined**: a list of specific companies and/or search criteria (industry, headcount, market).
- **Search** — pick a seed list and launch a run. Live progress ring + streamed logs, polled every 3s.
- **Candidate Review** — each candidate shows name, company, title, location, LinkedIn and a short bio, with **Confirm** / **Reject** actions and **Restore** for rejected ones. Filter by All / Pending / Confirmed / Rejected.
- **Past Searches** — a tab listing previous runs; opening one reloads its candidates.

Bridge is gated twice: the sidebar entry only renders for admins whose org has the `bridge` add-on active, and `/api/bridge/[...path]` re-checks session, role and add-on before proxying to the backend. The proxy injects `organization_id` (and `apify_token` for runs) server-side, so a client can never read or mutate another org's Bridge data.

### Scraper — one SDR per run, admin only

- **SDRs no longer have any scraper access.** The Scraper section is admin-only; `scraper_access` is gone from the UI and from every query (the column remains in the DB but nothing reads it).
- **New Run is a 3-phase flow** on a normal page (sidebar stays visible): config → animated progress → result. The active run is persisted, so navigating away and back restores the live state.
- **Exactly one SDR per run.** Phase 1 uses a single-select picker; every lead the run generates goes to that SDR, with messages personalised from their sender profile. `POST /api/runs` and `/assign` take `sdr_id` (singular).
- **Cancel** — in-progress runs can be cancelled from New Run or from a History row.
- **History** rewritten: date-desc list, status badges, `?run=<id>` auto-expand, per-run lead grid with the assignee, client-side CSV export, and "Send to another SDR" (moves + reassigns the run's leads).
- The standalone scraper **Leads page was removed** — leads are viewed per-run in History, or in the CRM Kanban/Prospects once imported.

### Revenue Reports

New `/global-admin/revenue/reports` with an Overview | Reports sub-nav.

- **By Quarter** — every org billing in the quarter (including ones sold earlier that are still active), with new-this-quarter flag, setup fee, add-ons, months billable, MRR and total. Summary shows Gross → Infrastructure Costs → Net, plus a dynamic split.
- **By Vendor** — the same table filtered to one vendor, with their sales and commission for the quarter.
- **Export PDF** on both, via the browser's print-to-PDF (no external dependency).

**Split rules** — per organization: a vendor takes its real `commission_pct`, and the remaining `(100 − pct)` is split 50/50 between the two partners; direct sales split 50/50. Quarter infrastructure costs are then subtracted **once**, 50/50 from the partners only — vendors always keep a clean commission.

### Billing-period lead quota

The lead allowance now renews on each org's **`billing_day`**, not on the 1st of the calendar month. Usage counts scraper leads imported within the current billing period (e.g. `billing_day = 23` → the period running 23 Jun–22 Jul). Exposed via `GET /api/runs/quota` and enforced in `POST /api/runs`.

### Company Context

Settings → Organization has a **Company Context** textarea describing what the org sells and to whom. It is forwarded in the `POST /runs` payload to the scraper backend so generated messages can reference real products and focus.

### Server-side safety net for auto-assign

New Run's auto-assign used to be **entirely client-driven**: it only fired if the browser tab that started the run was still open and polling at the exact moment the backend reported `completed`. Since completing a run normally sends the admin to History (not back to New Run), and a tab can be closed at any point, leads could sit in `scraper_leads` with `exported_to_crm = false` indefinitely with nothing to catch it.

`GET /api/cron/reconcile-runs`, run daily by Vercel Cron (`vercel.json`), now sweeps for completed runs with unexported leads and an unambiguous single-SDR recipient, and assigns them — no open tab required. Runs with zero or multiple `run_sdr_assignments` rows (e.g. after a manual "Send to another SDR") are skipped and reported rather than guessed at. Both the client path and the cron call the same `assignRunLeads()` (`src/lib/utils/run-assign.ts`), so they're safe to race — the unique-key guard makes double-assignment a no-op.

Requires the `CRON_SECRET` env var (see [Environment Variables](#environment-variables)).

### Other changes

- **Dark mode only** — the CRM light/dark toggle and all light-theme CSS were removed. (Global Admin keeps its own independent theme toggle.)
- **Anthropic base URL** is normalised on save (a trailing `/v1` is stripped) on org create, org edit and Settings — this fixes the `/v1/v1` model error.
- **Pipeline** — every stage now has a delete button, gated by a prospect-count check on both client and server; stages are de-duplicated by id *and* name when rendering.
- **Statistics** — conversion-rate percentages are green in the By SDR and By Area cards.
- **User Management** — the Edit User modal no longer contains `years_experience` / `seniority` / `expertise_area` (these live on the sender profile) or the Scraper Access toggle.

---

## Features

### CRM
- **Kanban Board** — drag-and-drop pipeline, area filter tabs, custom stage labels/colors per org
- **Prospects Table** — full-text search, area/SDR/status/temperature filters, pagination, bulk delete, bulk SDR reassign, per-prospect drawer
- **Prospect Drawer** — edit status, temperature, ICP score, notes, LinkedIn/email/company info, custom messages with copy button, flag for next-day follow-up
- **Closed Deals** — dedicated view for `closed` prospects with conversation upload and chat count tracking
- **Conversations** — grid of all logged conversations, filterable by area/SDR/date
- **Stats Dashboard** — global conversion rate, SDR leaderboard, area breakdown, status and temperature distribution (Premium+)
- **Audit Log** — immutable trail of all actions
- **User Management** — create/deactivate/reactivate/unassign/delete SDRs (admin only)
- **CSV Import Wizard** — 5-step flow: upload → area → column mapping → duplicate review → results
- **Settings** — org name/language/logo/company context/blacklist, pipeline stage editor, plan & usage, scraper credentials & sender profiles, support tickets

### LinkedIn Scraper (admin only)
- **New Run** — 3 phases: config (market, search strategies, lead count, one SDR) → animated progress → result with HOT/WARM/COLD breakdown, CSV download and detail link
- **Run History** — all past runs, expandable per-run lead grid, CSV export, move leads to another SDR, cancel active runs
- **Dashboard** — total runs, total leads, active run banner, recent runs

### Bridge — Partnerships (add-on, admin only)
- **Seed Lists** — companies and/or criteria, per channel family
- **Search** — live progress and logs
- **Candidate Review** — Confirm / Reject / Restore with status filters
- **Past Searches** — reopen any previous run's candidates

### Global Admin (AITokenKing internal)
- **Organizations** — list all client orgs, edit plan/seats/limits/billing/notes, activate/deactivate
- **Create Org** — full provisioning (org + admin user) with add-ons, market chips, plan defaults
- **Org Detail** — per-org stats, add-on toggles, internal notes auto-save, danger zone
- **Support Tickets** — respond to tickets across all orgs
- **Revenue** — MRR overview, quarter breakdown, cost tracking, profit sharing
- **Revenue → Reports** — per-quarter and per-vendor reports with PDF export
- **Vendors** — vendor management with commission tracking
- **Impersonation** — view any org's CRM read-only (yellow banner, all writes blocked)

---

## Plans & Add-ons

| Plan | Seats | Leads/period |
|---|---|---|
| Basic | 3 | 1,000 |
| Premium | 7 | 3,000 |
| Enterprise | 15+ | 10,000 |
| Ultra (internal) | Unlimited | Unlimited |

Plan limits apply immediately on selection. Seats and leads stored as `int4`; Ultra uses `2147483647` (INT_MAX), displayed as `∞`. The lead allowance renews on the org's `billing_day`, not the calendar month.

**Add-ons** (`organization_addons.addon_type`): `account_management`, `multi_workspace`, `extended_data_retention`, `sso`, `linkedin_auto_messaging`, `bridge`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.9 (App Router, `src/` dir, Turbopack) |
| Language | TypeScript 5 |
| Database | Supabase (PostgreSQL + Auth + Storage + RLS) |
| Auth | Supabase Auth (cookie-based SSR sessions via `@supabase/ssr`) |
| Styling | Inline styles, dark theme only (`#0A0A0F` bg, `#6C63FF` accent) |
| Icons | lucide-react |
| Charts | recharts |
| Drag & Drop | @dnd-kit/core |
| CSV Parsing | papaparse |
| i18n | next-intl v4 (zh · en · es · vi) |
| Date Formatting | date-fns |
| Deployment | Vercel (auto-deploy on push to `main`) |
| Scraper / Bridge Backend | Python on Railway |

---

## Architecture

### Authentication & Session

- Auth handled by Supabase Auth via cookie-based SSR sessions
- `src/middleware.ts` validates every request server-side and sets `user_role` / `user_org_id` cookies
- Unauthenticated users are redirected to `/{locale}/login`
- `/landing` is exempt from auth (public marketing page)
- A `public.users` table mirrors `auth.users` with `role`, `area_id`, `organization_id`, and `is_active`

### Three Supabase Client Types

| Client | File | Key | Used for |
|---|---|---|---|
| **Browser** | `@/lib/supabase/client` | `ANON_KEY` | Client-side reads, RLS applies |
| **Server** | `@/lib/supabase/server` | `ANON_KEY` | SSR/API session validation |
| **Admin** | `@/lib/supabase/admin` or inline | `SERVICE_ROLE_KEY` | Cross-RLS ops, API routes only |

The `SERVICE_ROLE_KEY` is **never** exposed to the browser — only used in `src/app/api/` route handlers.

### Row Level Security

All tables have RLS enabled. Core policies:

- **Areas**: public read
- **Users**: read own row; admin reads all in own org
- **Prospects**: SDR reads own area only; admin reads all in own org
- **Organizations**: admin reads own org; `admin_global` reads all
- **Audit log**: admin reads all in own org; all authenticated users can insert

### Multi-tenancy

Every org has isolated data via `organization_id` columns and RLS. Admins are scoped to their org. The Global Admin (`admin_global`) operates across all orgs using service-role calls.

### Backend proxies

| Proxy | Auth | Notes |
|---|---|---|
| `/api/bridge/[...path]` | session + `admin` + `bridge` add-on | Injects `organization_id` and `apify_token` server-side, overwriting anything the client sent |

The scraper backend is **not** proxied generically. The CRM talks to it only through purpose-built routes (`/api/runs*`, `/api/scraper/to-crm`), each with its own auth and org scoping. A catch-all `/api/scraper/[...path]` proxy previously existed but was removed — it had no consumers.

---

## User Roles

| Role | Scope | Access |
|---|---|---|
| `admin_global` | All organizations | Global Admin panel — create/edit/deactivate any org, all support tickets, revenue & reports, impersonate any org |
| `admin` | Own organization | Full CRM access — all prospects in all areas, user management, audit log, settings, stats, **Scraper**, **Bridge** (if add-on active) |
| `sdr` | Own area | Own area's prospects, own imports, closed deals. **No scraper or Bridge access.** |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/antonioduran-insight/AITokenSales.git
cd AITokenSales
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
# Fill in your Supabase URL, keys, and scraper URL
```

### 3. Run database migrations

Run all `.sql` files in `supabase/migrations/` in order via the Supabase SQL Editor.

### 4. Create the Storage bucket for logos

Either run `supabase/migrations/20260720_logos_bucket.sql`, or via the dashboard: Storage → New Bucket → name `logos`, Public ✓.

### 5. Create the first Global Admin

```sql
-- After creating an auth user in Supabase Dashboard:
INSERT INTO public.users (id, full_name, email, role, is_active)
VALUES ('<auth-user-uuid>', 'Admin Name', 'admin@aitokenking.com', 'admin_global', true);
```

### 6. Start dev server

```bash
npm run dev
# CRM:     http://localhost:3000
# Landing: http://localhost:3000/landing
```

---

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=https://ai-token-sales.vercel.app

# Python scraper + Bridge backend (Railway)
SCRAPER_API_URL=https://pwa-aitokensales-production.up.railway.app
NEXT_PUBLIC_SCRAPER_API_URL=https://pwa-aitokensales-production.up.railway.app
NEXT_PUBLIC_SCRAPER_WS_URL=wss://pwa-aitokensales-production.up.railway.app

# Shared secret sent as X-Internal-Api-Key on every backend call.
# Must match INTERNAL_API_KEY on the Railway backend. Server-only.
INTERNAL_API_KEY=your-internal-api-key

# Authorizes Vercel Cron to call /api/cron/reconcile-runs. Vercel sends this
# automatically as `Authorization: Bearer $CRON_SECRET` when the cron fires —
# just set the variable, no extra wiring needed. Server-only.
CRON_SECRET=your-cron-secret
```

> `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_API_KEY` and `CRON_SECRET` must never reach the browser. They are server-only — never prefix them with `NEXT_PUBLIC_`.
>
> `vercel.json` schedules `/api/cron/reconcile-runs` once a day (`0 3 * * *`, ~3am UTC — Vercel doesn't guarantee the exact minute). This schedule is deliberately Hobby-plan-compatible: **Vercel rejects the entire deployment** if any cron in `vercel.json` would run more than once a day on Hobby, so an invalid schedule here silently blocks every deploy, not just the cron. If the project is on Pro or higher, this can safely be tightened (e.g. `*/10 * * * *` for a 10-minute sweep) for faster recovery.

Per-org credentials (**Apify token**, **Anthropic key / base URL / model**) are stored on the `organizations` row, not in env vars — set them in Settings → Scraper or in Global Admin.

---

## Database Schema

Core tables:

```sql
organizations        -- Multi-tenant root: plan, seats, billing_day, company_context, API credentials
users                -- Auth mirror: role, area_id, organization_id, is_active
areas                -- Sales regions (asia, latin_america, europe, usa) — same vocabulary as markets.region
user_areas           -- Extra areas an SDR covers beyond their primary area_id
prospects            -- Core lead: status, temperature, ICP score, messages, assigned_to
notes                -- Per-prospect timestamped notes
conversations        -- Full chat logs per closed deal
audit_log            -- Immutable action trail
pipeline_stages      -- Customizable kanban columns per org
organization_addons  -- Feature add-ons per org (incl. 'bridge')
support_tickets      -- Support requests from org admins
support_ticket_messages -- Thread messages per ticket
monthly_lead_counts  -- Cached lead counts keyed by (org_id, YYYY-MM)
vendors              -- Resellers with commission_pct
sender_profiles      -- Per-SDR persona used to personalise scraper messages
runs                 -- Scraper runs
run_sdr_assignments  -- One row per run: the run's single SDR + leads assigned
run_logs             -- Backend log lines per run
scraper_leads        -- Raw scraped leads before import into prospects
```

> **Lead counting**: `prospects` has no `organization_id` column. `monthly_lead_counts` caches per-calendar-month totals, while the **billing-period quota** counts `scraper_leads` with `exported_to_crm = true` inside the current `billing_day` window (see `src/lib/utils/lead-quota.ts`).

### Notable migrations

| Migration | Purpose |
|---|---|
| `20260720_logos_bucket.sql` | Creates the public `logos` storage bucket + policies |
| `20260720_prospects_linkedin_per_sdr.sql` | Unique key becomes `(organization_id, linkedin_url, assigned_to)` so a lead can sit on more than one board |
| `20260720_dedup_pipeline_stages.sql` | Cleans duplicate `pipeline_stages` rows |
| `20260721_company_context.sql` | Adds `organizations.company_context` |
| `20260721_bridge_addon.sql` | Widens the `addon_type` CHECK to include `bridge` |

---

## Project Structure

```
src/
├── app/
│   ├── landing/                # Public marketing page + demo modal
│   ├── [locale]/
│   │   ├── (scraper)/          # Scraper module (dashboard, run, history, export)
│   │   ├── bridge/             # Bridge partnerships (add-on gated)
│   │   ├── admin/              # Admin-only: import, user management
│   │   ├── global-admin/       # Global Admin panel (orgs, revenue, reports, vendors)
│   │   ├── kanban/             # Kanban board
│   │   ├── prospects/          # Prospects table
│   │   ├── convertidos/        # Closed deals
│   │   ├── stats/              # Analytics dashboard
│   │   ├── audit/              # Audit log
│   │   ├── import/             # CSV import wizard
│   │   ├── settings/           # Org settings
│   │   ├── support/            # Support tickets
│   │   └── login/              # Auth
│   └── api/                    # All API routes (service-role ops)
├── components/
│   ├── global-admin/           # GlobalAdminNavbar
│   ├── import/                 # CSVImportWizard
│   ├── kanban/                 # KanbanBoard, KanbanColumn, ProspectCard
│   ├── layout/                 # AppShell, Sidebar, LanguageSwitcher
│   ├── prospects/              # ProspectsTable, ProspectDrawer, ProspectForm
│   ├── conversations/          # ConversationsPage, ConvertidosPage
│   ├── scraper/                # StatusBadge, TemperatureBadge, ICPScore, SenderProfileModal
│   ├── stats/                  # StatsDashboard
│   ├── users/                  # UsersManagement
│   ├── audit/                  # AuditLogTable
│   └── ui/                     # Button, badges, PremiumFeature gate
├── contexts/
│   ├── UserContext.tsx              # Current user + role + org plan
│   └── GlobalAdminThemeContext.tsx  # Dark/light + zh/en for Global Admin only
├── lib/
│   ├── supabase/               # client.ts · server.ts · admin.ts
│   ├── types.ts                # All types (incl. Lead, RunStatus, RunLog) + constants
│   │                           #   (MAX_INT, PLAN_DEFAULTS, ADDON_LIST, ADDON_MONTHLY_PRICE)
│   ├── bridge-api.ts           # Bridge HTTP client
│   └── utils/
│       ├── audit.ts            # logAuditEvent helper
│       ├── anthropic.ts        # normalizeAnthropicBaseUrl (strips trailing /v1)
│       ├── billing-period.ts   # currentBillingPeriod(billing_day)
│       ├── lead-quota.ts       # getLeadQuota — usage in the current billing period
│       ├── quarter.ts          # Fiscal quarters + billable months (day-15 rollover)
│       └── area-inference.ts   # Area normalisation + market→area lookup
├── middleware.ts               # Auth gate + role/org cookies
└── messages/                   # en.json · zh.json · es.json · vi.json
```

---

## Running Locally

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build + TypeScript check
npm run start        # Start production server
npm run lint         # ESLint
```

> Always use `npm run` scripts. Do **not** use `npx next` directly. There are no automated tests.

---

## API Reference

### CRM

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/import` | admin/sdr | CSV dedup check |
| PUT | `/api/import` | admin/sdr | CSV bulk insert |
| DELETE | `/api/prospects` | admin | Bulk delete leads |
| PATCH | `/api/prospects` | admin | Bulk SDR reassign |
| POST/PATCH/DELETE | `/api/users` | admin | SDR CRUD |
| GET/POST | `/api/conversations` | admin/sdr | Log conversations |
| GET/POST/PATCH/DELETE | `/api/sender-profiles` | admin | Per-SDR sender personas |
| GET | `/api/settings/plan` | admin | Plan & usage stats |
| GET/PATCH | `/api/settings/organization` | admin | Org settings (incl. `company_context`) |
| GET | `/api/markets` | any | Full market catalogue (~49 countries by region) |
| GET | `/api/organizations/[id]/markets` | own org | Markets this org activated |
| PUT | `/api/organizations/[id]/markets` | admin (own org) | Sync the org's market selection |
| GET | `/api/settings/addons` | any | Active add-on types for the caller's org |
| GET/POST/PATCH/DELETE | `/api/settings/pipeline-stages` | admin | Pipeline stage CRUD |
| GET/POST | `/api/support/tickets` | admin/sdr | Support tickets |

### Scraper

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/runs` | admin | List runs |
| POST | `/api/runs` | **admin** | Start a run (`sdr_id` singular) |
| DELETE | `/api/runs` | admin | Clear run history |
| GET | `/api/runs/[id]` | admin | Run status + temperature breakdown |
| DELETE | `/api/runs/[id]` | admin | Cancel a run |
| GET | `/api/runs/[id]/logs` | admin | Run logs |
| POST | `/api/runs/[id]/assign` | admin | Assign the run's leads to its SDR (`manual: true` moves them) |
| GET | `/api/runs/quota` | any | Lead quota for the current billing period |
| GET/POST | `/api/scraper-combos` | admin | Search strategies enabled per org |
| POST | `/api/scraper/to-crm` | admin | Import scraped leads into `prospects` |
| GET | `/api/cron/reconcile-runs` | `CRON_SECRET` bearer token | Vercel Cron safety net — assigns completed runs the client-side flow missed |

### Bridge

| Method | Route | Auth | Purpose |
|---|---|---|---|
| ALL | `/api/bridge/[...path]` | admin + `bridge` add-on | Proxy to `/bridge/*`, injects `organization_id` + `apify_token` |

Client wrapper: `src/lib/bridge-api.ts` (`seed-lists`, `runs`, `runs/{id}/logs`, `candidates`).

### Global Admin

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET/PATCH | `/api/global-admin/organizations` | admin_global | List + update orgs |
| GET/PATCH/DELETE | `/api/global-admin/organizations/[id]` | admin_global | Single org |
| GET/POST/DELETE | `/api/global-admin/organizations/[id]/addons` | admin_global | Add-on toggles |
| POST | `/api/global-admin/create-org` | admin_global | Provision org + admin user |
| GET | `/api/global-admin/reports` | admin_global | Orgs + add-ons + vendors for Reports |
| GET/POST/PATCH/DELETE | `/api/global-admin/vendors` | admin_global | Vendor CRUD |
| GET | `/api/crm/[table]` | admin_global | Read-only impersonation proxy |

---

## Documentation

| Document | Audience |
|---|---|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | End users — Global Admin, CRM Admin, SDR |
| [docs/TESTING.md](docs/TESTING.md) | QA / Testing team |
| [docs/SECURITY.md](docs/SECURITY.md) | Cybersecurity team |
| [CLAUDE.md](CLAUDE.md) | Coding agents working in this repo |

---

## Key Design Decisions

**Service role pattern** — All writes that cross RLS boundaries use `SUPABASE_SERVICE_ROLE_KEY` exclusively in server-side API routes. Never sent to the browser.

**Area isolation** — SDRs are scoped to one area at DB level via RLS. The CSV dedup check uses service-role so all SDRs in the same area share one deduplicated prospect pool.

**Per-SDR LinkedIn uniqueness** — `prospects` is unique on `(organization_id, linkedin_url, assigned_to)`, so the same lead can appear on more than one SDR's board when deliberately moved. Import still handles `23505` violations row-by-row so a single conflict never aborts a batch.

**Billing-period lead quota** — The allowance renews on the org's `billing_day` (not the 1st). Usage counts `scraper_leads` with `exported_to_crm = true` inside the current period. `monthly_lead_counts` is still written for calendar-month reporting.

**One SDR per scraper run** — A run has exactly one recipient, recorded as a single `run_sdr_assignments` row. The auto-assign on completion is idempotent and is always called: `run_sdr_assignments` must **not** be treated as proof that leads reached `prospects`, because the Railway backend writes those rows itself.

**INT_MAX for unlimited plans** — Ultra plan seats/leads stored as `2147483647` (Postgres `int4` max), displayed as `∞`. Avoids nullable columns while preserving numeric comparisons.

**Audit immutability** — `audit_log` rows are never deleted. FK references to deleted prospects are nullified, preserving the full history.

**Impersonation as read-only** — Global Admin impersonation passes `impersonate_org_id` as a URL query param. All write operations check `isImpersonating` and return early. Yellow banner always shown.

**Add-on gating** — Add-on-only surfaces (currently Bridge) are gated in the UI *and* re-checked server-side in the API route. UI gating alone is never the security boundary.

**Dark mode only** — The CRM ships a single dark theme; the light-mode CSS and toggle were removed. Global Admin retains its own separate theme system.

**Client-side navigation** — All internal links use Next.js `<Link>` for instant client-side routing with prefetch on hover.
