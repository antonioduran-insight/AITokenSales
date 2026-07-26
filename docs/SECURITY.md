# AITokenSales — Security Documentation

Documentation for the cybersecurity team covering the security architecture, trust boundaries, authentication model, data isolation mechanisms, and known considerations.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Authentication & Session Management](#authentication--session-management)
- [Authorization Model](#authorization-model)
- [Data Isolation (Multi-tenancy)](#data-isolation-multi-tenancy)
- [API Security](#api-security)
- [Secret Management](#secret-management)
- [Input Validation & Injection](#input-validation--injection)
- [Client-Side Security](#client-side-security)
- [Supabase Storage](#supabase-storage)
- [Impersonation Feature](#impersonation-feature)
- [Audit Trail](#audit-trail)
- [Known Limitations & Accepted Risks](#known-limitations--accepted-risks)
- [Security Checklist](#security-checklist)

---

## Architecture Overview

```
Browser
  │
  ├─── Next.js Frontend (Vercel)
  │      ├─ src/app/[locale]/**         (React Server Components + Client Components)
  │      ├─ src/middleware.ts           (Auth gate on every request)
  │      └─ src/app/api/**             (API route handlers — server-only)
  │
  ├─── Supabase (managed PostgreSQL + Auth + Storage)
  │      ├─ public.users               (user profiles, roles, org scoping)
  │      ├─ public.prospects + others  (business data, RLS enforced)
  │      ├─ auth.users                 (email/password credentials, JWTs)
  │      └─ storage: logos bucket      (public org logos)
  │
  └─── Python Scraper + Bridge Backend (external service, Railway)
         ├─ /api/runs**      purpose-built scraper routes (session + admin,
         │                   org-scoped per query)
         └─ /api/bridge/**   authenticated proxy: session + admin role +
                             add-on check, injects organization_id server-side
```

**Trust boundary**: The Next.js API layer is the security enforcement boundary. The browser has the Supabase anon key (safe, limited by RLS) and never has the service role key.

---

## Authentication & Session Management

### Mechanism

- **Supabase Auth** — email/password authentication. JWTs are issued by Supabase and stored as **httpOnly cookies** via `@supabase/ssr`.
- Cookie-based sessions are validated server-side on every request in `src/middleware.ts` using `supabase.auth.getUser()`.
- Unauthenticated requests to any non-public path are **redirected to `/login`** — no 401 JSON responses, no content served.

### Public pages

Only `/[locale]/login` is publicly accessible. Every other route requires a valid Supabase session.

### Session cookies

`@supabase/ssr` sets the session as httpOnly, Secure, SameSite=Lax cookies. The session token itself is a Supabase JWT signed with the project's JWT secret.

### Additional cookies set by middleware

The middleware sets two non-sensitive informational cookies on each request:
- `user_role` — the user's role string (`admin`, `sdr`, `admin_global`)
- `user_org_id` — the user's organization UUID

These are **not used for security decisions** in API routes (which re-verify from DB). They are used only for UI rendering decisions in client components. Tampering with these cookies would only affect UI display, not data access — all data access goes through RLS or server-side role checks.

### Password policy

No custom password policy is enforced at the application layer. Password complexity and account lockout policies must be configured in the Supabase project settings under **Authentication → Providers → Email**.

---

## Authorization Model

### Role hierarchy

| Role | Stored in | Scope | Trust Level |
|---|---|---|---|
| `admin_global` | `public.users.role` | All organizations | Highest — full system access |
| `admin` | `public.users.role` | Own organization | High — all data within org, plus Scraper and Bridge |
| `sdr` | `public.users.role` | Own area within org | Limited — own area's prospects only. **No Scraper or Bridge access.** |
| `support` | `public.users.role` | TBD | Limited |

Scraper and Bridge are **admin-only**. `POST /api/runs` and every `/api/bridge/*` call reject non-`admin` callers with 403. The old per-user `scraper_access` flag has been retired: the column still exists on `public.users` but no code path reads it, so it can no longer grant access.

### How authorization is enforced

Authorization is enforced at **two independent layers**:

#### Layer 1 — Supabase Row Level Security (RLS)

RLS policies on every table enforce data isolation at the database level. Even if application code has a bug, the database enforces the rules.

Key policies:
```sql
-- Prospects: SDR sees own area; admin sees all in own org
CREATE POLICY "prospects_read" ON prospects FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.organization_id = prospects.organization_id)
    OR (area_id IN (SELECT area_id FROM users WHERE id = auth.uid()))
  );
```

#### Layer 2 — API route server-side checks

Every API route that performs privileged operations validates the caller's role from the database before acting:

```typescript
// Pattern used in all global-admin routes
async function verifyGlobalAdmin() {
  const supabase = createServerClient(...)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  return profile?.role === 'admin_global' ? user : null
}
```

The role is **always read from the database** in API routes — never trusted from cookies or request headers.

#### Layer 3 — route-level SSR gate for admin-only pages (FUNC-F12)

Layers 1 and 2 stop data from leaking, but they don't stop an admin-only *page* from mounting for an SDR — RLS just makes its queries come back empty, so the page renders an empty shell instead of returning a clean 404/redirect. That's a fragile third state: a future component on that page doing a service-role fetch or an aggregate count wouldn't be caught by RLS at all, and would leak silently. `blockSdrAccess(locale)` (`src/lib/utils/route-guard.ts`) closes this: an SSR check at the top of the page's server component, before anything renders, that redirects the `sdr` role to `/kanban` — the same pattern `GlobalAdminLayout` already used for `admin_global`-only pages. Applied to every admin-only page: `/admin/users`, `/audit`, `/history`, `/bridge`, `(scraper)/dashboard`, `(scraper)/run`, and `(scraper)/export`.

#### Layered defense summary

| Attack vector | Layer 1 (RLS) | Layer 2 (API check) | Layer 3 (route gate) |
|---|---|---|---|
| Direct Supabase anon key abuse | ✓ blocks | N/A | N/A |
| Forged `user_role` cookie | N/A | ✓ ignores cookie, checks DB | N/A |
| IDOR on API route | N/A | ✓ verifies session + role | N/A |
| SDR querying another area | ✓ blocks | ✓ area scoped queries | N/A |
| SDR directly navigating to an admin-only page | ✓ blocks (empty result set) | N/A | ✓ blocks (page never renders) |

---

## Data Isolation (Multi-tenancy)

### Organization isolation

Every organization's data is scoped via `organization_id` columns and RLS policies. An admin in Org A **cannot** see Org B's data through any application path.

### Area isolation within an org

Within a single org, SDRs are further isolated to their assigned `area_id`. An SDR assigned to the Taiwan area cannot read LATAM prospects, even via direct Supabase queries.

### Cross-tenant uniqueness

`prospects` is unique on `(organization_id, linkedin_url, assigned_to)`. This means:
1. Within one org, a LinkedIn profile exists at most once per SDR — the same lead can be deliberately moved or held by more than one rep without a constraint error
2. Uniqueness is scoped **per organization**, so one org's data no longer influences another's imports
3. Conflicts raise `23505`, which is handled row-by-row — a single conflict never aborts a batch, and the error never reveals another org's data

### Lead counting

Two independent mechanisms, both scoped to `organization_id`, neither exposing cross-org data:
- `monthly_lead_counts` — cached calendar-month totals for reporting
- **Billing-period quota** — counts `scraper_leads` with `exported_to_crm = true` inside the org's current `billing_day` window (`src/lib/utils/lead-quota.ts`). This is what gates run creation.

### Add-on gating

Feature add-ons (currently `bridge`) are enforced at two layers, mirroring the role model:
- **UI**: the sidebar entry only renders when `/api/settings/addons` reports the add-on active
- **API**: `/api/bridge/[...path]` independently re-queries `organization_addons` on every request

The UI check is a convenience only. Removing it client-side does not grant access.

---

## API Security

### Service role key usage

The Supabase service role key (`SUPABASE_SERVICE_ROLE_KEY`) bypasses all RLS policies. It is:
- **Only used** in `src/app/api/` route handlers (server-side, never sent to browser)
- **Never** imported in client components (`'use client'`) or server components
- **Never** in `next.config.*`, `src/lib/supabase/client.ts`, or any file that could be bundled for the browser

Verify: run `grep -r "SERVICE_ROLE" src/` — results should only be in `src/app/api/` files.

### Backend proxies

The Python backend (`SCRAPER_API_URL`) is never called directly from the browser.

**There is no generic passthrough proxy.** A catch-all `/api/scraper/[...path]` route used to forward any method, path, query and body to the backend with no session, role or org check. It has been **deleted** — it had no consumers in the application, so removing it eliminated the exposure outright rather than patching it.

Backend access is now limited to:

| Route | Auth | Notes |
|---|---|---|
| `/api/runs`, `/api/runs/[id]*` | Session + `admin` role | Purpose-built; each query is explicitly scoped to the caller's `organization_id` |
| `/api/scraper/to-crm` | Session + role check | Imports scraped leads into `prospects` |
| `/api/bridge/[...path]` | Session + `admin` role + active `bridge` add-on | The only remaining proxy; injects `apify_token` on `POST /bridge/runs` |

The Bridge proxy is the reference pattern for any new backend-facing route:

1. Resolves the session via `supabase.auth.getUser()`
2. Reads the caller's role and `organization_id` **from the database**
3. Rejects non-`admin` callers (403) — SDRs cannot reach the backend at all
4. Route-specific gate (Bridge: the add-on must be active for that org)
5. **Overwrites** `organization_id` in both the query string and the JSON body with the value from the session — a client-supplied value is always discarded
6. Injects org credentials from the DB where the backend needs them (`apify_token` on `POST /bridge/runs`), so they never reach the browser

Because step 5 overwrites rather than validates, an authenticated admin of Org A cannot read or mutate Org B's seed lists, runs or candidates through this route. The purpose-built `/api/runs/[id]*` routes achieve the same by verifying the run's `organization_id` matches the caller's before returning anything.

Per-org third-party credentials (Apify token, Anthropic key) live on the `organizations` row and are only ever read server-side in API routes.

### Backend authentication

Every outbound call to the Python backend carries `X-Internal-Api-Key`, a shared secret from the server-only `INTERNAL_API_KEY` env var. All three call sites (`POST /runs`, the best-effort `DELETE /runs/{id}` cancel, and the whole Bridge proxy) go through `backendHeaders()` in `src/lib/scraper-backend.ts`, so a new call site cannot silently omit it.

When the variable is unset the header is **omitted** rather than sent as the string `"undefined"` — a misconfigured deploy is then rejected by the backend instead of appearing to authenticate. This is defence in depth: the CRM already authenticates and org-scopes the caller before forwarding, and the key stops anything that is not the CRM from reaching the backend directly.

The same secret is also checked in the **reverse** direction on `POST /api/runs/[id]/complete` (see below) — the backend, or a Supabase Database Webhook, presents `X-Internal-Api-Key` to prove it's an authorized caller of the CRM, not the other way around. Reusing one shared secret both ways means no second value has to be provisioned or rotated separately; either side leaking it has the same blast radius either way (backend↔CRM trust), so this isn't a meaningfully weaker posture than two secrets would be.

### Run-completion webhook authentication

`POST /api/runs/[id]/complete` is the primary trigger for auto-assign — the scraper backend (or a Supabase Database Webhook on `runs` for `status` → `completed`) calls it the instant a run finishes, instead of relying on a browser tab to notice via polling. Like the cron below, it's authenticated by a **shared secret instead of a session** (`X-Internal-Api-Key` must equal `INTERNAL_API_KEY`) and fails closed if the env var is unset. It never trusts anything from the request body — the SDR, org and markets are all re-resolved server-side from that run's own `run_sdr_assignments` row, and it only acts when that row is unambiguous (exactly one), so a caller in possession of the secret can't use this route to redirect leads to an arbitrary SDR — the recipient was already fixed at run-creation time.

### Cron authentication

`GET /api/cron/reconcile-runs` is a **backstop** for whatever the webhook above and the client-side path both miss — same shared-secret pattern, but via `Authorization: Bearer $CRON_SECRET` (Vercel adds this header automatically when the `CRON_SECRET` env var is configured on the project), and it has no human caller — Vercel Cron invokes it directly. It rejects the request outright if the env var is unset, so a missing secret fails closed rather than open. It uses the service-role client and operates **across every organization** by design (it has no single caller to scope to) — anyone who obtains `CRON_SECRET` could trigger it manually, but the route only ever assigns already-scraped leads to the SDR already recorded on that run's own `run_sdr_assignments` row; it cannot be used to exfiltrate data, change ownership arbitrarily, or write anything not already implied by existing DB state.

### Conversation-count scoping

`GET /api/conversations/counts` (used by the "Missing conversation" badge on Kanban/Leads and by Closed Deals) previously had **no auth check at all** — it took a raw `ids` list and returned counts straight from the service-role client. Anyone who could guess or observe a prospect UUID from any org could probe its conversation count (not the content, just an integer). Fixed to require a session, resolve the caller's `organization_id` (or, for `admin_global`, an explicitly passed `impersonate_org_id`), and scope the count query through `prospects` — not through `conversations.organization_id` directly, since that column isn't guaranteed populated on every historical row (same caveat as `/api/crm/[table]`'s handling of `conversations`/`notes`).

### CORS

Next.js API routes do not set permissive CORS headers by default. Cross-origin requests from unauthorized domains cannot call these endpoints with cookies.

### Rate limiting

No application-level rate limiting is currently implemented. Rate limiting should be configured at the Vercel edge or Supabase Auth level (Supabase has built-in rate limiting on auth endpoints).

---

## Secret Management

### Environment variables

| Variable | Exposure | Used where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (browser) | Client + Server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (browser) | Client + Server |
| `SUPABASE_SERVICE_ROLE_KEY` | **Private** (server only) | API routes only |
| `NEXT_PUBLIC_APP_URL` | Public | Redirects |
| `SCRAPER_API_URL` | Private (server) | Scraper / Bridge backend base URL |
| `INTERNAL_API_KEY` | **Private** (server only) | Sent as `X-Internal-Api-Key` on every backend call; also checked in reverse on `POST /api/runs/[id]/complete` |
| `CRON_SECRET` | **Private** (server only) | Authorizes `GET /api/cron/reconcile-runs`; Vercel sends it automatically as `Authorization: Bearer $CRON_SECRET` |

`NEXT_PUBLIC_*` variables are bundled into the client JS. All others are server-only. Never add sensitive values to `NEXT_PUBLIC_*` variables.

### Vercel deployment

Secrets are stored as Vercel environment variables. The service role key must be set as a **Server-only** (non-public) variable in Vercel project settings.

---

## Input Validation & Injection

### SQL injection

Not applicable — the application never constructs raw SQL strings. All database operations use the Supabase JS client with parameterized queries. The Supabase PostgREST API is inherently parameterized.

### XSS

- **React's JSX** auto-escapes all string values rendered to the DOM. No `dangerouslySetInnerHTML` is used in this codebase.
- User-provided strings (prospect names, notes, chat content) are rendered as React text nodes — not as HTML.
- Exception: `logo_url` is rendered in an `<img src={...}>` tag. This is an open redirect / SSRF vector if the URL is attacker-controlled — see [Known Limitations](#known-limitations--accepted-risks).

### CSV injection

CSV files are parsed by `papaparse` and the resulting data is treated as plain strings. Values are never passed to `eval`, shell commands, or formula engines. Spreadsheet formula injection (cells starting with `=`, `+`, `-`, `@`) is not a risk in this context since the data goes into a database, not back to a CSV/spreadsheet without sanitization.

### SSRF via logo URL

Logo URLs are stored in the `organization.logo_url` column and rendered with `<img src={...}>`. A malicious `admin_global` could set this to an internal URL. This is acceptable since only `admin_global` can set org-level logo URLs via the Global Admin panel — it's an internal trust issue, not an external attack surface. For the Settings upload flow, the URL is always a Supabase Storage public URL (no user-controlled path).

### Path traversal (Supabase Storage)

Logo uploads use the path `{org_id}/logo.{ext}` where `org_id` is the UUID from the database (not user-controlled input). File extension is extracted from `file.name` — only the extension is used, not the full filename. Accepted types are restricted to image MIME types on the client side.

---

## Client-Side Security

### Role cookies

`user_role` and `user_org_id` cookies are set by the middleware and read by client components for **UI rendering only** (which nav items to show, whether to display admin controls). All actual data access goes through Supabase (where RLS applies) or API routes (where DB role check applies). Modifying these cookies does not grant data access.

### Impersonation state

Impersonation is conveyed by URL query parameters (`?impersonate_org_id=...`), not by any elevated session. The impersonation proxy route (`/api/crm/[table]`) uses the service role key to read the target org's data but:
1. Verifies the caller is `admin_global` first
2. Exposes only read endpoints (GET)
3. All CRM write operations short-circuit with `isImpersonating` guard client-side, AND the underlying APIs also verify the session for writes

---

## Supabase Storage

The `logos` bucket is **public** — any URL from this bucket is accessible without authentication. This is by design, as org logos are meant to be displayed in login pages and public-facing contexts.

**What's stored**: Organization logo images only. No user data, no conversation content, no CSV files.

**Upload access**: The anon key is used for uploads (Supabase Storage policies must allow authenticated uploads to the `logos` bucket). Downloads are public.

**Recommended Supabase Storage policy**:
```sql
-- Allow authenticated users to upload to their org's folder
CREATE POLICY "org_logo_upload" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'logos');

-- Allow public reads
CREATE POLICY "org_logo_read" ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'logos');
```

---

## Impersonation Feature

The Global Admin impersonation mode allows `admin_global` users to view any org's CRM as that org's admin.

### Security properties

- **Read-only**: All write operations are blocked client-side via `isImpersonating` guard from `useOrgId()`. Client components check this before any mutation.
- **Server-side validation**: The `/api/crm/[table]` proxy verifies the caller is `admin_global` before returning any data.
- **No session elevation**: The `admin_global` does not receive a session for the target org. They access data via their own `admin_global` session, which the proxy route uses with a service-role call.
- **Visible indicator**: A yellow banner is always displayed during impersonation. There is no way to enter impersonation without the banner showing (the banner reads from the URL param which is required for data to load).
- **Audit trail**: Impersonation sessions are not explicitly logged, but all actions performed in the impersonated context are read-only, so no audit entries are created under wrong org context.

### Potential misuse

A compromised `admin_global` account has full read access to all organizations' data via impersonation. Protect `admin_global` accounts with:
- Strong passwords
- MFA (configured in Supabase Auth settings)
- Minimal number of `admin_global` accounts

---

## Audit Trail

`audit_log` provides an immutable record of significant actions. Properties:

- **Append-only**: No DELETE or UPDATE operations on `audit_log` exist in the application code
- **Actor identification**: Every entry records `actor_id` (UUID) and `actor_name` (full name at time of action)
- **Prospect FK**: When a prospect is deleted, `prospect_id` is set to NULL (FK ON DELETE SET NULL) but `prospect_name` is retained in the row — the action history is never lost
- **Metadata**: Rich JSONB metadata per event type (e.g., `from_status`, `to_status` for status changes; `count` and `duplicates` for imports)
- **RLS**: Only `admin` role can SELECT from `audit_log`; any authenticated user can INSERT (clients call `logAuditEvent()` helper from browser)

**Gap**: Audit log INSERTs come from browser-side `logAuditEvent()` calls, meaning a determined user could skip calling this helper. Server-side audit logging for critical operations (bulk delete, bulk reassign) is done via API routes. For lower-risk operations (status changes, notes), the audit write is client-side.

---

## Known Limitations & Accepted Risks

| Item | Risk level | Notes |
|---|---|---|
| Backend trusts the injected `organization_id` | Medium | The Bridge proxy guarantees the value is server-derived, but the Python backend must scope its queries by it. If the backend ignores `organization_id`, cross-org exposure is possible despite a correct proxy. **Verify on the backend side.** |
| No MFA enforcement at app layer | Medium | Must be enforced in Supabase Auth project settings |
| No rate limiting on import API | Low | Supabase's auth rate limits apply; large imports are bounded by file size limit (5 MB) |
| Client-side audit for some events | Low | Status changes and notes are audit-logged from the browser. A motivated user could skip the call. |
| `logo_url` open redirect potential | Low | Only writable by `admin_global` — internal trust issue, not external attack surface. Storage upload flow mitigates for normal usage. |
| No CSP header | Low | No `Content-Security-Policy` header is configured. Vercel security headers config can address this. |
| SDR `is_active` checked by RLS? | **Verify** | The `is_active` flag on `public.users` must be included in RLS policies to block deactivated SDRs at the DB level, not just at the auth level. Confirm this is enforced. |
| Scraper backend authentication | **Verify** | Confirm `SCRAPER_API_KEY` is validated by the Python scraper backend and that the proxy always passes it. |

---

## Security Checklist

### Deployment checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` set as server-only in Vercel (not prefixed with `NEXT_PUBLIC_`)
- [ ] `SCRAPER_API_KEY` set as server-only in Vercel
- [ ] Supabase project has email confirmation enabled for new users
- [ ] Supabase Auth rate limiting configured
- [ ] MFA available (and enforced for `admin_global` accounts)
- [ ] Supabase Storage `logos` bucket exists with correct policies
- [ ] RLS enabled on all tables (verify in Supabase Dashboard → Table Editor → RLS column)
- [ ] No `admin_global` account uses a weak or shared password

### Code review checklist

- [ ] No `SERVICE_ROLE_KEY` in client-side files (`'use client'` or `src/lib/supabase/client.ts`)
- [ ] Every new API route calls a session/role verification function before touching data
- [ ] No `dangerouslySetInnerHTML` added
- [ ] New Supabase queries on `prospects` do NOT filter or join on `organization_id` (column doesn't exist)
- [ ] New forms with user input use controlled React state (not `innerHTML` or `eval`)
- [ ] Any new write operation checks `isImpersonating` and returns early if true
- [ ] Any new backend proxy derives `organization_id` from the session and **overwrites** any client-supplied value
- [ ] Add-on-gated or role-gated features are enforced server-side, not only hidden in the UI
- [ ] Third-party credentials (Apify / Anthropic) are read from the DB server-side and never returned to the browser

### Penetration testing targets

Priority areas for security testing:

1. **Cross-org data leakage** — authenticated as Org B, attempt to read Org A prospects via:
   - Direct Supabase anon key queries
   - API endpoints with manipulated body params
   - URL manipulation in impersonation mode

2. **Privilege escalation** — authenticated as `sdr`, attempt to:
   - Call `admin`-only API routes (bulk delete, user management)
   - Call `admin_global` routes (create org, edit org)
   - Access `/admin/users`, `/audit`, `/stats` pages
   - Start a scraper run via `POST /api/runs` (expect 403)
   - Reach Bridge via `/api/bridge/seed-lists` (expect 403)

2b. **Add-on bypass** — as an `admin` of an org **without** the `bridge` add-on:
   - Navigate directly to `/{locale}/bridge`
   - Call any `/api/bridge/*` endpoint (expect 403)
   - Pass another org's `organization_id` in the query or body and confirm it is ignored

2c. **Backend access** — for `/api/bridge/*` and `/api/runs/*`:
   - Call with no session (expect 401)
   - Call as `sdr` (expect 403)
   - As an admin of Org A, request `/api/runs/<org-B-run-id>` and `/api/runs/<org-B-run-id>/logs` (expect 404, identical to a non-existent id)
   - On Bridge, pass `?organization_id=<org-B>` and a body `organization_id` and confirm both are overwritten with the caller's org
   - Confirm no catch-all proxy has been reintroduced: `/api/scraper/<anything>` should 404 except the explicit `to-crm` route

3. **RLS bypass** — using the anon key directly (bypassing the Next.js layer), verify no data is accessible beyond the user's scope

4. **Impersonation abuse** — as a regular `admin`, attempt to pass `?impersonate_org_id=` on requests and access `/api/crm/[table]`

5. **File upload** — upload non-image files to the logo endpoint, attempt path traversal in filename, attempt to upload oversized files
