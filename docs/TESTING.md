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
cp .env.example .env.local   # Fill in staging Supabase keys
npm run dev
# Open http://localhost:3000
```

**Migrations are not automatic.** Before testing, run every `.sql` in `supabase/migrations/` in the Supabase SQL editor. Several recent features fail without theirs:

| Migration | Needed for |
|---|---|
| `20260720_logos_bucket.sql` | Logo upload (otherwise "Bucket not found") |
| `20260720_prospects_linkedin_per_sdr.sql` | Moving leads between SDRs |
| `20260721_company_context.sql` | Company Context field in Settings |
| `20260721_bridge_addon.sql` | Enabling the Bridge add-on |

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
| Audit Log | ✗ | ✓ | ✗ (redirect to /kanban) |
| User Management | ✗ | ✓ | ✗ (redirect to /kanban) |
| Run History | ✗ | ✓ | ✗ (redirect to /kanban) |
| CSV Import | ✗ | ✓ (chooses area) | ✓ (own area auto-set) |
| Stats Dashboard | ✗ | ✓ (premium+) | ✗ |
| Conversations | ✗ | ✓ | ✗ |
| Closed Deals | ✗ | ✓ | ✓ (own leads only) |
| Settings | ✗ | ✓ | ✗ |
| Scraper | ✗ | ✓ | **✗ (no sidebar entry, API returns 403)** |
| Bridge / Partnerships | ✗ | ✓ *(only with the `bridge` add-on active)* | ✗ |
| Revenue → Reports | ✓ | ✗ | ✗ |
| Impersonate org | ✓ | ✗ | ✗ |

---

## Feature Test Checklists

### Responsive shell (mobile + tablet) — ongoing effort, CRITICAL for this piece

- [ ] Desktop (>= 1025px): sidebar and collapse-to-icons toggle behave exactly as before — no regression
- [ ] Tablet (768–1024px, e.g. iPad portrait/landscape): sidebar still shown persistently beside content (not a drawer) — same as desktop, just check nothing overflows horizontally
- [ ] Phone (<= 767px): sidebar is hidden by default; a hamburger button appears at the top-left of the header
- [ ] Tapping the hamburger slides the sidebar in from the left as an overlay (not pushing content aside), with a dark backdrop behind it
- [ ] Tapping the backdrop, tapping the sidebar's own close (X) button, or tapping any nav link all close the drawer
- [ ] Clicking a nav link while the drawer is open actually navigates (closing doesn't swallow the click)
- [ ] Impersonation banner (Global Admin viewing an org) wraps onto a second line on narrow phones instead of overflowing horizontally; the "Exit" button stays fully visible and tappable
- [ ] No horizontal scrollbar on the page body itself at any of the three widths, on any page — the content area (`min-width: 0` fix) must actually shrink instead of forcing the whole layout wider than the viewport
- [ ] The mobile drawer always shows full labels (not just icons), **even if the desktop sidebar was previously collapsed to icon-only** — this was a real bug found and fixed after Block 1 shipped; open the sidebar on desktop, collapse it, then shrink to phone width and open the drawer to confirm labels are back
- [ ] Kanban/Leads/etc. are covered separately below (Block 2) — this shell section covers only the sidebar/header chrome

### Kanban board (mobile + tablet) — Block 2

- [ ] On a real touchscreen (not just a resized desktop browser — touch emulation in dev tools doesn't always catch this): press and drag a card to a different column → it moves. A short tap (no real movement) opens the drawer instead of starting a drag.
- [ ] Dragging a card doesn't fight with the column row's own horizontal scroll — the drag should track the finger smoothly, not jump or get stuck mid-swipe
- [ ] The header (area filter / SDR dropdown / refresh / New Prospect) wraps onto a second line on narrow phones instead of overflowing or clipping any control
- [ ] The 7-column board scrolls horizontally on phone width (swipe between columns) without the *page itself* gaining a horizontal scrollbar — only the column row scrolls
- [ ] Tapping a card opens the same drawer as desktop, sized to the viewport (`width: 100%, maxWidth: 720` inside a padded overlay) — no clipped edges

### Leads / Prospects table (mobile + tablet) — Block 2

- [ ] Filter row (search / area / SDR / status / temperature / clear) wraps onto multiple lines on narrow phones without any control overflowing off-screen
- [ ] The table itself scrolls horizontally within its own bordered container — the page around it does not gain a horizontal scrollbar
- [ ] Select some leads → the fixed bottom action bar ("N leads selected", Reassign selected, Delete, Cancel) wraps onto a second line on narrow phones instead of clipping the Cancel button off the right edge
- [ ] Delete-confirm, SDR-reassign, and Reassign-selected modals all fit within the viewport on phone width (capped at `90vw`) with no horizontal overflow
- [ ] Pagination controls (prev/page N of M/next) stay centered and usable at phone width

### New Run (mobile + tablet) — Block 3

- [ ] Reviewed only, no code changes needed — page container, preset/pill rows, and the region/country market picker (`RegionMarketSelect`) were already responsive by construction (`maxWidth` caps, `flexWrap`, and an auto-fill grid with no fixed column count)
- [ ] Spot-check anyway on phone width: combo picker, leads stepper, and SDR picker list don't overflow; Phase 2/3 progress and result screens fit within their `maxWidth: 420-520` caps

### Dashboard / History / Export (mobile + tablet) — Block 3

- [ ] Dashboard: the active-run banner (pulsing dot / market+combos / status badge / "View history" link) wraps onto a second line on narrow phones instead of overflowing
- [ ] Dashboard: latest-run and recent-runs rows keep truncating long market/combo text with an ellipsis rather than overflowing (already correct before this pass — just confirm no regression)
- [ ] History: each run's collapsed header row (date/time · market+combo badges · lead count · status badge · cancel button · chevron) wraps onto multiple lines on narrow phones instead of clipping off-screen — this was a real overflow risk (five+ fixed-width items in one non-wrapping flex row) fixed this pass
- [ ] History: expanding a run still works after the header wraps; toolbar (leads count / Send to another SDR / Download CSV) and the leads table's horizontal scroll are unaffected
- [ ] Export: the "N leads a exportar" text + "Descargar CSV" button row wraps onto a second line on narrow phones instead of overflowing
- [ ] Export: run-select dropdown and the leads preview table (horizontal scroll, ellipsis on Company/Title/Custom 1) are unaffected

### Settings (mobile + tablet) — Block 3

- [ ] Tab strip (Organization / Plan & Usage / Scraper) scrolls horizontally on narrow phones instead of wrapping — the connected underline strip look is preserved, no tab clips off-screen
- [ ] Organization tab: Default Language + Logo fields stack into a single column on phone width instead of squeezing into two ~130px columns
- [ ] Plan & Usage tab: Active SDRs list rows (name + email + join date) truncate the name/email with an ellipsis instead of pushing the join date off-screen or overflowing the card
- [ ] Plan & Usage tab: "Buy More Seats" modal fits within the viewport on phone width (capped at `90vw`) — previously missing, would have overflowed edge-to-edge
- [ ] Scraper tab: each SDR's sender-profile header row (name + default-profile badge + Add profile button) wraps onto a second line on narrow phones instead of overflowing
- [ ] Scraper tab: sender-profile create form's two-column field grid (Display name / Title / Company / Language) collapses to one column on phone width
- [ ] Scraper tab: existing sender-profile list rows (name + title + company) truncate with an ellipsis instead of overflowing
- [ ] Scraper tab: Search Combos list rows wrap naturally (title/description/keyword-badges on the left, Enabled/Disabled toggle on the right) without the toggle clipping off-screen

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
- [ ] Step 2 (**SDR select**, not area) shown to admin, listing active SDRs with their area badge; hidden/auto-set for SDR (self-import unchanged)
- [ ] Selecting an SDR in Step 2 correctly carries their area into Step 3's header ("Area: X · SDR: Y")
- [ ] Column auto-detection works for standard LinkedIn export headers, including `custom1`/`custom2` (connection/follow-up message columns — try headers like `mensaje1`, `message2`, `msg1`)
- [ ] Manual column mapping works for unrecognized headers
- [ ] Required field (Name) missing → import blocked with error
- [ ] **Mapping `custom1` or `custom2` to a column, with an SDR selected, shows the "these leads already have messages generated for [SDR]" warning banner in Step 3** — critical, this is the new pre-generated-messages flow's core safety check
- [ ] Mapping neither `custom1` nor `custom2` → no warning banner shown, even with an SDR selected (a plain lead import shouldn't show a message-ownership warning)
- [ ] **Duplicate detection is now org-wide, not area-scoped** — a lead already assigned to a *different* SDR in the same org still shows as a duplicate in Step 4
- [ ] **Duplicate detection also checks `scraper_leads`** — a lead scraped but not yet exported to CRM (still sitting in `scraper_leads` with `exported_to_crm = false`) shows as a duplicate too, not just leads already in `prospects`
- [ ] Skip duplicate → not imported; Force Import → imported
- [ ] Results step shows correct breakdown: imported / duplicates / no name / forced
- [ ] Global unique constraint violation (LinkedIn URL exists in another org's area) handled gracefully
- [ ] Imported prospects appear in Prospects table immediately, assigned to the SDR chosen in Step 2 (not the importing admin)
- [ ] Audit log's `csv_import` entry includes `assigned_sdr` with the correct SDR name

### UX/performance batch (F1/F5/F6/F7/F17, FUNC-F1/F2/F4/F6/F7/F13, S1/S2)

- [ ] New Run: click "Run" → button shows a spinning icon + "Starting…" and is disabled, immediately, before `POST /api/runs` resolves
- [ ] Progress screen (Phase 2) shows a single "Running…" label with the spinner ring — no 4-dot Scraping/Scoring/Messages bar
- [ ] Sidebar `<Link>`s do not prefetch — open DevTools Network, reload the app shell, confirm no burst of RSC requests for every sidebar route on initial mount
- [ ] Both New Run's and Bridge's status polling stop (no more `GET .../[id]` requests) the instant a run reaches `completed`/`failed`/`cancelled`
- [ ] `PATCH /api/prospects` (reassign) completes noticeably faster than before — no functional change, just less serialized round-trip time
- [ ] Leads table: select 2-3 specific leads (not sequential) → "Reassign selected (N)" appears in the bulk bar → pick an SDR → confirm → exactly those leads move, audit log shows one `prospect_reassigned` entry **per lead, named** (not "—")
- [ ] The existing by-quantity "Reassign SDR" modal (Users icon button) still works unchanged and still logs a single count-only entry (that's expected — it's a different, intentionally coarser mode)
- [ ] Kanban card click → opens the same drawer as clicking a row in Leads (Info/Messages/Notes tabs, same data)
- [ ] Lead drawer → Messages tab → Custom 1/2 each have an Edit button → edit → Save → persists and reflects immediately; Cancel discards the change
- [ ] "Custom 3" does not appear anywhere: lead drawer Messages tab, manual "+ New Prospect" form, or CSV import column-mapping list
- [ ] History and Leads (Search Combo column) and Kanban cards show the combo's human name ("CTO / VP Engineering"), never a raw code like `combo_D`
- [ ] Audit Log: trigger a status change → "Detail" column shows translated labels ("New → Connection Sent"), not raw enum values; CSV export of the audit log matches
- [ ] Run a scrape where a lead's name contains a stuck-on title (can't force this from the CRM side — check existing data or wait for a natural occurrence) → confirm `prospects.name` has just the name, not `"Name - Title"`
- [ ] Manually create a prospect with a dash in the name (e.g. testing edge case) → confirm it is **not** trimmed (cleanup only applies to scraper-sourced leads)
- [ ] Kanban header (admin only): SDR dropdown next to the area filter → selecting an SDR shows only their leads across all columns; "All SDRs" resets to the consolidated view
- [ ] Drag a card to a new column → briefly highlighted (accent border + glow) in its new position, fading out over ~1.5-2s

### Route-level SDR gate on admin-only pages (FUNC-F12) — CRITICAL

- [ ] As `sdr`, navigate directly to each of `/history`, `/audit`, `/admin/users`, `/bridge`, `/run`, `/dashboard`, `/export` (type the URL, don't click a link — none of these should even be visible in the sidebar for an SDR, so this must be a direct-navigation test) → redirected to `/kanban`, page content never renders (check Network tab — no data request for that page should fire at all, not even one that comes back empty)
- [ ] As `admin`, all seven routes load normally
- [ ] As `admin_global` (impersonating or not), all seven still behave per their own rules — this fix must not affect the `admin`/`admin_global` path, only add a block for `sdr`
- [ ] Logged-out user hitting any of the seven → redirected to `/login`, not `/kanban`
- [ ] `/bridge` specifically: confirm the `sdr` redirect fires **before** any check of the `bridge` add-on's active state — an SDR should never see "add-on not active" or any other Bridge-specific message, only the generic redirect
- [ ] Full FUNC-F12 coverage is now closed — no known admin-only page left ungated

### Mandatory close-deal chat gate — CRITICAL

- [ ] Drag a Kanban card to the Closed column → `CloseDealModal` opens, card does **not** move columns yet, no DB write happens
- [ ] Paste chat text → "Save & close deal" → conversation is inserted, card moves to Closed, `outreach_status` is `closed` in DB, audit log has both `conversation_added` and `status_changed` entries
- [ ] Leave the textarea empty → "Save & close deal" is disabled
- [ ] Click "Skip for now" (no text needed) → card moves to Closed, no `conversations` row inserted, audit log has `status_changed` only
- [ ] Dismiss the modal (✕ or backdrop click) → nothing changes: card stays in its original column, no DB write at all
- [ ] Same three behaviors (save / skip / cancel) via the status dropdown in the Prospect Drawer, opened from **both** Kanban and the Leads table
- [ ] Selecting Closed from the dropdown when the lead is *already* closed does **not** re-open the modal (no-op)
- [ ] "Missing conversation" red icon appears on the Kanban card and the Leads table row for any closed prospect with zero conversations, and disappears immediately after an upload (no page reload needed)
- [ ] `GET /api/conversations/counts` — no session → 401; ids belonging to another org → excluded from the response, not just zero-filled
- [ ] Global Admin impersonation: Closed Deals' "no chat" stats still populate correctly (counts endpoint now requires `impersonate_org_id` explicitly for `admin_global`)

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

**Pipeline tab removed** — Settings no longer has a "Pipeline" tab at all (confirm it's absent from the tab bar). `/api/settings/pipeline-stages` no longer exists (`GET`/`PATCH` both 404). Kanban still shows each org's previously-configured stage names/colors, read from `pipeline_stages` directly — confirm those still render correctly (the 7 columns, in fixed funnel order, still show whatever custom label/color an org had set before the editor was removed) even with no way left in the UI to change them.

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

**Access**
- [ ] Logged in as SDR: no **Scraper** section in the sidebar at all
- [ ] As SDR, `POST /api/runs` returns 403
- [ ] As admin: Scraper section visible (hidden during impersonation)

**New Run — Phase 1 (config)**
- [ ] Header shows the remaining leads for the current **billing period** (not calendar month)
- [ ] All 4 region chips (Asia / Latin America / Europe / USA) are always visible and single-select; picking one clears the SDR selection
- [ ] Selecting a region shows a checkbox grid of only that region's **org-activated** countries, **all preselected**
- [ ] Unchecking a country removes it from the run; "Select all" / "Clear" toggles the whole region
- [ ] Switching to a different region resets the checkboxes to that region's full activated list (doesn't keep the old region's picks)
- [ ] A region with zero activated countries shows "No markets configured for [Region]" with a working link to Settings, and Run stays disabled
- [ ] Only search strategies enabled for the org appear
- [ ] Total Leads: presets 100–500 work; +/− steps by 10; clamps to min 10 / max 500
- [ ] Asking for more than the remaining allowance disables the Run button and shows the limit message
- [ ] **SDR picker is single-select (radio)** — you cannot select two
- [ ] SDR list is filtered by **region**, not by the individual countries checked — an SDR in that region appears regardless of which specific countries are ticked
- [ ] Run button stays disabled until region + ≥1 country + strategy + leads + one SDR are all set
- [ ] `POST /api/runs` payload has `markets` as the array of checked countries and `region` as the picked region
- [ ] `run_sdr_assignments.assigned_markets` holds the full country array — check both right after creation AND after the run completes (the auto-assign call used to collapse this to a single country on completion; confirm it still has all of them post-completion)

**New Run — Phase 2 (progress)**
- [ ] Ring animates; centre text shows "Initializing…" then "Running…" (no fabricated Scraping/Scoring/Messages sub-steps — see FUNC-F2/PERF-F2 in CLAUDE.md)
- [ ] Navigating away and returning to New Run **within an hour** restores the in-progress run
- [ ] Closing and reopening the tab restores it too, within the same window (state comes from the DB, not just localStorage)
- [ ] **Cancel run** sets the run to cancelled and shows the "Run cancelled" state
- [ ] **Transient status-read failures never show the failure screen** — block `/api/runs/[id]` (DevTools → Network → block request, or throttle to offline) for a few polls: the ring keeps spinning and a "📡 Reconnecting…" banner appears instead of "This run failed". Unblock it and confirm polling picks the run back up without any user action.
- [ ] While in the reconnecting state, `localStorage`'s `scraper_active_run` pointer is **not** cleared — reload the tab mid-block and the run still restores
- [ ] A genuine 404 (bad run id) or 403 (wrong org) **does** stop polling and route to the failure screen — these are the only cases that should
- [ ] **Recovery from a lost local pointer**: manually clear `localStorage.scraper_active_run`, then visit `/run?run=<a completed run's id>` — the leads should still get assigned (confirms the `run_sdr_assignments[0].sdr_id` server-side fallback in `runAssign()`)

**New Run — stale run restore guard (F-stale-run) — CRITICAL**
- [ ] Start a run, let it fail (or cancel it) so its pointer is kept in `localStorage.scraper_active_run` by design, then in DevTools console run `localStorage.setItem('scraper_active_run', JSON.stringify({...JSON.parse(localStorage.scraper_active_run), startedAt: Date.now() - 2*60*60*1000}))` (backdate it 2 hours) → reload `/run` → **Phase 1 config form shows, not the old failure/result screen** — confirm `localStorage.scraper_active_run` is now gone (not just ignored, actually cleared)
- [ ] Do the same backdating trick on a **completed** run's pointer → reload `/run` → Phase 1 shows, not a resurrected "✅ Run Complete" screen for a run that finished hours ago
- [ ] Manually set `localStorage.scraper_active_run` to a value **with no `startedAt` field at all** (simulating an entry written before this fix shipped) → reload `/run` → treated as stale, Phase 1 shows, key gets cleared — old pre-fix entries must not be trusted just because they lack the new field
- [ ] A pointer **less than an hour old** still restores normally, in whichever phase it's actually in
- [ ] Visiting `/run?run=<id>` for a real but old/completed run (e.g. via History's "View Details") **always shows that run's state**, regardless of age — the explicit query param is exempt from the staleness check, only the implicit localStorage restore is gated

**Webhook: `POST /api/runs/[id]/complete` (primary auto-assign trigger) — CRITICAL**
- [ ] No `X-Internal-Api-Key` header → 401
- [ ] Wrong key → 401
- [ ] Correct key, run doesn't exist → 404
- [ ] Correct key, run has exactly one `run_sdr_assignments` row (the normal case) → 200, `{ ok: true, sdr_id, assigned, queued, skipped }`, leads land in `prospects` on the right SDR's board, `scraper_leads.exported_to_crm` flips to `true`, monthly count bumps
- [ ] Correct key, run has **zero or 2+** `run_sdr_assignments` rows → 200, `{ ok: false, skipped: 'ambiguous', sdr_count }`, no leads touched — never guesses
- [ ] Calling it twice in a row (or racing it with the client-side assign / the cron) never double-inserts — second call's `skipped` count absorbs the leads already assigned
- [ ] Body is ignored entirely — POST with an empty body `{}` and confirm it still resolves `sdr_id` correctly from `run_sdr_assignments`, not from anything in the request
- [ ] cURL smoke test: `curl -X POST -H "X-Internal-Api-Key: $INTERNAL_API_KEY" .../api/runs/<id>/complete`

**Cron: `/api/cron/reconcile-runs` (backstop, not primary) — CRITICAL**
- [ ] No `Authorization` header → 401
- [ ] Wrong bearer token → 401
- [ ] Correct `Authorization: Bearer $CRON_SECRET` → 200 with `{ ok: true, checked, processed, skipped_ambiguous, errors }`
- [ ] End-to-end: start a run, let it complete, but simulate "nobody was watching AND the webhook didn't fire" — close the New Run tab (or just never load it), and don't call `/complete`. Confirm the leads sit in `scraper_leads` with `exported_to_crm = false`. Manually trigger the cron route (`curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/reconcile-runs`) and confirm the run now shows up in `processed`, the leads are in `prospects`, and the SDR's Kanban has them
- [ ] A run with **2+ rows** in `run_sdr_assignments` (e.g. after "Send to another SDR") is **not** touched — appears in `skipped_ambiguous` with the correct `sdr_count`, and no leads move
- [ ] Calling it twice in a row (or racing it with a live client-side assign or the webhook) never double-inserts — the second call's `processed` entry for that run shows those leads as `skipped`, not duplicated in `prospects`
- [ ] Running it with zero stuck leads anywhere returns `{ ok: true, checked: 0, processed: [], ... }` quickly, without erroring

**New Run — Phase 3 (result) — CRITICAL**
- [ ] Shows total generated + HOT/WARM/COLD cards
- [ ] Shows **Assigned to: [SDR name]** (singular, no distribution bars)
- [ ] **The generated leads actually appear in that SDR's Kanban** — this is the regression that previously failed silently
- [ ] Leads are assigned to the SDR chosen in Phase 1, not to the admin (test on a `basic` plan org too — that path used to fall back to the admin)
- [ ] Download CSV exports the run's leads
- [ ] View Detailed opens History with the run expanded

**History**
- [ ] Runs listed newest-first with market/strategy badges, lead count and status badge
- [ ] `?run=<id>` auto-expands that run and scrolls to it
- [ ] Expanded run shows **Assigned to: [name]** and the lead grid with per-lead assignee
- [ ] Download CSV works
- [ ] **Send to another SDR** moves the leads: the new SDR gets them AND the previous holder no longer has them
- [ ] For a run spanning several countries in one region, the eligible-SDR list considers **all** of the run's countries, not just the first — test with a run whose first market doesn't map to any area but a later one does (old behaviour showed every SDR here; it should now narrow correctly)
- [ ] The payload to `/api/runs/{id}/assign` carries `markets` as the full array (check the network tab), not just the run's primary market
- [ ] After a move, no lead exists on two SDRs' boards
- [ ] Active runs show a Cancel button; failed runs show only the support message
- [ ] There is no Scraper "Leads" page or sidebar entry

### Bridge / Partnerships

- [ ] With the `bridge` add-on **off**: no Partnerships entry in the sidebar; `GET /api/bridge/seed-lists` returns 403
- [ ] Turn the add-on on in Global Admin → entry appears after reload
- [ ] As SDR (add-on on): still no entry; API returns 403
- [ ] Create a seed list with **companies only** — check in Supabase that `company_names` (not `companies`) is populated on the backend row
- [ ] Create one with **criteria only** (headcount + market) — check `company_headcounts` and `geo_codes` are populated (not empty arrays) — this was the actual bug (F-payload-mismatch): the CRM form's field names didn't match the backend's schema and Pydantic silently dropped everything, so every seed list before this fix has empty `company_names`/`company_headcounts`/`geo_codes`/`industry_codes` regardless of what was filled in the form
- [ ] Create one with **criteria only** including industry — confirm `industry_codes` is sent as `[]` (known gap, no industry-to-code mapping exists yet — documented in CLAUDE.md, not silently guessed at)
- [ ] Create one with **both** — both are stored, correctly renamed
- [ ] Save is blocked until a name and at least one populated source exist
- [ ] Each seed list row has a delete (trash) icon → click → confirm modal ("Delete seed list "[name]"? This cannot be undone.") → Cancel does nothing; Delete removes it and refreshes the list
- [ ] Deleting a seed list that already has `bridge_runs` against it is allowed (not blocked) — the old run(s) still show in Past Searches with a generic "Seed list" label instead of the deleted name, no error
- [ ] If the backend doesn't yet implement `DELETE /bridge/seed-lists/[id]`, the delete attempt surfaces a clear error instead of silently doing nothing — this is a backend dependency, unverified from the CRM side
- [ ] The two seed lists that existed **before** this fix ("Hong Kong Software Companies", "Taiwan Software Reseller") still have empty backend fields — confirm whether they were recreated/edited per the team's decision, don't assume this fix retroactively repairs them
- [ ] Run a search: `POST /bridge/runs` succeeds (no 422 "Field required" for `run_id`, no 404 "Bridge run not found") — the proxy inserts a `bridge_runs` row first and passes its real id, same pattern as `/api/runs`
- [ ] The created `bridge_runs` row's `id` is what the client polls with, and `GET /bridge/runs/[id]` finds it immediately (no race)
- [ ] Force a backend rejection (e.g. temporarily break the Apify token) — the `bridge_runs` row ends up `status='failed'` with `error_message` set, not stuck at `pending` forever
- [ ] Run a search: progress ring + logs poll every 3s
- [ ] On completion, candidate count shown and candidates load
- [ ] Candidates are grouped by company: one header per company (name + LinkedIn link if `company_linkedin_url` is set) with up to 3 contacts shown underneath — a company with more than 3 confirmed/pending contacts only shows the first 3, by design
- [ ] A candidate with no `company_id` groups by its `company` name string instead (fallback), and one with neither groups under "Unknown company" rather than erroring
- [ ] Checkboxes/Confirm/Reject/Restore still operate per-contact inside a group — selecting one contact in a company group does not select its siblings
- [ ] **Reject** turns a candidate red and persists after reload
- [ ] **Restore** on a rejected candidate returns it to Pending
- [ ] Checkboxes appear **only** on pending candidates (not confirmed/rejected)
- [ ] Action bar appears once ≥1 is selected, with the correct count
- [ ] SDR dropdown lists **all active SDRs** of the org (not filtered by market or scraper access)
- [ ] Confirm button stays disabled until an SDR is chosen
- [ ] While confirming: "Generating personalized messages for X candidates…"
- [ ] On success: "X candidates confirmed and assigned to [SDR]" and the rows become Confirmed
- [ ] **View message** on a confirmed candidate shows custom1/custom2 and the assigned SDR
- [ ] Batch confirm with **Bridge Context** empty still works (context is optional)
- [ ] With no Anthropic key configured, confirm-batch returns a clear 400
- [ ] Passing an `sdr_id` from another org returns 400 (the proxy validates it)
- [ ] Filter chips (All / Pending / Confirmed / Rejected) show correct counts
- [ ] **Past Searches** lists previous runs (reads `bridge_runs` directly — no 405, the backend doesn't support listing); opening one loads its candidates

### Billing-period lead quota

- [ ] `GET /api/runs/quota` returns `used`, `max`, `available`, `period_start`, `period_end`
- [ ] With `billing_day = 23` and today the 15th, the period starts on the 23rd of the **previous** month
- [ ] Month-end clamping: `billing_day = 31` works in a 30-day month and in February
- [ ] Ultra plan reports `unlimited: true`
- [ ] Starting a run that exceeds the remaining allowance returns 429

### Global Admin — Revenue Reports

- [ ] Overview | Reports sub-tabs navigate correctly
- [ ] By Quarter lists orgs sold in earlier quarters that are still active (New this Q = No, 3 months)
- [ ] Day-15 rule: created in July → 3 months; 10 Aug → 2 months; 20 Sep → moves to Q2 with 3 months
- [ ] Setup fee only charged when New this Q = Yes
- [ ] Split maths: vendor at 15% → partners 42.5% each; vendor at 30% → 35% each; direct → 50/50
- [ ] Infrastructure costs subtracted **once**, half from each partner; vendor amounts unchanged
- [ ] Only vendors with sales that quarter appear in the split
- [ ] By Vendor filters to that vendor and shows commission with **no** mention of infrastructure costs
- [ ] Export PDF opens the print dialog with the table and summary

### Markets

- [ ] Settings → Organization shows a **Markets** card with 4 collapsible regions (Asia / Latin America / Europe / USA)
- [ ] Regions render in that canonical order regardless of DB row order; unexpected regions sort last
- [ ] Region header count (`3/12`) updates as you tick countries
- [ ] **Select all** / **Clear** toggles the whole region
- [ ] Save button is disabled until something changes, and re-disables after saving
- [ ] Reload shows the saved selection
- [ ] Save is a true sync: newly ticked are added, unticked are removed, untouched rows are left alone
- [ ] As `sdr`, `PUT /api/organizations/{own-org}/markets` returns 403 (read is allowed, write is admin-only)
- [ ] As admin of Org A, `GET /api/organizations/{org-B-id}/markets` returns 403
- [ ] `PUT` with an unknown market id returns 400 and writes nothing

**Bridge** (still single-market — see the New Run checklist above for the region + multi-country picker)
- [ ] Market chips show only the org's activated countries, grouped by region
- [ ] With zero markets configured: shows "No markets configured" with a working link to Settings
- [ ] Market stays single-select

### Settings

- [ ] **Company Context** textarea saves with the existing Save Changes button and survives reload
- [ ] Anthropic base URL ending in `/v1` is stored **without** the `/v1` (check the DB)
- [ ] No "Pipeline" tab in Settings anymore (removed entirely — see the "Pipeline tab removed" checklist above)
- [ ] Logo upload succeeds (bucket `logos` must exist)

### User Management

- [ ] Edit User modal contains only name, email, markets/areas and role
- [ ] No `years_experience` / `seniority` / `expertise_area` fields
- [ ] No **Scraper Access** toggle anywhere in the list or modal

### Sidebar

- [ ] Collapse button at center-right edge toggles sidebar
- [ ] Collapsed state: 64px wide, only icons visible, tooltips on hover
- [ ] Expanded state: 240px, labels visible
- [ ] State persists across page navigation (localStorage `sidebar_collapsed`)
- [ ] State persists on page refresh
- [ ] **Scraper section visible only to `admin`** (never to SDRs, never during impersonation)
- [ ] **Bridge section visible only to `admin` with the `bridge` add-on active**
- [ ] No light/dark theme toggle anywhere in the CRM header

---

## Edge Cases & Known Constraints

### Integer Overflow
- **Ultra plan** seats/leads stored as `2147483647` (Postgres int4 max)
- Entering any value larger → Postgres error. UI must prevent this via PLAN_DEFAULTS
- Display: any value ≥ `2147483647` must show `∞` not the raw number

### Duplicate LinkedIn URLs
- `prospects` is unique on `(organization_id, linkedin_url, assigned_to)` — the same lead **can** sit on two SDRs' boards when deliberately moved
- A conflicting row raises `23505`; insert paths must skip that row and continue, never abort the batch
- Requires the `20260720_prospects_linkedin_per_sdr.sql` migration. Without it the old org-wide unique key is still in place and moving leads between SDRs silently skips them.

### Lead counting
- `prospects` table has NO `organization_id` column — never query it this way
- `monthly_lead_counts` holds calendar-month totals (reporting)
- The **quota that gates runs** is billing-period based: `scraper_leads` with `exported_to_crm = true` inside the `billing_day` window. Test month-end clamping (`billing_day = 31`).

### Add-on gating
- Add-on-only features (Bridge) must be blocked **server-side**, not just hidden in the UI
- Test by calling `/api/bridge/seed-lists` directly with the add-on disabled — expect 403

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

# Lead quota for the current billing period
curl http://localhost:3000/api/runs/quota -b 'cookie-here'
# Expected: { used, max, available, unlimited, period_start, period_end }

# Start a scraper run (admin only, single SDR)
curl -X POST http://localhost:3000/api/runs \
  -H 'Content-Type: application/json' -b 'admin-cookie' \
  -d '{"market":"Taiwan","markets":["Taiwan"],"combos":["combo_A"],"total_leads":100,"sdr_id":"<sdr-uuid>"}'
# As SDR: 403 "Only the organization admin can run the scraper"
# Missing sdr_id: 400
# Over the period allowance: 429

# Bridge (admin + bridge add-on required)
curl http://localhost:3000/api/bridge/seed-lists -b 'admin-cookie'
# Add-on disabled: 403 "The Bridge add-on is not active for this organization"
# As SDR: 403 "Only the organization admin can use Bridge"
# NOTE: organization_id is injected server-side — passing your own is ignored

# Active add-ons for the caller's org (drives sidebar gating)
curl http://localhost:3000/api/settings/addons -b 'cookie-here'
# Expected: { addons: ["bridge", ...] }
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
| `src/lib/utils/lead-quota.ts` | Plan limit enforcement; billing-period boundaries |
| `src/app/api/runs/[id]/assign/route.ts` | **Leads silently never reaching the SDR.** Never gate the assign on `run_sdr_assignments` — the Railway backend writes those rows itself. |
| `src/app/[locale]/(scraper)/run/page.tsx` | Phase transitions, run restore, single-SDR payload |
| `src/app/api/bridge/[...path]/route.ts` | Add-on gate + `organization_id` injection — a bug here is a cross-org data leak |
| `src/lib/utils/quarter.ts` | Reports billable-month maths (day-15 rollover, fiscal-year boundaries) |
