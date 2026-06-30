# AITokenSales — B2B LinkedIn Outreach CRM

A multi-tenant CRM for managing B2B LinkedIn outreach campaigns across geographic areas. Built for sales teams with SDRs working dedicated regions, with full admin oversight and CSV import from LinkedIn scrapers.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Supabase Schema](#supabase-schema)
- [User Roles](#user-roles)
- [How to Use](#how-to-use)
  - [Admin Guide](#admin-guide)
  - [SDR Guide](#sdr-guide)
- [CSV Import](#csv-import)
- [Internationalization](#internationalization)
- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [Key Design Decisions](#key-design-decisions)

---

## Features

- **Role-based access**: Admin and SDR roles with RLS-enforced data isolation
- **CSV Import Wizard**: 5-step (admin) / 4-step (SDR) import flow with dedup detection across the full area
- **Prospect Management**: Full table with filters, pagination, bulk delete/reassign, per-prospect drawer
- **Kanban Board**: Drag-and-drop pipeline by outreach status
- **Stats Dashboard**: Metrics per area, SDR, and status
- **Audit Log**: Full trail of all actions (imports, status changes, reassignments, deletions)
- **User Management**: Create, deactivate, reactivate, unassign leads from, and delete SDRs
- **Multilingual**: zh (default), en, es, vi

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.9 (App Router, `src/` dir) |
| Language | TypeScript 5 |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Auth | Supabase Auth (cookie-based SSR sessions) |
| Styling | Tailwind CSS v4 + inline styles (dark theme) |
| UI Components | shadcn/ui + lucide-react icons |
| Drag & Drop | @dnd-kit |
| CSV Parsing | papaparse |
| i18n | next-intl v4 |
| Fonts | JetBrains Mono (data fields), system sans |

---

## Architecture

### Authentication & Authorization

- Auth is handled by Supabase Auth via `@supabase/ssr` cookie-based sessions
- Every page reads the session server-side; unauthenticated users are redirected to `/login`
- A `public.users` table mirrors auth users with `role` (`admin` | `sdr`) and `area_id`
- Row-Level Security (RLS) is enabled on all tables
- **Anon client** (browser): SDRs can only read/write prospects in their own area
- **Service role client** (API routes only): used for cross-area operations — dedup checks, bulk inserts, bulk deletes, user management

### API Routes

All destructive or cross-area operations go through Next.js API routes using the service role key:

| Route | Methods | Purpose |
|---|---|---|
| `/api/users` | POST, DELETE, PATCH | Create / delete / toggle / unassign SDRs |
| `/api/prospects` | DELETE | Bulk delete leads (admin only) |
| `/api/import` | POST, PUT | Dedup check + insert across full area |

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/ceo-synera/AITokenSales.git
cd AITokenSales
npm install
```

### 2. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, and grab the keys from **Project Settings → API**.

### 3. Configure environment variables

Create a `.env` file in the project root (see [Environment Variables](#environment-variables)).

### 4. Run the database schema

Run the SQL in the [Supabase Schema](#supabase-schema) section inside the Supabase SQL editor.

### 5. Create the first admin user

In the Supabase dashboard:
1. Go to **Authentication → Users → Add user**
2. Enter email + password, confirm email
3. Then in the SQL editor run:
```sql
INSERT INTO public.users (id, full_name, email, role, is_active)
VALUES ('<auth-user-uuid>', 'Your Name', 'your@email.com', 'admin', true);
```

### 6. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Create a `.env` file at the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.** It is only used in API routes (`src/app/api/`).

---

## Supabase Schema

Run this in the Supabase SQL editor to create all required tables:

```sql
-- Areas
CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  label_zh TEXT NOT NULL,
  label_en TEXT NOT NULL,
  label_vi TEXT NOT NULL,
  label_es TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed active areas
INSERT INTO areas (name, label_zh, label_en, label_vi, label_es) VALUES
  ('taiwan', '台湾/东南亚', 'Taiwan / SEA', 'Đài Loan / ĐNA', 'Taiwán / SEA'),
  ('latam', '拉丁美洲', 'LATAM', 'Mỹ Latinh', 'LATAM'),
  ('vietnam', '越南', 'Vietnam', 'Việt Nam', 'Vietnam');

INSERT INTO areas (name, label_zh, label_en, label_vi, label_es, is_active) VALUES
  ('europe', '欧洲', 'Europe', 'Châu Âu', 'Europa', false);

-- Users (mirrors auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'sdr')),
  area_id UUID REFERENCES areas(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prospects
CREATE TABLE prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  linkedin_url TEXT UNIQUE,
  email TEXT,
  company TEXT,
  title TEXT,
  industry TEXT,
  company_size TEXT,
  icp_score NUMERIC,
  lead_temperature TEXT CHECK (lead_temperature IN ('Cold', 'Warm', 'Hot')),
  search_combo TEXT CHECK (search_combo IN ('A','B','C','D','E','F')),
  scrape_date TEXT,
  custom1 TEXT,
  custom2 TEXT,
  custom3 TEXT,
  outreach_status TEXT NOT NULL DEFAULT 'new'
    CHECK (outreach_status IN ('new','connection_sent','connected','replied','demo_scheduled','closed','nurture')),
  market TEXT,
  area_id UUID NOT NULL REFERENCES areas(id),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  flag_tomorrow BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual','csv_import')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Notes
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  prospect_id UUID REFERENCES prospects(id) ON DELETE SET NULL,
  prospect_name TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Areas: everyone can read
CREATE POLICY "areas_read" ON areas FOR SELECT USING (true);

-- Users: read own row, or admin reads all
CREATE POLICY "users_read" ON users FOR SELECT
  USING (id = auth.uid() OR EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'
  ));

-- Prospects: SDR reads own area, admin reads all
CREATE POLICY "prospects_read" ON prospects FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
    OR area_id IN (SELECT area_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "prospects_insert" ON prospects FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "prospects_update" ON prospects FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Notes: read if prospect is in own area or admin
CREATE POLICY "notes_read" ON notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  OR prospect_id IN (
    SELECT id FROM prospects WHERE area_id IN (
      SELECT area_id FROM users WHERE id = auth.uid()
    )
  )
);
CREATE POLICY "notes_insert" ON notes FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Audit log: admin reads, anyone inserts
CREATE POLICY "audit_log_read" ON audit_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'));
CREATE POLICY "audit_log_insert" ON audit_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

---

## User Roles

### Admin
- Full access to all prospects across all areas
- Can create, deactivate, reactivate, unassign, and delete SDRs
- Can bulk delete and bulk reassign prospects
- Sees area filter + SDR filter in the prospects table
- Chooses the target area manually when importing a CSV
- Can view the Audit Log

### SDR (Sales Development Rep)
- Sees only prospects in their assigned area
- Can import their own CSV — prospects are auto-assigned to them and their area
- Cannot delete or bulk-reassign prospects
- Cannot access User Management or Audit Log

---

## How to Use

### Admin Guide

#### Creating an SDR

1. Go to **Users** in the sidebar
2. Click **New SDR**
3. Fill in: Full Name, Email, Password, Area
4. The SDR can now log in and will only see their area's prospects

#### Managing SDRs

Each SDR row has three action buttons:

| Button | Action |
|---|---|
| Deactivate / Reactivate | Blocks or restores the SDR's login |
| Unassign (amber) | Sets `assigned_to = null` on all their leads (leads stay in the DB) |
| Delete (red) | Permanently deletes the SDR; leads are unassigned but not deleted |

#### Importing a CSV (Admin)

1. Go to **Import** in the sidebar
2. **Step 1** — Upload a `.csv` file (max 5 MB)
3. **Step 2** — Select the target area (Taiwan/SEA, LATAM, Vietnam)
4. **Step 3** — Map CSV columns to prospect fields. Auto-detection handles common headers
5. **Step 4** — Review duplicates (only shown if duplicates exist). Toggle each row between Skip and Force Import
6. **Step 5** — Results: Imported / Duplicados omitidos / Ya existían / Sin nombre / Error

#### Bulk actions on prospects

1. Check the boxes next to one or more rows (admin-only checkboxes)
2. **Reassign**: pick an SDR from the dropdown → click Reassign
3. **Delete**: click the red Eliminar (N) button → confirm in the modal

#### Filters

| Filter | Available to |
|---|---|
| Area | Admin only |
| SDR (includes "Sin asignar") | Admin only |
| Status | All users |
| Temperature | All users |
| Search (name / company / email) | All users |
| Page size (25 / 50 / 100 / 250) | All users |

---

### SDR Guide

#### Importing your leads

1. Click **Import** in the sidebar
2. Upload your CSV — your area is detected automatically from your profile
3. Map columns to fields (auto-detected for common headers)
4. If duplicates exist in your area, review them and choose to skip or force-import
5. All imported prospects are automatically assigned to you

#### Working a prospect

Click any row to open the prospect **drawer**:

- **Info tab** — edit status, temperature, ICP score, company info, LinkedIn, email, custom fields
- **Notes tab** — add timestamped internal notes visible to your team
- **Messages tab** — view Custom 1, 2, 3 fields with a copy button

#### Outreach pipeline statuses

| Status | Meaning |
|---|---|
| New | Imported, not yet contacted |
| Connection Sent | LinkedIn request sent |
| Connected | They accepted |
| Replied | They replied to a message |
| Demo Scheduled | Meeting booked |
| Closed | Deal closed |
| Nurture | Long-term follow-up |

#### Kanban view

The **Kanban** page shows prospects as cards organized by status. Drag cards between columns to update the status instantly.

#### Flag Tomorrow

Check **Flag Tomorrow** inside any prospect drawer to pin it for next-day follow-up.

---

## CSV Import

### Supported column headers (auto-detected)

| CSV header examples | Maps to |
|---|---|
| `name`, `full name`, `lead name`, `contact name` | Name *(required)* |
| `linkedin`, `linkedin url`, `profile url` | LinkedIn URL |
| `email`, `mail`, `email address` | Email |
| `company`, `company name`, `org`, `organization` | Company |
| `title`, `job title`, `position`, `role` | Job Title |
| `industry`, `sector`, `vertical` | Industry |
| `company size`, `employees`, `headcount` | Company Size |
| `icp score`, `score`, `icp` | ICP Score (0–100) |
| `temperature`, `temp`, `lead temp` | Temperature (Cold / Warm / Hot) |
| `search combo`, `combo` | Search Combo (A–F) |
| `scrape date`, `date` | Scrape Date |
| `market`, `country`, `region`, `location` | Market / Country |
| `custom1`, `message1`, `msg1`, `mensaje1` | Custom 1 |
| `custom2`, `message2`, `msg2`, `mensaje2` | Custom 2 |
| `custom3`, `message3`, `msg3`, `mensaje3` | Custom 3 |

Auto-detection is case-insensitive and strips spaces, underscores, and hyphens. Unmapped columns can be assigned manually or skipped.

### Duplicate detection

Checked against all prospects in the same area by **email** and **LinkedIn URL** — shared across all SDRs in that area. The database also enforces a global unique constraint on `linkedin_url`.

### Results breakdown

| Category | Meaning |
|---|---|
| Imported | Successfully inserted |
| Duplicados omitidos | Detected as duplicate in area, user chose to skip |
| Ya existían (global) | Blocked by global unique constraint (LinkedIn exists in another area) |
| Sin nombre (error) | Row had no name value — skipped automatically |
| Error | API or database error (shown in red with message) |

---

## Internationalization

The app supports 4 locales:

| Code | Language | Default |
|---|---|---|
| `zh` | Chinese (Simplified) | Yes |
| `en` | English | |
| `es` | Spanish | |
| `vi` | Vietnamese | |

Translation files live in `src/messages/*.json`. The locale appears in the URL path: `/zh/prospects`, `/en/prospects`, etc. Switch language with the globe icon in the sidebar footer.

---

## Project Structure

```
src/
├── app/
│   ├── [locale]/              # All pages (locale-prefixed routes)
│   │   ├── login/             # Login page
│   │   ├── prospects/         # Prospects table
│   │   ├── kanban/            # Kanban board
│   │   ├── import/            # CSV import (all users)
│   │   ├── stats/             # Stats dashboard
│   │   ├── audit/             # Audit log (admin only)
│   │   └── admin/users/       # User management (admin only)
│   └── api/
│       ├── import/            # POST dedup check · PUT insert (service role)
│       ├── prospects/         # DELETE bulk delete (service role)
│       └── users/             # POST · DELETE · PATCH SDR management (service role)
├── components/
│   ├── import/                # CSVImportWizard
│   ├── kanban/                # KanbanBoard, KanbanColumn, ProspectCard
│   ├── layout/                # AppShell, Sidebar, LanguageSwitcher
│   ├── prospects/             # ProspectsTable, ProspectDrawer, ProspectForm, NotesLog
│   ├── stats/                 # StatsDashboard
│   ├── users/                 # UsersManagement
│   ├── audit/                 # AuditLogTable
│   └── ui/                    # shadcn/ui base + custom badges
├── contexts/
│   └── UserContext.tsx        # Current user + role, available app-wide
├── i18n/                      # next-intl routing + request config
├── lib/
│   ├── supabase/              # client.ts (browser) · server.ts (SSR)
│   ├── types.ts               # All TypeScript interfaces and enums
│   └── utils/
│       └── audit.ts           # logAuditEvent helper
└── messages/                  # en.json · es.json · zh.json · vi.json
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

> The `npm run` scripts use `node node_modules/next/dist/bin/next` directly. Do **not** use `npx next` or `./node_modules/.bin/next` — they may fail with module resolution errors in this Next.js version.

---

## Key Design Decisions

**Service role pattern** — All writes that cross RLS boundaries (cross-area dedup, bulk insert, bulk delete, user deletion) use `SUPABASE_SERVICE_ROLE_KEY` exclusively inside server-side API routes. The key is never sent to the browser.

**Area isolation** — SDRs are scoped to one area at the DB level via RLS. The dedup check uses the service role so all SDRs in the same area share one deduplicated prospect pool — importing the same LinkedIn profile twice from different SDRs is blocked.

**Global linkedin_url unique constraint** — LinkedIn URLs are unique across the entire table (not per area). The import handles `23505` constraint violations by retrying row-by-row and counting conflicts separately from intentional skips.

**Audit trail** — Every significant action (import, status change, note, reassignment, SDR creation/deletion) is recorded in `audit_log` with actor name, timestamp, and metadata. Deleting a prospect clears the `prospect_id` FK reference but retains the log entry.

**SDR auto-assign** — Prospects imported by an SDR are automatically set with `assigned_to = user.id`, so they appear in the SDR's workqueue immediately without requiring admin intervention.
