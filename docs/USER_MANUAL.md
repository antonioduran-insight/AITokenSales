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
- [Bridge — Partnerships](#bridge--partnerships)
- [Support](#support)

---

## Logging In

1. Navigate to the app URL
2. Enter your email and password
3. You are redirected to your home page based on your role:
   - **Global Admin** → Global Admin panel (`/global-admin`)
   - **Admin / SDR** → Kanban board (`/kanban`)

To change the interface language, click the language switcher in the CRM header or the Global Admin navbar. Supported: English, 中文, Español, Tiếng Việt.

> The CRM uses a single dark theme — there is no light/dark toggle. (The Global Admin panel keeps its own independent theme toggle.)

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

| Plan | Max Seats | Leads/period |
|---|---|---|
| Basic | 3 | 1,000 |
| Premium | 7 | 3,000 |
| Enterprise | 15 | 10,000 |
| Ultra | Unlimited | Unlimited |

> The lead allowance renews on the org's **billing day**, not on the 1st of the month. With `billing_day = 23`, the current period runs from the 23rd of one month to the 22nd of the next.

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
- **Info card** — edit all fields inline (including the Anthropic base URL / model and Apify token)
- **Usage stats** — leads this month, open tickets, SDR count
- **Add-ons** — checkboxes to toggle features
- **Internal Notes** — auto-saves as you type (debounced)
- **Danger Zone** — deactivate/reactivate the org

#### Add-ons

| Add-on | Effect |
|---|---|
| Account Management | Dedicated account manager (commercial) |
| Multi Workspace | Multiple workspaces (commercial) |
| Extended Data Retention | Longer data retention (commercial) |
| SSO | SSO integration (commercial) |
| LinkedIn Auto-messaging | Automated messaging (commercial) |
| **Bridge (Partnerships)** | **Unlocks the Bridge partnership-discovery module in the org's CRM sidebar** |

Bridge is the only add-on that changes the product UI today: turning it on makes the **Partnerships** section appear for that org's admin.

> **Anthropic base URL**: paste the plain host (e.g. `https://api.aitokenking.com.tw`). If you paste a URL ending in `/v1`, the app strips it automatically before saving — the backend appends the version path itself.

### Support Tickets

View and respond to support tickets from all organizations.

- Tickets are listed with priority, status, subject, org name, and last reply date
- Click a ticket to open the thread and reply
- Change ticket status (Open → In Progress → Resolved → Closed)

### Revenue

Two sub-tabs: **Overview** and **Reports**.

#### Overview

Per-org MRR breakdown with quarter selector, plan distribution chart, monthly infrastructure/API cost inputs (saved in your browser), and the profit-sharing summary.

#### Reports

**By Quarter** — pick a quarter to get a table of every organization that bills in it, including orgs sold in earlier quarters that are still active.

| Column | Meaning |
|---|---|
| Organization / Plan / Sale Date | Who and when |
| New this Q? | Whether this is the org's first billed quarter |
| Setup Fee | Only charged when "New this Q" is Yes |
| Add-ons/mo | Monthly total of the org's active add-ons |
| Months | Billable months this quarter |
| MRR this Q | Plan price × months |
| Total | Setup + (add-ons × months) + MRR |
| Vendor | Vendor name, or "Direct" |

**Months billable** follows a day-15 rule: an org created after the 15th of the quarter's last month rolls over to the next quarter and is billed for 3 full months there. Examples (Q1 = Jul–Sep): created in July → 3 months; created 10 Aug → 2 months; created 20 Sep → moves to Q2 with 3 months.

The footer shows **Gross Revenue − Infrastructure Costs = Net Revenue**, then the split:
- Each org's revenue is split individually. With a vendor, the vendor takes its own commission percentage and the remaining share is divided 50/50 between the two partners. Direct sales split 50/50.
- Quarter infrastructure costs are subtracted **once**, half from each partner. **Vendors never absorb infrastructure costs.**
- Only vendors with sales in that quarter appear.

**By Vendor** — the same table filtered to one vendor, with their total sales and commission for the quarter. This view never mentions infrastructure costs; it's meant to be sent to the vendor.

**Export PDF** on both views opens a print dialog — choose "Save as PDF".

### Vendors

Add and manage reseller/vendor records with name, email, and commission percentage. The commission percentage entered here is what drives the split in Reports.

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

> **SDRs do not have access to the Scraper or Bridge.** Only your organization's admin runs them. When your admin launches a run and picks you as the recipient, the generated leads land directly in your Kanban with messages written for your sender profile.

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
- **Company Context** — free text describing what your company does, who you sell to, and any product or focus you want mentioned in outreach. This is sent to the scraper so generated messages reference your real offering.
  > Example: *"We sell AI-powered CRM software to B2B sales teams in Asia. Right now we're pushing our new automation feature — mention it when relevant."*
- **Bridge Context** — what you're after in a partnership: what you offer as a partner, what you want in return, and which deal type to prioritise. Used when Bridge generates messages for confirmed candidates.
  > Example: *"We're looking for reseller partners in the SaaS space who serve mid-market companies. We offer 20% commission and full onboarding support."*
- **Domain Blacklist** — one domain or company name per line; blocks these from CSV imports and manual prospect creation

Click **Save Changes** to apply — one button saves all of the above.

### Markets

Below the General card, the **Markets** section lists every country the platform supports (~49), grouped into four collapsible regions: **Asia**, **Latin America**, **Europe** and **USA**.

- Tick the countries your team targets
- **Select all / Clear** toggles a whole region at once
- Each region header shows how many of its countries you've picked
- Click **Save Markets** (this section has its own save button)

These markets are what appear when starting a scraper run or building a Bridge seed list. **If you don't select any, New Run and Bridge will show "No markets configured" with a link back here.**

### Pipeline Tab

Customize the Kanban stage names and colors:
- Drag stages to reorder
- Edit the name inline
- Click the color chip to change the color
- Click **+ Add Stage** to create a new column
- Click the trash icon (🗑️, shown on **every** stage) to delete it

Deleting a stage is blocked while prospects are still in it — you'll see an error telling you how many need moving first. This is checked both in the browser and on the server.

### Plan & Usage Tab

Shows your current plan, billing day, seat usage (active SDRs / max), lead usage for the current billing period (imported / max), and active add-ons.

### Scraper Tab

Admin-only configuration for the scraper:
- **Apify token** and **Anthropic key / base URL / model** for this organization
- **Search strategies** — enable the combos your team will use in New Run
- **Sender profiles** — the persona used to personalise each SDR's outreach messages (display name, title, company, style, language, plus experience/seniority/expertise). **The admin configures these on behalf of each SDR; SDRs cannot edit their own profile.**

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

**Admin only.** The Scraper section in the sidebar is not visible to SDRs.

### Dashboard

Live overview: total runs, total leads, active run banner, and a recent runs list.

### New Run

New Run is a three-phase flow on a single page. The sidebar stays visible throughout, and if you navigate away mid-run and come back, the live progress is restored automatically (the state lives in the database, so it also survives closing the tab).

#### Phase 1 — Configuration

The header shows how many leads you have left in the current billing period.

1. **Market** — two steps. First pick one **region** (Asia / Latin America / Europe / USA — always all four, single-select; a run can't mix regions). Then, below it, every country your org activated in that region (Settings → Markets) appears with a checkbox, **all preselected by default** — uncheck any you want to exclude from this run, or leave them all on to search the whole region. If the org hasn't activated any country in that region yet, you'll see "No markets configured for [Region]" with a link straight to Settings. The region (not the individual countries) is what filters the SDR list below.
2. **Search Strategy** — choose one or more strategies (only the ones enabled for your org in Settings → Scraper appear).
3. **Total Leads** — presets 100–500, or use the input with the +/− buttons (steps of 10, minimum 10, maximum 500). If you ask for more than your remaining allowance, the Run button is disabled and shows the limit.
4. **Assign to SDR** — pick **exactly one** SDR. Every lead this run generates goes to them, with messages personalised from their sender profile. Only SDRs covering the selected market are listed.
5. Click **Run Scraping**.

#### Phase 2 — Progress

An animated ring shows the current stage, with a four-step bar underneath: Scraping · Scoring · Messages · Done.

| Backend status | Shown as |
|---|---|
| pending / running | Initializing… |
| scraping | 🔍 Scraping LinkedIn |
| scoring | 📊 Scoring leads |
| drafting | ✍️ Generating messages |

A run usually takes 2–5 minutes. You can close the tab — it keeps going. **Cancel run** stops it.

#### Phase 3 — Result

On success you get the total generated, a HOT / WARM / COLD breakdown, and **Assigned to: [SDR name]**, plus three actions:
- **View Detailed** — opens History with this run expanded
- **Download CSV** — exports the run's leads
- **New Run** — resets back to Phase 1

The leads are assigned to the chosen SDR automatically — no manual import step. If the run fails or is cancelled, you'll see that state instead with a **New Run** button.

### Run History

All past runs, newest first: date and time, market and strategy badges, lead count, and a status badge (Completed / Failed / Running).

Click a row to expand it:
- **Assigned to: [SDR name]** and the full grid of that run's leads (name, company, title, ICP score, temperature, and which SDR holds each lead)
- **Download CSV**
- **Send to another SDR** — pick a different SDR to **move** the run's leads to them. This reassigns the leads rather than copying, so the same lead never ends up on two people's boards.

Active runs show a **Cancel** button. A failed run shows only "This run failed. Contact support."

> There is no separate Scraper Leads page. Leads are reviewed per run in History, or in the normal Kanban / Prospects views once assigned.

---

## Bridge — Partnerships

**Admin only, and only if your organization has the Bridge add-on enabled.** If you don't see **Partnerships** in the sidebar, ask AITokenKing to enable the add-on.

Bridge is separate from the lead scraper. It finds **B2B partnership contacts** inside companies you're interested in, so you can explore partnership opportunities. It does **not** write outreach messages — it discovers candidates for you to review by hand.

### Seed Lists

A seed list defines who you're looking for. Click **+ New Seed List**:

1. **Name** — e.g. "Taiwan SaaS resellers"
2. **Channel Family** — Reseller / Referral / Technology Integration / Affiliate / Channel Distribution
3. **Sources** — you can use either or **both**:
   - **Specific companies** — paste company names, one per line or comma-separated
   - **Search criteria** — industry, company headcount (1-10, 11-50, 51-200, …) and market (the same org-specific market list as New Run)
4. **Save Seed List**

### Running a search

1. Pick a seed list from the dropdown
2. Click **Search Partnerships**
3. A progress ring and live log appear. You can leave the page — the search keeps running.
4. When it finishes you'll see "X candidates found" and the review list opens automatically

### Candidate Review

Each candidate card shows name, company, title, location, a LinkedIn link and a short bio.

**Rejecting** is one at a time: click **Reject** (red) on any pending candidate. **Restore** appears on rejected candidates and sends them back to Pending.

**Confirming is done in batches**, because confirming also generates a personalised message for each candidate:

1. Tick the checkbox on every pending candidate you want
2. An action bar appears showing how many are selected
3. Pick the **SDR** the candidates should go to (any active SDR in your org — Bridge is not restricted by market or scraper access)
4. Click **Confirm & Send Messages**
5. While it runs you'll see *"Generating personalized messages for X candidates…"*
6. On completion: *"X candidates confirmed and assigned to [SDR]."*

The messages are written using your **Bridge Context** from Settings, so fill that in first.

On a confirmed candidate, click **View message** to see the generated connection request and value message, plus which SDR it was assigned to.

Use the filter chips at the top (**All / Pending / Confirmed / Rejected**) to work through the list; each chip shows its count.

### Past Searches

The **Past Searches** tab lists previous runs with date, seed list and candidate count. Click any one to reopen its candidates in the review list.

---

## Support

For technical issues, billing questions, or feature requests:
1. Go to **Settings → Support**
2. Submit a ticket with priority and description
3. The AITokenKing team will reply in the ticket thread

Contact details: see **Settings → Account Management**.
