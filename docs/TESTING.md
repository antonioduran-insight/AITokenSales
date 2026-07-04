# AITokenSales — Testing Guide

Documentation for the QA / Testing team.

---

## Table of Contents

- [Environment Setup](#environment-setup)
- [Test Accounts](#test-accounts)
- [Role Coverage Matrix](#role-coverage-matrix)
- [Feature Test Checklists](#feature-test-checklists)
- [Edge Cases & Known Constraints](#edge-cases--known-constraints)
- [API Testing](#api-testing)
- [Multi-Tenant Isolation Testing](#multi-tenant-isolation-testing)
- [Regression Areas](#regression-areas)

---

## Environment Setup

There are no automated tests. All testing is manual against the staging or production Supabase project.

**Local setup**:
```bash
git clone https://github.com/antonioduran-insight/AITokenSales.git
cd AITokenSales
npm install
cp .env.example .env   # Fill in staging Supabase keys
npm run dev
# Open http://localhost:3000
```

**Build verification** (runs TypeScript check):
```bash
npm run build
```
A passing build means no TypeScript errors. ESLint:
```bash
npm run lint
```

---

## Test Accounts

Create the following accounts in Supabase Auth for each test org. All accounts need a corresponding row in `public.users`.

| Role | Email pattern | `public.users.role` | Notes |
|---|---|---|---|
| Global Admin | `globaladmin@test.com` | `admin_global` | No `organization_id` |
| Org Admin | `admin@org-a.com` | `admin` | Has `organization_id` |
| SDR (Taiwan area) | `sdr-tw@org-a.com` | `sdr` | `area_id` = taiwan area UUID |
| SDR (LATAM area) | `sdr-latam@org-a.com` | `sdr` | `area_id` = LATAM area UUID |
| Inactive SDR | `inactive@org-a.com` | `sdr` | `is_active = false` |

Minimum: **two separate organizations** (Org A and Org B) to test cross-org isolation.

---

## Role Coverage Matrix

For each feature, verify behavior for all applicable roles:

| Feature | admin_global | admin | sdr |
|---|---|---|---|
| Login | ✓ | ✓ | ✓ |
| See Global Admin panel | ✓ | ✗ (redirect to /kanban) | ✗ |
| See all orgs | ✓ | ✗ | ✗ |
| Kanban | ✗ (redirect to /global-admin) | ✓ (all areas) | ✓ (own area only) |
| Prospects table | ✗ | ✓ (all areas + SDR filter) | ✓ (own area, no SDR filter) |
| Bulk delete | ✗ | ✓ | ✗ (no checkboxes) |
| Bulk SDR reassign | ✗ | ✓ | ✗ |
| Audit Log | ✗ | ✓ | ✗ |
| User Management | ✗ | ✓ | ✗ |
| CSV Import | ✗ | ✓ (chooses area) | ✓ (own area auto-set) |
| Stats Dashboard | ✗ | ✓ (premium+) | ✗ |
| Conversations | ✗ | ✓ | ✗ |
| Closed Deals | ✗ | ✓ | ✓ (own leads only) |
| Settings | ✗ | ✓ | ✗ |
| Scraper | ✗ | ✓ | ✓ |
| Impersonate org | ✓ | ✗ | ✗ |

---

## Feature Test Checklists

### Authentication

- [ ] Valid credentials → redirected to correct landing page by role
- [ ] Invalid credentials → error shown, no redirect
- [ ] Inactive SDR (`is_active = false`) → login blocked
- [ ] Unauthenticated direct URL access → redirected to `/login`
- [ ] Session expiry → redirected to `/login` on next navigation
- [ ] Locale prefix respected: `/en/login`, `/zh/login`, `/es/login`, `/vi/login`

### Global Admin — Organizations

- [ ] List loads with correct columns (plan, seats, leads/mo, vendor, admin email, SDR count)
- [ ] Search filters by org name in real time
- [ ] Plan filter dropdown works
- [ ] Status filter (Active / Inactive) works
- [ ] Edit modal opens with pre-populated data
- [ ] Changing plan auto-fills seats and leads per plan defaults
- [ ] Saving edit updates the table without reload
- [ ] Deactivating an org sets `is_active = false`; org admin login should reflect this (test both directions)
- [ ] INT_MAX (2147483647) seats/leads displayed as ∞ for Ultra plan

### Global Admin — Create Organization

- [ ] All required fields validated (name, slug, plan, admin name, email, password)
- [ ] Duplicate slug → error shown
- [ ] Duplicate admin email → error shown
- [ ] Plan selection auto-fills seat/lead defaults
- [ ] Market chips multi-select works
- [ ] Add-on toggles included in creation
- [ ] Created org appears in list immediately
- [ ] Admin user can log in with provided credentials
- [ ] Billing day defaults to 10

### Global Admin — Impersonation

- [ ] Click **View** on an org → yellow banner appears at top
- [ ] CRM data shown belongs to the impersonated org only
- [ ] Drag-and-drop on Kanban does NOT update status (read-only)
- [ ] Import wizard is inaccessible or blocked
- [ ] Click **Exit** → returns to Global Admin organizations list
- [ ] URL contains `?impersonate_org_id=` and `?impersonate_org_name=`

### Kanban Board

- [ ] Cards load for correct area (SDR sees only their area's prospects)
- [ ] Admin sees all areas; area pill tabs filter correctly
- [ ] Drag card from one column to another → status updates immediately in UI
- [ ] Drag confirmed in DB (refresh page, card stays in new column)
- [ ] Drag reverted on DB error
- [ ] Audit log entry created for status change
- [ ] Card shows: name, company/title, area badge, temperature badge, ICP score, flag star
- [ ] Flag star visible when `flag_tomorrow = true`
- [ ] Clicking a card opens the Prospect Drawer
- [ ] **+ New Prospect** button opens form; created prospect appears in New column

### Prospects Table

- [ ] All filters work independently and in combination
- [ ] Search matches on name, company, and email
- [ ] SDR filter shows "All SDRs" + "Unassigned" + individual SDR names (admin only)
- [ ] Page size selector (Show 25 / 50 / 100 / 250) correctly limits results
- [ ] Pagination arrows navigate correctly; disabled at boundaries
- [ ] Custom3 column is NOT present in headers or rows
- [ ] Bulk select: checkbox column visible for admin, hidden for SDR
- [ ] Select all → bottom bar appears with count
- [ ] Delete modal confirms count; cancelling aborts; confirming deletes and refreshes
- [ ] Reassign SDR modal: From/To select, count displayed, quantity field optional
- [ ] Toast appears after successful reassign

### Prospect Drawer

- [ ] Opens on row click or card click
- [ ] All fields editable and persist on save
- [ ] Status change logged in Audit Log
- [ ] Flag Tomorrow toggle persists
- [ ] Notes tab: add note → appears with timestamp and author name
- [ ] Messages tab: Copy button copies Custom 1 / Custom 2 to clipboard
- [ ] Drawer closes without losing table scroll position

### CSV Import

- [ ] File size >5 MB rejected with error
- [ ] Non-CSV file rejected
- [ ] Step 2 (area select) shown to admin; hidden/auto-set for SDR
- [ ] Column auto-detection works for standard LinkedIn export headers
- [ ] Manual column mapping works for unrecognized headers
- [ ] Required field (Name) missing → import blocked with error
- [ ] Duplicate detection: prospects matching by email or LinkedIn URL in same area shown in Step 4
- [ ] Skip duplicate → not imported; Force Import → imported
- [ ] Results step shows correct breakdown: imported / duplicates / no name / forced
- [ ] Global unique constraint violation (LinkedIn URL exists in another org's area) handled gracefully
- [ ] Imported prospects appear in Prospects table immediately

### Closed Deals

- [ ] Page shows only `closed` status prospects
- [ ] Stats bar: "no chat" count matches prospects with `chatCount = 0`
- [ ] Upload chat for first time: reason field hidden; only chat content required
- [ ] Upload subsequent chat: reason + content both required
- [ ] Uploaded conversation appears in Conversations page
- [ ] "with chats" count increments
- [ ] View chat (eye icon) shows conversation log modal
- [ ] SDR sees only their own closed leads
- [ ] Admin SDR filter works

### Conversations

- [ ] Grid layout (auto-fill, min 320px cards)
- [ ] All filters work (search, area, SDR, date range)
- [ ] Clear button resets all filters
- [ ] **View full** opens modal with complete chat content
- [ ] Clicking prospect name in card opens Prospect Drawer

### Stats Dashboard

- [ ] Page shows "Premium feature" gate for `basic` plan orgs
- [ ] Global conversion rate matches `closed / total` count
- [ ] SDR leaderboard sorted by conversion rate descending
- [ ] Area breakdown sorted by conversion rate descending
- [ ] "This Week" count uses Mon–Sun week boundary

### Audit Log

- [ ] Visible to admin; returns 403 / redirects for SDR
- [ ] All event types present after performing each action
- [ ] Deleting a prospect does NOT delete its audit entries (FK nullified)

### User Management

- [ ] Create SDR: new user can log in; appears in SDR filter dropdowns
- [ ] Deactivate: login attempt shows auth error; Prospects table SDR filter still shows name
- [ ] Reactivate: login restored
- [ ] Unassign: all prospects by that SDR have `assigned_to = null`
- [ ] Delete: SDR row removed; their leads unassigned; audit log entry retained

### Settings

**Organization tab**:
- [ ] Name and language save correctly
- [ ] Logo upload: select image file → uploads → preview shows new logo → URL auto-filled
- [ ] Domain blacklist: domains blocked from CSV import and manual creation

**Pipeline tab**:
- [ ] Stage reorder (drag) persists and reflects in Kanban column order
- [ ] Stage name edit persists
- [ ] Color change persists
- [ ] New stage appears in Kanban
- [ ] Deleted stage disappears from Kanban (existing prospects not deleted)

**Plan & Usage tab**:
- [ ] Shows correct plan name
- [ ] Seat bar: active SDR count / max seats
- [ ] Lead bar: leads this month (from `monthly_lead_counts`) / max leads
- [ ] Billing day shows 10 (default)
- [ ] Add-ons list reflects org's active add-ons

**Support tab**:
- [ ] Create ticket → appears in Global Admin support list
- [ ] Reply from Global Admin → thread visible in Settings support tab
- [ ] Status changes reflected

### LinkedIn Scraper

- [ ] Dashboard: total runs and total leads correct
- [ ] Active run banner appears and auto-refreshes while run is active
- [ ] No HOT Leads card in stats (only Total Runs + Total Leads)
- [ ] No temperature emojis/bars anywhere in dashboard
- [ ] New Run: combo multi-select, market select, limit field all work
- [ ] Run launches and status progresses through pending → running → scoring → drafting → completed
- [ ] History: run rows show lead count (not HOT/WARM/COLD chips)
- [ ] Expanding a run shows Name/Company/Title/ICP/Temp headers (English)
- [ ] Import to CRM: area required; SDR optional; result shows Imported/Duplicates/No name
- [ ] Scraper Leads: "All Runs" and "All Temps" dropdowns filter correctly
- [ ] Lead detail drawer: Details/Messages section headers in English; copy buttons work

### Sidebar

- [ ] Collapse button at center-right edge toggles sidebar
- [ ] Collapsed state: 64px wide, only icons visible, tooltips on hover
- [ ] Expanded state: 240px, labels visible
- [ ] State persists across page navigation (localStorage `sidebar_collapsed`)
- [ ] State persists on page refresh
- [ ] Scraper section only visible for admin and SDR roles (not during impersonation)

---

## Edge Cases & Known Constraints

### Integer Overflow
- **Ultra plan** seats/leads stored as `2147483647` (Postgres int4 max)
- Entering any value larger → Postgres error. UI must prevent this via PLAN_DEFAULTS
- Display: any value ≥ `2147483647` must show `∞` not the raw number

### Duplicate LinkedIn URLs
- `linkedin_url` has a global UNIQUE constraint across ALL orgs
- Importing the same LinkedIn URL from a different org = `23505` Postgres error
- Must be counted as a failed import row, not cause the entire import to fail

### Monthly Lead Counts
- Lead limits are enforced via `monthly_lead_counts` table, not by counting `prospects`
- `prospects` table has NO `organization_id` column — never query it this way

### RLS and Service Role
- Browser-side Supabase calls (anon key) respect RLS — SDRs cannot see other areas' data
- API routes with admin client bypass RLS — test that these routes validate caller role server-side

### Impersonation Write Blocking
- Every write operation in the CRM must be blocked when `isImpersonating = true`
- Test by trying to drag Kanban, import CSV, edit a prospect, delete a prospect while impersonating

### Inactive User Login
- A Supabase Auth user can be deactivated in `public.users` (`is_active = false`) without deleting the auth account
- The app must check `is_active` and block the session (check middleware or layout-level guard)

---

## API Testing

Test API routes directly with curl or Postman. All routes require a valid session cookie.

### Getting a session cookie

```bash
# Log in via the UI, then copy cookies from browser DevTools → Network → any request → Cookie header
# Or use the Supabase REST API to get a token:
curl -X POST 'https://<project>.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: <anon-key>' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@org.com","password":"password"}'
```

### Key routes to test

```bash
# Bulk delete prospects (requires admin)
curl -X DELETE http://localhost:3000/api/prospects \
  -H 'Content-Type: application/json' \
  -b 'cookie-here' \
  -d '{"ids":["uuid1","uuid2"]}'
# Expected: { deleted: 2 }
# As SDR: 403 Forbidden

# Create org (requires admin_global)
curl -X POST http://localhost:3000/api/global-admin/create-org \
  -H 'Content-Type: application/json' \
  -b 'ga-cookie' \
  -d '{"name":"Test Org","slug":"test-org","plan":"basic","admin_name":"Test","admin_email":"t@t.com","admin_password":"pass123"}'
# As regular admin: 401 Unauthorized

# Plan usage stats
curl http://localhost:3000/api/settings/plan -b 'cookie-here'
# Expected: { org: { plan, max_seats, max_leads_per_month, ... }, seats_used, leads_this_month }
```

### Expected HTTP codes

| Scenario | Expected |
|---|---|
| Unauthenticated request | 401 |
| Wrong role (e.g. SDR hitting admin-only route) | 401 or 403 |
| Missing required body field | 400 with `{ error: "..." }` |
| Successful create | 200 with created entity |
| Not found | 404 or empty array (not 500) |

---

## Multi-Tenant Isolation Testing

**Critical**: verify data from Org A is never visible to users in Org B.

### Test matrix

1. Create two orgs: **Org A** and **Org B**
2. Add prospects to Org A
3. Log in as Org B admin
4. Verify:
   - [ ] Prospects from Org A do NOT appear in any table or Kanban
   - [ ] Org A users do NOT appear in SDR management
   - [ ] Audit log shows only Org B events
   - [ ] Stats show only Org B data
   - [ ] Settings shows Org B plan/usage only

5. Log in as Org A SDR (Taiwan area)
6. Verify:
   - [ ] Cannot see LATAM area prospects (even within Org A)
   - [ ] Import auto-assigns to Taiwan area (cannot override to LATAM)
   - [ ] Audit log (if visible) shows only Taiwan area events

### Direct DB query validation

After running isolation tests, verify in Supabase SQL Editor:

```sql
-- No prospect should ever have organization_id = null (if that column existed)
-- Instead verify via user context:
SELECT p.id, p.name, p.area_id
FROM prospects p
WHERE p.area_id NOT IN (
  SELECT area_id FROM users WHERE organization_id = '<org-b-uuid>'
)
-- This should return 0 rows when queried as Org B admin via anon key + RLS
```

---

## Regression Areas

Changes in these areas have historically caused regressions. Pay extra attention after any modifications:

| Area | Risk |
|---|---|
| `src/middleware.ts` | Breaks auth for all routes if misconfigured |
| `src/app/[locale]/layout.tsx` | Breaks session reading; org plan passed incorrectly |
| `src/components/layout/Sidebar.tsx` | Collapse state, role-based nav item visibility |
| `src/app/api/import/route.ts` | Dedup logic, constraint error handling, row-by-row retry |
| `src/app/api/global-admin/create-org/route.ts` | Rollback on partial failure (auth user created but org fails) |
| `src/lib/hooks/useOrgId.ts` | Impersonation mode — any change here affects all CRM writes |
| Supabase RLS policies | SDR seeing other areas' data; cross-org leakage |
| `monthly_lead_counts` logic | Plan limit enforcement; billing display accuracy |
