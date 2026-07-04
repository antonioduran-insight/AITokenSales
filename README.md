# AITokenSales — B2B LinkedIn Outreach CRM

Multi-tenant CRM platform for managing LinkedIn outreach campaigns across geographic regions. Built for sales teams with SDRs working dedicated markets, full admin oversight, LinkedIn scraper integration, conversation logging, and a Global Admin control plane for managing multiple client organizations.

---

## Table of Contents

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

## Features

### CRM
- **Kanban Board** — drag-and-drop pipeline with 7 outreach stages, area filter pill tabs, custom stage labels/colors per org
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
- **Revenue** — revenue tracking per organization
- **Vendors** — vendor management
- **Impersonation** — view any org's CRM as read-only (banner shown, no writes)

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
| i18n | next-intl v4 |
| Date Formatting | date-fns |
| Fonts | JetBrains Mono (data fields), system sans-serif |

---

## Architecture

### Authentication & Session

- Auth handled by Supabase Auth via cookie-based SSR sessions
- Middleware (`src/middleware.ts` / `src/proxy.ts`) validates every request server-side
- Unauthenticated users are redirected to `/{locale}/login`
- A `public.users` table mirrors `auth.users` with `role`, `area_id`, `organization_id`, and `is_active`

### Client Types

| Client | Created by | Key | Used for |
|---|---|---|---|
| **Anon client** | `createClient()` from `@/lib/supabase/client` | `ANON_KEY` | Browser-side reads, RLS applies |
| **Server client** | `createServerClient()` from `@supabase/ssr` | `ANON_KEY` | SSR/API session validation |
| **Admin client** | `createClient()` from `@supabase/supabase-js` | `SERVICE_ROLE_KEY` | Cross-area ops, bypasses RLS |

The `SERVICE_ROLE_KEY` is **never** exposed to the browser — only used in `src/app/api/` route handlers.

### Row Level Security

All tables have RLS enabled. The core policies:

- **Areas**: public read
- **Users**: read own row; admin reads all in own org
- **Prospects**: SDR reads own area only; admin reads all in own org
- **Organizations**: admin reads own org; `admin_global` reads all
- **Audit log**: admin reads all in own org; all authenticated users can insert

### Multi-tenancy

Every org has its own isolated data via `organization_id` columns and RLS policies. Admins are scoped to their org. The Global Admin (`admin_global` role) operates across all orgs using service-role calls.

### API Routes pattern

All cross-RLS operations go through Next.js API routes with service-role access:

```
src/app/api/
├── import/                    # CSV dedup check + bulk insert
├── prospects/                 # Bulk delete + bulk reassign (PATCH)
├── users/                     # SDR CRUD
├── conversations/             # Conversation log + counts
├── scraper/                   # Proxy to Python scraper backend
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
git clone https://github.com/antonioduran-insight/AITokenSales.git
cd AITokenSales
npm install
```

### 2. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a project, then grab keys from **Project Settings → API**.

### 3. Configure environment variables

```bash
cp .env.example .env
# Fill in your Supabase URL and keys
```

### 4. Run database migrations

Run all `.sql` files in `supabase/migrations/` (or the combined schema) in the Supabase SQL Editor in order.

### 5. Create Storage bucket for logos

In Supabase Dashboard → Storage → New Bucket:
- Name: `logos`
- Public: ✓

### 6. Create the first Global Admin

```sql
-- After creating an auth user in Supabase Dashboard:
INSERT INTO public.users (id, full_name, email, role, is_active)
VALUES ('<auth-user-uuid>', 'Admin Name', 'admin@aitokenking.com', 'admin_global', true);
```

### 7. Start dev server

```bash
npm run dev
# Open http://localhost:3000
```

---

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional: Python scraper backend
SCRAPER_API_URL=http://localhost:8000
SCRAPER_API_KEY=your-scraper-api-key
```

> **Security**: `SUPABASE_SERVICE_ROLE_KEY` must never be sent to the client. It is only used server-side in `src/app/api/` route handlers.

---

## Database Schema

Core tables (simplified):

```sql
organizations       -- Multi-tenant root: plan, seats, billing, addons
users               -- Auth mirror: role, area_id, organization_id, is_active
areas               -- Sales regions (Taiwan, LATAM, Vietnam, Europe, Global)
prospects           -- Core lead record: status, temperature, ICP score, messages
notes               -- Per-prospect timestamped notes
conversations       -- Full chat logs uploaded per closed deal
audit_log           -- Immutable action trail
pipeline_stages     -- Customizable kanban columns per org
organization_addons -- Feature add-ons per org
support_tickets     -- Support requests from org admins
support_ticket_messages -- Thread messages for each ticket
monthly_lead_counts -- Cached lead import counts for billing/limits
```

See `supabase/migrations/` for complete schema with RLS policies.

---

## Project Structure

```
src/
├── app/
│   ├── [locale]/
│   │   ├── (scraper)/          # Scraper module (dashboard, run, history, leads, export)
│   │   ├── admin/              # Admin-only: import, user management
│   │   ├── global-admin/       # Global Admin panel (organizations, support, revenue, vendors)
│   │   ├── kanban/             # Kanban board
│   │   ├── prospects/          # Prospects table
│   │   ├── convertidos/        # Closed deals
│   │   ├── conversations/      # Conversation log
│   │   ├── stats/              # Analytics dashboard
│   │   ├── audit/              # Audit log (admin only)
│   │   ├── import/             # CSV import wizard (all users)
│   │   ├── settings/           # Org settings
│   │   └── login/              # Auth
│   └── api/                    # All API routes (service-role ops)
├── components/
│   ├── global-admin/           # GlobalAdminNavbar
│   ├── import/                 # CSVImportWizard
│   ├── kanban/                 # KanbanBoard, KanbanColumn, ProspectCard
│   ├── layout/                 # AppShell, Sidebar (collapsible), LanguageSwitcher
│   ├── prospects/              # ProspectsTable, ProspectDrawer, ProspectForm
│   ├── conversations/          # ConversationsPage, ConvertidosPage, ConversationsLog
│   ├── stats/                  # StatsDashboard
│   ├── users/                  # UsersManagement
│   ├── audit/                  # AuditLogTable
│   └── ui/                     # Base UI components (Button, badges, PremiumFeature gate)
├── contexts/
│   ├── UserContext.tsx          # Current user + role
│   └── GlobalAdminThemeContext.tsx  # Dark/light theme + zh/en i18n for Global Admin
├── lib/
│   ├── supabase/               # client.ts · server.ts
│   ├── theme.ts                # darkTheme / lightTheme color tokens
│   ├── scraper-api.ts          # Scraper HTTP client
│   ├── scraper-websocket.ts    # WebSocket log streaming
│   ├── types.ts                # All TypeScript types
│   └── utils/audit.ts          # logAuditEvent helper
├── i18n/                       # next-intl routing config
└── messages/                   # en.json · zh.json · es.json · vi.json
```

---

## Running Locally

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
```

> Use `npm run` scripts only. Do **not** use `npx next` — module resolution may fail with this Next.js version.

---

## API Reference

See [docs/API.md](docs/API.md) for full endpoint documentation.

Quick reference:

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

---

## Documentation

| Document | Audience |
|---|---|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | End users — Global Admin, CRM Admin, SDR |
| [docs/TESTING.md](docs/TESTING.md) | QA / Testing team |
| [docs/SECURITY.md](docs/SECURITY.md) | Cybersecurity team |

---

## Key Design Decisions

**Service role pattern** — All writes that cross RLS boundaries use `SUPABASE_SERVICE_ROLE_KEY` exclusively inside server-side API routes. Never sent to the browser.

**Area isolation** — SDRs are scoped to one area at DB level via RLS. The CSV dedup check uses service-role so all SDRs in the same area share one deduplicated prospect pool.

**Global `linkedin_url` uniqueness** — LinkedIn URLs are globally unique across the entire table. The import handles `23505` Postgres constraint violations row-by-row, counting them separately from intentional skips.

**Monthly lead counting** — `monthly_lead_counts` table caches per-org monthly lead imports for billing/limit enforcement, avoiding expensive `COUNT` queries on `prospects`.

**Audit immutability** — `audit_log` rows are never deleted (only the FK reference to a deleted prospect is nullified). This preserves the full history even after prospect deletion.

**INT_MAX for unlimited plans** — Ultra plan seats/leads are stored as `2147483647` (Postgres `int4` max) and displayed as `∞`. This avoids nullable columns while preserving numeric comparisons.

**Impersonation as read-only** — Global Admin impersonation passes `impersonate_org_id` as a URL query param. All write operations check `isImpersonating` and return early. A yellow banner is always shown.
