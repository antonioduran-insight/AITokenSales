# AITokenKing — B2B LinkedIn Outreach CRM

Multi-tenant CRM platform for managing LinkedIn outreach campaigns across geographic regions. Built for sales teams with SDRs working dedicated markets, full admin oversight, AI-powered LinkedIn scraper, conversation logging, and a Global Admin control plane for managing all client organizations.

---

## 🔗 Important Links (for the team)

| What | Link |
|---|---|
| **Production App** | https://ai-token-sales.vercel.app |
| **Landing Page** | https://ai-token-sales.vercel.app/landing |
| **GitHub Repository** | https://github.com/ceo-synera/AITokenSales |
| **Vercel Dashboard** | https://vercel.com (login with org account) |
| **Supabase Dashboard** | https://supabase.com/dashboard/project/cyhfwixemswyusvcbmrn |
| **Scraper Backend** | https://pwa-aitokensales-production.up.railway.app |
| **Railway Dashboard** | https://railway.app (scraper backend deployment) |

> **For Antonio (Project Manager):** Production deploys automatically when code is pushed to `main`. The landing page at `/landing` is public — no login required. The CRM at the root requires authentication.

---

## Table of Contents

- [What's New](#whats-new)
- [Features](#features)
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

Recent changes deployed to production:

### Landing Page (`/landing`)
- Public marketing page in English, no login required
- Hero section with social proof stats (10K+ leads, 99.9% import accuracy, Asia · Europe · LATAM · Custom markets, <2min import)
- Fake browser kanban mockup showing the product in action
- 8-feature grid describing each CRM page
- 3 pricing plans (Basic · Premium · Enterprise) — seats and leads/mo shown prominently, no prices
- 5 add-ons section below pricing (LinkedIn Auto Messaging, Multi Workspace, Account Management, SSO, Extended Data Retention)
- CTA section at top and bottom with **Watch Demo** button

### Interactive Chinese Demo Modal
- Triggered by the "▶ Watch demo 中文" button on the landing page
- Full animated 8-slide walkthrough in Traditional Chinese, 20–25 seconds per slide
- Covers: Scraper launch → Live scraping → ICP scoring → Personalized message generation → CRM import → LinkedIn connection request sent → Lead replies → Call scheduled
- Sidebar step navigator, progress bar, Space to pause, arrow keys to navigate
- Persona: 陳怡婷 / VP Growth / CloudBase Taiwan

### Performance Fixes
- **Navigation speed**: Sidebar and Global Admin Navbar replaced `<a>` tags with Next.js `<Link>` — navigation is now client-side with prefetch on hover, eliminating full page reloads between CRM pages
- **KanbanBoard**: Replaced 4 sequential Supabase calls with a single `Promise.all` init — SDRs no longer trigger a double prospects fetch; meta queries (areas, stages) run in parallel with each other
- **ProspectsTable**: Areas and SDRs queries now run in parallel
- **Middleware timeout fix**: Added 900ms race on the `users` DB call to prevent `MIDDLEWARE_INVOCATION_TIMEOUT` on Vercel Edge when Supabase responds slowly

### Bug Fixes (from internal code review)
- Lead count in Global Admin org detail now reads from `monthly_lead_counts` (was always 0 due to missing `organization_id` column on `prospects`)
- Commission % in Revenue page reads from real vendor data (was hardcoded 30%)
- `replyText` in Support page now clears when switching between tickets
- Theme flash on Global Admin eliminated with lazy `useState` initializer
- `ADDON_LIST` and plan constants unified in `src/lib/types.ts` — no more duplicates across files
- `toggleAddon` now checks `res.ok` before updating local state
- `saveInfo` / `saveNotes` wrapped in try/catch/finally — loading state always clears
- Reactivate org now shows a confirmation dialog (was instant, same as deactivate)
- `formatSeats` / `formatLeads` fixed falsy-zero bug (0 was showing as ∞)
- Fragment keys fixed in Support page ticket table
- Plan change in new org form replaced `useEffect` with inline handler

---

## Features

### CRM
- **Kanban Board** — drag-and-drop pipeline with 7 outreach stages, area filter tabs, custom stage labels/colors per org
- **Prospects Table** — full-text search, area/SDR/status/temperature filters, pagination (25/50/100/250), bulk delete, bulk SDR reassign, per-prospect drawer
- **Prospect Drawer** — edit status, temperature, ICP score, notes, LinkedIn/email/company info, custom messages with copy button, flag for next-day follow-up
- **Closed Deals** — dedicated view for `closed` prospects with conversation upload and chat count tracking
- **Conversations** — grid view of all logged conversations, filterable by area/SDR/date, full-content modal
- **Stats Dashboard** — global conversion rate, SDR leaderboard, area breakdown, status distribution, temperature breakdown (Premium+)
- **Audit Log** — immutable trail of all actions (imports, status changes, notes, reassignments, deletions)
- **User Management** — create/deactivate/reactivate/unassign/delete SDRs (admin only)
- **CSV Import Wizard** — 5-step flow: upload → area → column mapping → duplicate review → results
- **Settings** — org name/language/logo, pipeline stage editor, plan & usage, support tickets, account management

### LinkedIn Scraper
- **New Run** — configure market, combos, lead count, then launch a scraping pipeline
- **Run History** — view all past runs with expandable lead previews, import to CRM, delete runs
- **Scraper Leads** — browse all scraped leads with filters, click for full detail drawer with copy-able outreach messages
- **Scraper Dashboard** — live stats (total runs, total leads), active run banner, recent run list

### Global Admin (AITokenKing internal)
- **Organizations** — list all client orgs, edit plan/seats/limits/billing/notes, activate/deactivate
- **Create Org** — full org provisioning (org + admin user) in one flow with add-ons, market chips, plan defaults
- **Org Detail** — per-org stats, addon toggles, internal notes auto-save, danger zone
- **Support Tickets** — view and respond to all support tickets across all orgs
- **Revenue** — MRR by plan and by vendor with real commission % from vendors table
- **Vendors** — vendor management with commission tracking
- **Impersonation** — view any org's CRM as read-only (yellow banner shown, all writes blocked)

---

## Plans

| Plan | Seats | Leads/mo |
|---|---|---|
| Basic | 3 | 1,000 |
| Premium | 7 | 3,000 |
| Enterprise | 15+ | 10,000 |
| Ultra (internal) | Unlimited | Unlimited |

Plan limits apply immediately on selection. Seats and leads/mo stored as `int4`; Ultra uses `2147483647` (INT_MAX) displayed as `∞`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.9 (App Router, `src/` dir, Turbopack) |
| Language | TypeScript 5 |
| Database | Supabase (PostgreSQL + Auth + Storage + RLS) |
| Auth | Supabase Auth (cookie-based SSR sessions via `@supabase/ssr`) |
| Styling | Inline styles (dark theme `#0A0A0F` bg, `#6C63FF` accent) |
| Icons | lucide-react |
| Drag & Drop | @dnd-kit/core |
| CSV Parsing | papaparse |
| i18n | next-intl v4 (zh · en · es · vi) |
| Date Formatting | date-fns |
| Deployment | Vercel (auto-deploy on push to `main`) |
| Scraper Backend | Python on Railway |

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
| **Admin** | inline in API routes | `SERVICE_ROLE_KEY` | Cross-area ops, bypasses RLS |

The `SERVICE_ROLE_KEY` is **never** exposed to the browser — only used in `src/app/api/` route handlers.

### Row Level Security

All tables have RLS enabled. Core policies:

- **Areas**: public read
- **Users**: read own row; admin reads all in own org
- **Prospects**: SDR reads own area only; admin reads all in own org
- **Organizations**: admin reads own org; `admin_global` reads all
- **Audit log**: admin reads all in own org; all authenticated users can insert

### Multi-tenancy

Every org has its own isolated data via `organization_id` columns and RLS policies. Admins are scoped to their org. The Global Admin (`admin_global` role) operates across all orgs using service-role calls.

### API Routes

```
src/app/api/
├── import/                    # CSV dedup check + bulk insert
├── prospects/                 # Bulk delete + bulk reassign (PATCH)
├── users/                     # SDR CRUD
├── conversations/             # Conversation log + counts
├── scraper/                   # Reverse proxy to Python scraper backend
├── scraper/to-crm/            # Import scraped leads into CRM
├── settings/
│   ├── organization/          # Org settings read/update
│   ├── pipeline-stages/       # Pipeline stage CRUD
│   ├── plan/                  # Plan & usage stats
│   └── tickets/               # Support ticket CRUD
└── global-admin/
    ├── organizations/         # List + PATCH all orgs
    ├── organizations/[id]/    # Single org GET + PATCH
    ├── organizations/[id]/addons/   # Addon management
    ├── create-org/            # Full org + admin user provisioning
    ├── vendors/               # Vendor CRUD
    └── tickets/               # Cross-org support tickets
```

---

## User Roles

| Role | Scope | Access |
|---|---|---|
| `admin_global` | All organizations | Global Admin panel — create/edit/deactivate any org, view all support tickets, impersonate any org |
| `admin` | Own organization | Full CRM access — all prospects in all areas, user management, audit log, settings, stats |
| `sdr` | Own area | Own area's prospects, own imports, scraper (if enabled) |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/ceo-synera/AITokenSales.git
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

### 4. Create Storage bucket for logos

Supabase Dashboard → Storage → New Bucket → name: `logos`, Public: ✓

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

# Python scraper backend (Railway)
NEXT_PUBLIC_SCRAPER_API_URL=https://pwa-aitokensales-production.up.railway.app
NEXT_PUBLIC_SCRAPER_WS_URL=wss://pwa-aitokensales-production.up.railway.app
```

> `SUPABASE_SERVICE_ROLE_KEY` must never reach the browser. It is server-only.

---

## Database Schema

Core tables:

```sql
organizations        -- Multi-tenant root: plan, seats, billing, addons
users                -- Auth mirror: role, area_id, organization_id, is_active
areas                -- Sales regions (Taiwan, LATAM, Vietnam, Europe, Global)
prospects            -- Core lead: status, temperature, ICP score, messages
notes                -- Per-prospect timestamped notes
conversations        -- Full chat logs per closed deal
audit_log            -- Immutable action trail
pipeline_stages      -- Customizable kanban columns per org
organization_addons  -- Feature add-ons per org
support_tickets      -- Support requests from org admins
support_ticket_messages -- Thread messages per ticket
monthly_lead_counts  -- Cached lead import counts keyed by (org_id, YYYY-MM)
```

> **Lead counting**: always use `monthly_lead_counts` — `prospects` has no `organization_id` column.

---

## Project Structure

```
src/
├── app/
│   ├── landing/                # Public marketing page + demo modal
│   ├── [locale]/
│   │   ├── (scraper)/          # Scraper module (dashboard, run, history, leads, export)
│   │   ├── admin/              # Admin-only: import, user management
│   │   ├── global-admin/       # Global Admin panel
│   │   ├── kanban/             # Kanban board
│   │   ├── prospects/          # Prospects table
│   │   ├── convertidos/        # Closed deals
│   │   ├── conversations/      # Conversation log
│   │   ├── stats/              # Analytics dashboard
│   │   ├── audit/              # Audit log
│   │   ├── import/             # CSV import wizard
│   │   ├── settings/           # Org settings
│   │   └── login/              # Auth
│   └── api/                    # All API routes (service-role ops)
├── components/
│   ├── global-admin/           # GlobalAdminNavbar
│   ├── import/                 # CSVImportWizard
│   ├── kanban/                 # KanbanBoard, KanbanColumn, ProspectCard
│   ├── layout/                 # AppShell, Sidebar, LanguageSwitcher
│   ├── prospects/              # ProspectsTable, ProspectDrawer, ProspectForm
│   ├── conversations/          # ConversationsPage, ConvertidosPage
│   ├── stats/                  # StatsDashboard
│   ├── users/                  # UsersManagement
│   ├── audit/                  # AuditLogTable
│   └── ui/                     # Button, badges, PremiumFeature gate
├── contexts/
│   ├── UserContext.tsx          # Current user + role
│   └── GlobalAdminThemeContext.tsx  # Dark/light + zh/en for Global Admin
├── lib/
│   ├── supabase/               # client.ts · server.ts
│   ├── types.ts                # All TypeScript types + shared constants (MAX_INT, PLAN_DEFAULTS, ADDON_LIST)
│   ├── theme.ts                # darkTheme / lightTheme color tokens
│   ├── scraper-api.ts          # Scraper HTTP client
│   └── utils/audit.ts          # logAuditEvent helper
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

> Always use `npm run` scripts. Do **not** use `npx next` directly.

---

## API Reference

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/import` | admin/sdr | CSV dedup check |
| PUT | `/api/import` | admin/sdr | CSV bulk insert |
| DELETE | `/api/prospects` | admin | Bulk delete leads |
| PATCH | `/api/prospects` | admin | Bulk SDR reassign |
| POST | `/api/users` | admin | Create SDR |
| PATCH | `/api/users` | admin | Toggle active / unassign |
| DELETE | `/api/users` | admin | Delete SDR |
| GET/POST | `/api/conversations` | admin/sdr | Log conversations |
| GET | `/api/settings/plan` | admin | Plan & usage stats |
| PATCH | `/api/settings/organization` | admin | Update org settings |
| GET/POST/PATCH | `/api/global-admin/organizations` | admin_global | Manage all orgs |
| POST | `/api/global-admin/create-org` | admin_global | Provision new org |
| GET/POST | `/api/global-admin/tickets` | admin_global | Support ticket management |

Full endpoint docs: [docs/API.md](docs/API.md)

---

## Documentation

| Document | Audience |
|---|---|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | End users — Global Admin, CRM Admin, SDR |
| [docs/TESTING.md](docs/TESTING.md) | QA / Testing team |
| [docs/SECURITY.md](docs/SECURITY.md) | Cybersecurity team |

---

## Key Design Decisions

**Service role pattern** — All writes that cross RLS boundaries use `SUPABASE_SERVICE_ROLE_KEY` exclusively in server-side API routes. Never sent to the browser.

**Area isolation** — SDRs are scoped to one area at DB level via RLS. The CSV dedup check uses service-role so all SDRs in the same area share one deduplicated prospect pool.

**Global `linkedin_url` uniqueness** — LinkedIn URLs are globally unique across the entire prospects table. Import handles `23505` constraint violations row-by-row.

**Monthly lead counting** — `monthly_lead_counts` caches per-org monthly imports for billing/limit enforcement, keyed by `(organization_id, YYYY-MM)`. Never count via `prospects.organization_id` — that column does not exist.

**INT_MAX for unlimited plans** — Ultra plan seats/leads stored as `2147483647` (Postgres `int4` max), displayed as `∞`. Avoids nullable columns while preserving numeric comparisons.

**Audit immutability** — `audit_log` rows are never deleted. FK references to deleted prospects are nullified, preserving the full history.

**Impersonation as read-only** — Global Admin impersonation passes `impersonate_org_id` as a URL query param. All write operations check `isImpersonating` and return early. Yellow banner always shown.

**Client-side navigation** — All internal links use Next.js `<Link>` (not `<a>`) for instant client-side routing with automatic prefetch on hover. This applies to both the CRM Sidebar and the Global Admin Navbar.
