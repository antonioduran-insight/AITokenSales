# AITokenSales — User Manual

Complete guide for all user roles: Global Admin, CRM Admin, and SDR.

---

## Table of Contents

- [Logging In](#logging-in)
- [Global Admin](#global-admin)
- [CRM Admin Guide](#crm-admin-guide)
- [SDR Guide](#sdr-guide)
- [Settings](#settings)
- [LinkedIn Scraper](#linkedin-scraper)
- [Support](#support)

---

## Logging In

1. Navigate to the app URL
2. Enter your email and password
3. You are redirected to your home page based on your role:
   - **Global Admin** → Global Admin panel (`/global-admin`)
   - **Admin / SDR** → Kanban board (`/kanban`)

To change the interface language, click the language switcher in the sidebar footer (CRM) or the navbar (Global Admin). Supported: English, 中文, Español, Tiếng Việt.

---

## Global Admin

The Global Admin panel is only accessible to accounts with the `admin_global` role. It has its own horizontal navbar and an independent dark/light theme toggle.

### Organizations

**List view** — Shows all client organizations with plan, seats, leads/mo, MRR, vendor, admin email, SDR count, and status.

**Filters**: search by name, filter by plan, status, or vendor.

**Actions per org**:
- **View** — Opens the org's CRM in read-only impersonation mode (yellow banner appears)
- **Edit** — Opens the edit modal: name, plan, seats, leads/month, billing day, custom price, vendor, language, logo, internal notes, active status

**Editing an org**:
1. Click **Edit** next to any org
2. Change the plan → seats and leads limits auto-fill with plan defaults
3. Set seats/leads to override manually (Ultra plan sets both to ∞)
4. Click **Save Changes**

#### Plan Defaults

| Plan | Max Seats | Leads/Month |
|---|---|---|
| Basic | 3 | 1,000 |
| Premium | 10 | 3,000 |
| Enterprise | 15 | 10,000 |
| Ultra | Unlimited | Unlimited |

### Creating a New Organization

1. Click **New Organization** in the top-right
2. Fill in:
   - **Org name** and **slug** (URL identifier, lowercase, hyphens)
   - **Plan** — auto-fills seat and lead defaults
   - **Markets** — click chips (Taiwan, LATAM, Vietnam, Europe, Global)
   - **Admin name**, **email**, and **temporary password** (creates the first admin user)
   - Optional: custom price, vendor, logo URL, default language, internal notes
   - Optional: toggle **Add-ons** (Account Management, Multi Workspace, SSO, etc.)
3. Click **Create Organization**

This provisions the organization and its first admin user in a single operation.

### Org Detail Page

Click an org name to open its detail page:
- **Info card** — edit all fields inline
- **Usage stats** — leads this month, open tickets, SDR count
- **Add-ons** — checkboxes to toggle features
- **Internal Notes** — auto-saves as you type (debounced)
- **Danger Zone** — deactivate/reactivate the org

### Support Tickets

View and respond to support tickets from all organizations.

- Tickets are listed with priority, status, subject, org name, and last reply date
- Click a ticket to open the thread and reply
- Change ticket status (Open → In Progress → Resolved → Closed)

### Revenue

Per-org MRR breakdown with plan distribution charts and vendor commission tracking.

### Vendors

Add and manage reseller/vendor records with name, email, and commission percentage.

### Impersonation Mode

When viewing an org's CRM:
- A **yellow banner** at the top confirms read-only mode: "Viewing [Org Name] — Read Only Mode"
- All write operations (drag-drop, status changes, imports, form saves) are disabled
- Click **Exit** in the banner to return to the Global Admin panel

---

## CRM Admin Guide

### Dashboard: Kanban Board

The Kanban board shows all prospects as cards organized by outreach status.

**Area filter** — Click the pill tabs at the top (All / Taiwan / LATAM / Vietnam / etc.) to filter by market area.

**Drag and drop** — Drag a card from one column to another to update the prospect's status instantly.

**Add prospect** — Click **+ New Prospect** (top-right) to open the creation form.

**Columns (Pipeline Stages)**:

| Status | Meaning |
|---|---|
| New | Imported, not yet contacted |
| Connection Sent | LinkedIn request sent |
| Connected | Request accepted |
| Replied | Responded to a message |
| Demo Scheduled | Meeting booked |
| Closed | Deal won |
| Nurture | Long-term drip |

Pipeline stage names and colors can be customized per org in **Settings → Pipeline**.

---

### Prospects Table

Full sortable, filterable table of all prospects.

**Filters**:
- **Search** — matches name, company, or email
- **Area** (admin only) — filter by market region
- **All SDRs / Unassigned** (admin only) — filter by assigned rep
- **Status** — filter by outreach stage
- **Temperature** — Cold / Warm / Hot
- **Show N** — page size (25 / 50 / 100 / 250)

**Clicking a row** opens the **Prospect Drawer** (see below).

**Bulk actions** (admin only):
1. Check one or more rows using the checkbox column
2. A bottom bar appears with the count of selected leads
3. Click **Delete (N)** → confirm in the modal to permanently delete
4. Use **Reassign SDR** (top-right button) to bulk-move leads between reps

**Reassign SDR modal**:
1. Click **Reassign SDR**
2. Select the **From** SDR and the **To** SDR
3. Optionally limit how many leads to transfer (default: all)
4. Preview shows the exact count that will be moved
5. Click **Confirm reassignment**

---

### Prospect Drawer

Click any prospect row or card to open a side drawer with full detail.

**Tabs**:

- **Info** — Edit outreach status, temperature, ICP score, company, title, industry, company size, LinkedIn URL, email, market, search combo, custom messages 1 & 2. Toggle **Flag Tomorrow** to mark for next-day follow-up.
- **Notes** — Add timestamped internal notes. Notes are visible to all team members in the same org.
- **Messages** — Copy-button view of Custom 1 and Custom 2 outreach message fields.

Changes auto-save on field blur or on clicking the **Save** button.

---

### Closed Deals

The **Closed Deals** page (`/convertidos`) shows all prospects with status `closed`.

**Stats bar** at the top shows:
- How many closed deals have **no chat logged** (red — action needed)
- How many have **with chats** logged (green)

**Uploading a chat**:
1. Click the **upload icon** on any prospect row
2. For the first upload: paste the full chat content (reason is set automatically)
3. For subsequent uploads: enter a reason and paste the chat content
4. Click **Save**

**Viewing a chat**:
1. Click the **eye icon** on a prospect that already has chats
2. Browse the full conversation log

**Filters**: search by name/company, filter by SDR (admin only).

---

### Conversations

The **Conversations** page (`/conversations`) shows all uploaded chat logs in a grid.

- Filter by date range, area, or SDR
- Click **View full** on any card to read the complete conversation in a modal
- Click the prospect name on a card to open the Prospect Drawer

---

### Stats Dashboard

Available to **Premium and higher** plans.

**Sections**:
- **Global Conversion Rate** — closed / total leads with progress bar
- **By SDR** — leaderboard ranked by conversion rate
- **By Area** — conversion rate per market region
- **By Status** — distribution across all pipeline stages
- **By Temperature** — Cold / Warm / Hot breakdown
- **This Week** — leads added in the current Mon–Sun window

---

### Audit Log

Full immutable trail of every significant action in the org.

**Event types logged**:
- CSV import (with count breakdown)
- Prospect status changes
- Notes added
- SDR reassignments (individual and bulk)
- SDR created / deactivated / deleted
- Conversation uploaded

Filters: search by actor name or event type, filter by date range.

---

### User Management

**Admin → Users** (`/admin/users`)

**Creating an SDR**:
1. Click **New SDR**
2. Enter: Full Name, Email, Password, Area
3. Click **Create** — the SDR can log in immediately

**SDR actions**:

| Button | Effect |
|---|---|
| Deactivate | Blocks login; leads stay assigned |
| Reactivate | Restores login access |
| Unassign (amber) | Sets `assigned_to = null` on all their leads; leads remain in DB |
| Delete (red) | Permanently deletes the SDR; leads become unassigned |

---

### CSV Import

**Admin import** (`/admin/import`): 5-step wizard
**SDR import** (`/import`): same wizard but area is auto-set to your area

**Step 1 — Upload**: drag or click to upload a `.csv` file (max 5 MB).

**Step 2 — Select area** (admin only): choose the target market area.

**Step 3 — Map columns**: the wizard auto-detects common headers. For unrecognized columns, use the dropdown to assign a field or mark as "Skip".

Required field: **Name**. All others are optional.

**Step 4 — Review duplicates**: if any rows match existing prospects in the area (by email or LinkedIn URL), they appear here. Toggle each between **Skip** and **Force Import**.

**Step 5 — Results**:

| Result | Meaning |
|---|---|
| Imported | Successfully added |
| Duplicates | Detected and skipped (or force-imported) |
| No name | Rows with empty name field — always skipped |
| Forced | Duplicates that were force-imported |
| Error | Database error (shown with message) |

---

## SDR Guide

As an SDR, you see only prospects in your assigned area.

### Your workspace

- **Kanban** — Your pipeline. Drag cards to update status.
- **Prospects** — Table view with search and filters. Click any row to edit.
- **Closed Deals** — Your won deals. Upload chat logs here.
- **Import** — Import your CSV leads (auto-assigned to you and your area).
- **Scraper** — If enabled, launch scraping runs and import the results.

### Importing leads

1. Click **Import** in the sidebar
2. Upload your CSV
3. Map columns (most are auto-detected)
4. Review any duplicates
5. All imported leads are automatically assigned to you

### Working a prospect

Click any prospect to open the drawer:
- Change the outreach status as you progress
- Set temperature (Hot / Warm / Cold) based on engagement
- Add notes to track conversation history
- Use **Flag Tomorrow** to queue it for next-day follow-up

### Logging a closed deal chat

When you close a deal:
1. Go to **Closed Deals**
2. Click the upload icon on the prospect
3. Paste the LinkedIn/WhatsApp/email conversation
4. Save — this creates an auditable record of the deal conversation

---

## Settings

**Settings** (`/settings`) — accessible to admins only.

### Organization Tab

- **Org Name** — display name across the platform
- **Default Language** — sets the default locale for new users
- **Logo** — click **Upload Logo** to upload an image (stored in Supabase Storage). Formats: PNG, JPG, GIF, SVG, WebP.
- **Domain Blacklist** — one domain or company name per line; blocks these from CSV imports and manual prospect creation

Click **Save Changes** to apply.

### Pipeline Tab

Customize the Kanban stage names and colors:
- Drag stages to reorder
- Edit the name inline
- Click the color chip to change the color
- Click **+ Add Stage** to create a new column
- Click the trash icon to delete a stage (prospects in that stage are not deleted)

### Plan & Usage Tab

Shows your current plan, billing day, seat usage (active SDRs / max), lead usage this month (imported / max), and active add-ons.

### Support Tab

Submit and track support tickets with the AITokenKing team.

**Creating a ticket**:
1. Click **New Ticket**
2. Enter a subject, priority (Low / Medium / High / Urgent), and description
3. Submit — the ticket is visible to the Global Admin support team

**Viewing replies**: Click any existing ticket to read the thread.

### Account Management Tab

Contact details placeholder — AITokenKing support contact information.

---

## LinkedIn Scraper

The scraper module is accessible via the **Scraper** section in the sidebar (admins and SDRs).

### Dashboard

Live overview:
- Total runs executed
- Total leads scraped
- Active run progress (auto-refreshes every 10 seconds)
- Recent runs list with quick **→** links to leads

### New Run

1. Select one or more **combos** (A–G, each targets a different LinkedIn audience segment)
2. Select the **market** (Taiwan, LATAM, Vietnam)
3. Set **leads per combo** (how many profiles to scrape per combo)
4. Click **Launch Run**

The run goes through phases: Starting → Scraping → Scoring → Generating messages → Completed.

You can watch live logs stream in real time during the run.

### Run History

All past runs listed with date, market, lead count, and status.

- Click any row to expand and preview up to 15 leads
- **Import to CRM** — for completed runs, import leads into the CRM:
  1. Select the target **Area**
  2. Optionally assign to a specific **SDR**
  3. Click **Import N leads**
  4. Results show: Imported / Duplicates / No name
- **Delete** a run (removes from scraper only; does not affect CRM leads already imported)
- **Clear History** — deletes all runs (requires typing DELETE to confirm)

### Scraper Leads

Browse all scraped leads across all runs.

- Filter by **run** or **temperature** (All Temps / HOT / WARM / COLD)
- Click any row to open the detail panel with:
  - Company, title, industry, location, LinkedIn link
  - **Connection request** message (Custom 1) with Copy button
  - **Value message** (Custom 2) with Copy button

---

## Support

For technical issues, billing questions, or feature requests:
1. Go to **Settings → Support**
2. Submit a ticket with priority and description
3. The AITokenKing team will reply in the ticket thread

Contact details: see **Settings → Account Management**.
