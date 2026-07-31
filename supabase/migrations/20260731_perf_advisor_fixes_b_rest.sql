-- ============================================================================
-- Performance Advisor fixes — batch B, part 2: every remaining table
-- ============================================================================
-- Same two fixes as the prospects migration, applied everywhere else the
-- advisor flagged (auth_rls_initplan and/or multiple_permissive_policies):
--   1. Collapse overlapping permissive policies into one policy per command.
--   2. Wrap every auth.uid()/my_role()/my_org_id() call in `(select ...)` so
--      Postgres evaluates it once per query (initPlan) instead of once per
--      row. Source: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
--   3. Add `TO authenticated` everywhere — every one of these policies
--      currently applies to `{public}` (no TO clause), meaning Postgres
--      evaluates it for anon and every internal role too.
--
-- Every USING/WITH CHECK expression below reproduces the CURRENT live
-- condition, taken verbatim from `pg_policies` (queried directly, not
-- guessed). Nothing here grants or removes access beyond what already
-- exists today, with two deliberate exceptions, both pure simplifications:
--
--   - Several tables (audit_log, conversations, notes, organizations, users)
--     have a "Global admin ... " policy whose condition is
--     `my_role() = 'admin' AND my_org_id() IS NULL` — under the live role
--     model only `admin_global` accounts have a null organization_id, and
--     they have role = 'admin_global', not 'admin'. This condition can never
--     be true for any real user (same dead pattern already found and fixed
--     on `prospects` in a separate 27/07 migration). These are dropped, not
--     replaced by anything — dropping an unreachable policy changes nothing.
--
--   - `scraper_combos_master` is left untouched: its only overlap is on
--     SELECT, where "Everyone reads combo master" is `USING (true)` — an
--     unconditional read that's already about as cheap as RLS gets. Splitting
--     admin_global's write policy off from its SELECT scope to fully
--     eliminate that overlap wasn't worth the added complexity for a qual
--     that costs nothing to evaluate.
--
-- Two things noticed while reading through this that are NOT fixed here
-- (both pre-existing, both are security/correctness questions, not
-- performance, and both change *who can do what* — not something to bundle
-- into a "make it faster" migration without a separate decision):
--   - `run_sdr_assignments`: "service role inserts run assignments" has
--     `WITH CHECK (true)` for role {public} — i.e. any authenticated
--     request can insert into this table, unrestricted. Also flagged
--     separately in the Security lints (rls_policy_always_true).
--   - `user_areas`: "user_areas: admin read" grants read to ANY admin/
--     admin_global account with no organization match at all — an org
--     admin from Org A can read Org B's area assignments through this
--     policy as written.
--
-- Run this in the Supabase SQL editor, after the prospects migration.
-- ============================================================================

-- ── areas ────────────────────────────────────────────────────────────────
-- "admin_global reads all areas" is a strict subset of "Areas readable by
-- all" (USING true) — dropping it changes nothing.
DROP POLICY IF EXISTS "admin_global reads all areas" ON public.areas;
DROP POLICY IF EXISTS "Areas readable by all" ON public.areas;
CREATE POLICY "areas_select"
  ON public.areas FOR SELECT
  TO authenticated
  USING (true);

-- ── audit_log ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated inserts audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Org admin reads own audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Global admin reads all audit log" ON public.audit_log; -- dead condition, see header
DROP POLICY IF EXISTS "admin_global reads all audit_log" ON public.audit_log;

CREATE POLICY "audit_log_select"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
  );

CREATE POLICY "audit_log_insert"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- ── bridge_candidates / bridge_runs / bridge_seed_lists ─────────────────────
-- Each had exactly one policy (no duplicate-policy overlap), just needed the
-- auth.uid() wrap. Rewritten using the existing my_org_id()/my_role() helpers
-- instead of re-inlining the same subqueries — identical condition, same
-- SELECT organization_id/role FROM users WHERE id = auth.uid() underneath.
DROP POLICY IF EXISTS "admin manages own org bridge candidates" ON public.bridge_candidates;
CREATE POLICY "bridge_candidates_all"
  ON public.bridge_candidates FOR ALL
  TO authenticated
  USING (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

DROP POLICY IF EXISTS "admin manages own org bridge runs" ON public.bridge_runs;
CREATE POLICY "bridge_runs_all"
  ON public.bridge_runs FOR ALL
  TO authenticated
  USING (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

DROP POLICY IF EXISTS "admin manages own org bridge seed lists" ON public.bridge_seed_lists;
CREATE POLICY "bridge_seed_lists_all"
  ON public.bridge_seed_lists FOR ALL
  TO authenticated
  USING (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

-- ── conversations ────────────────────────────────────────────────────────
-- NOTE: admin_global's live access here is SELECT-only (the "Global admin
-- full access" ALL policy checks role = 'admin', which admin_global never
-- has — dead, same as prospects before its 27/07 fix). Preserved exactly:
-- admin_global still only gets SELECT below, nothing added for
-- insert/update/delete. If that should change, that's a separate decision.
DROP POLICY IF EXISTS "Global admin full access on conversations" ON public.conversations; -- dead condition
DROP POLICY IF EXISTS "Org admin full access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "SDR inserts own org conversations" ON public.conversations;
DROP POLICY IF EXISTS "admin_global reads all conversations" ON public.conversations;
DROP POLICY IF EXISTS "SDR reads own org conversations" ON public.conversations;

CREATE POLICY "conversations_select"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR (
      organization_id = (select my_org_id())
      AND EXISTS (SELECT 1 FROM prospects WHERE prospects.id = conversations.prospect_id AND prospects.assigned_to = (select auth.uid()))
    )
  );

CREATE POLICY "conversations_insert"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR (
      organization_id = (select my_org_id())
      AND author_id = (select auth.uid())
      AND EXISTS (SELECT 1 FROM prospects WHERE prospects.id = conversations.prospect_id AND prospects.assigned_to = (select auth.uid()))
    )
  );

CREATE POLICY "conversations_update"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
  WITH CHECK ((select my_role()) = 'admin' AND organization_id = (select my_org_id()));

CREATE POLICY "conversations_delete"
  ON public.conversations FOR DELETE
  TO authenticated
  USING ((select my_role()) = 'admin' AND organization_id = (select my_org_id()));

-- ── demo_requests ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_global reads demo requests" ON public.demo_requests;
DROP POLICY IF EXISTS "admin_global updates demo requests" ON public.demo_requests;
CREATE POLICY "demo_requests_select"
  ON public.demo_requests FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = (select auth.uid()) AND u.role = 'admin_global'));
CREATE POLICY "demo_requests_update"
  ON public.demo_requests FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = (select auth.uid()) AND u.role = 'admin_global'));

-- ── monthly_lead_counts ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "monthly_lead_counts: admin read" ON public.monthly_lead_counts;
CREATE POLICY "monthly_lead_counts_select"
  ON public.monthly_lead_counts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u JOIN organizations o ON o.id = u.organization_id
      WHERE u.id = (select auth.uid()) AND u.role = 'admin' AND o.id = monthly_lead_counts.organization_id
    )
  );

-- ── notes ────────────────────────────────────────────────────────────────
-- Same admin_global caveat as conversations above — preserved as SELECT-only.
DROP POLICY IF EXISTS "Org admin full access on notes" ON public.notes;
DROP POLICY IF EXISTS "Global admin full access on notes" ON public.notes; -- dead condition
DROP POLICY IF EXISTS "SDR inserts own org notes" ON public.notes;
DROP POLICY IF EXISTS "SDR reads own org notes" ON public.notes;
DROP POLICY IF EXISTS "admin_global reads all notes" ON public.notes;

CREATE POLICY "notes_select"
  ON public.notes FOR SELECT
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR (
      organization_id = (select my_org_id())
      AND EXISTS (SELECT 1 FROM prospects WHERE prospects.id = notes.prospect_id AND prospects.assigned_to = (select auth.uid()))
    )
  );

CREATE POLICY "notes_insert"
  ON public.notes FOR INSERT
  TO authenticated
  WITH CHECK (
    ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR (
      organization_id = (select my_org_id())
      AND author_id = (select auth.uid())
      AND EXISTS (SELECT 1 FROM prospects WHERE prospects.id = notes.prospect_id AND prospects.assigned_to = (select auth.uid()))
    )
  );

CREATE POLICY "notes_update"
  ON public.notes FOR UPDATE
  TO authenticated
  USING ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
  WITH CHECK ((select my_role()) = 'admin' AND organization_id = (select my_org_id()));

CREATE POLICY "notes_delete"
  ON public.notes FOR DELETE
  TO authenticated
  USING ((select my_role()) = 'admin' AND organization_id = (select my_org_id()));

-- ── org_combos ───────────────────────────────────────────────────────────
-- "admin reads own org combos" had no role check at all (any org member,
-- not just admins) — preserved exactly for SELECT.
DROP POLICY IF EXISTS "admin_global full access org combos" ON public.org_combos;
DROP POLICY IF EXISTS "admin manages own org combos" ON public.org_combos;
DROP POLICY IF EXISTS "admin reads own org combos" ON public.org_combos;

CREATE POLICY "org_combos_select"
  ON public.org_combos FOR SELECT
  TO authenticated
  USING ((select my_role()) = 'admin_global' OR organization_id = (select my_org_id()));

CREATE POLICY "org_combos_insert"
  ON public.org_combos FOR INSERT
  TO authenticated
  WITH CHECK ((select my_role()) = 'admin_global' OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id())));

CREATE POLICY "org_combos_update"
  ON public.org_combos FOR UPDATE
  TO authenticated
  USING ((select my_role()) = 'admin_global' OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id())))
  WITH CHECK ((select my_role()) = 'admin_global' OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id())));

CREATE POLICY "org_combos_delete"
  ON public.org_combos FOR DELETE
  TO authenticated
  USING ((select my_role()) = 'admin_global' OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id())));

-- ── organization_addons ──────────────────────────────────────────────────
-- "admin reads own org addons" also has no role check — any org member.
DROP POLICY IF EXISTS "admin_global manages addons" ON public.organization_addons;
DROP POLICY IF EXISTS "admin reads own org addons" ON public.organization_addons;

CREATE POLICY "organization_addons_select"
  ON public.organization_addons FOR SELECT
  TO authenticated
  USING ((select my_role()) = 'admin_global' OR organization_id = (select my_org_id()));

CREATE POLICY "organization_addons_insert"
  ON public.organization_addons FOR INSERT
  TO authenticated
  WITH CHECK ((select my_role()) = 'admin_global');

CREATE POLICY "organization_addons_update"
  ON public.organization_addons FOR UPDATE
  TO authenticated
  USING ((select my_role()) = 'admin_global')
  WITH CHECK ((select my_role()) = 'admin_global');

CREATE POLICY "organization_addons_delete"
  ON public.organization_addons FOR DELETE
  TO authenticated
  USING ((select my_role()) = 'admin_global');

-- ── organization_markets ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin manages own org markets" ON public.organization_markets;
CREATE POLICY "organization_markets_all"
  ON public.organization_markets FOR ALL
  TO authenticated
  USING (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

-- ── organizations ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Org member reads own organization" ON public.organizations;
DROP POLICY IF EXISTS "Global admin reads all organizations" ON public.organizations; -- dead condition
CREATE POLICY "organizations_select"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (id = (select my_org_id()));

-- ── pipeline_stages ──────────────────────────────────────────────────────
-- "sdr reads own org pipeline_stages" has no role check — any org member —
-- and is a superset of the admin policy's SELECT scope, so it's the only
-- one needed for reads.
DROP POLICY IF EXISTS "admin full access on pipeline_stages" ON public.pipeline_stages;
DROP POLICY IF EXISTS "sdr reads own org pipeline_stages" ON public.pipeline_stages;

CREATE POLICY "pipeline_stages_select"
  ON public.pipeline_stages FOR SELECT
  TO authenticated
  USING (organization_id = (select my_org_id()));

CREATE POLICY "pipeline_stages_insert"
  ON public.pipeline_stages FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

CREATE POLICY "pipeline_stages_update"
  ON public.pipeline_stages FOR UPDATE
  TO authenticated
  USING (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']))
  WITH CHECK (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

CREATE POLICY "pipeline_stages_delete"
  ON public.pipeline_stages FOR DELETE
  TO authenticated
  USING (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

-- ── run_sdr_assignments ──────────────────────────────────────────────────
-- INSERT policy's `WITH CHECK (true)` is left exactly as-is — see the
-- security note in the header, not changed here.
DROP POLICY IF EXISTS "admin_global full access run assignments" ON public.run_sdr_assignments;
DROP POLICY IF EXISTS "admin reads own org run assignments" ON public.run_sdr_assignments;
DROP POLICY IF EXISTS "service role inserts run assignments" ON public.run_sdr_assignments;

CREATE POLICY "run_sdr_assignments_select"
  ON public.run_sdr_assignments FOR SELECT
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR EXISTS (SELECT 1 FROM runs r WHERE r.id = run_sdr_assignments.run_id AND r.organization_id = (select my_org_id()))
  );

CREATE POLICY "run_sdr_assignments_insert"
  ON public.run_sdr_assignments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "run_sdr_assignments_update"
  ON public.run_sdr_assignments FOR UPDATE
  TO authenticated
  USING ((select my_role()) = 'admin_global')
  WITH CHECK ((select my_role()) = 'admin_global');

CREATE POLICY "run_sdr_assignments_delete"
  ON public.run_sdr_assignments FOR DELETE
  TO authenticated
  USING ((select my_role()) = 'admin_global');

-- ── runs ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin manages runs" ON public.runs;
DROP POLICY IF EXISTS "admin_global full access runs" ON public.runs;
CREATE POLICY "runs_all"
  ON public.runs FOR ALL
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR (organization_id = (select my_org_id()) AND (select my_role()) = 'admin')
  );

-- ── scraper_accounts ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin manages scraper accounts" ON public.scraper_accounts;
DROP POLICY IF EXISTS "admin_global full access scraper accounts" ON public.scraper_accounts;
CREATE POLICY "scraper_accounts_all"
  ON public.scraper_accounts FOR ALL
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR (organization_id = (select my_org_id()) AND (select my_role()) = 'admin')
  );

-- ── scraper_leads ────────────────────────────────────────────────────────
-- Only one policy, no overlap — just the auth.uid() wrap.
DROP POLICY IF EXISTS "admin manages scraper leads" ON public.scraper_leads;
CREATE POLICY "scraper_leads_all"
  ON public.scraper_leads FOR ALL
  TO authenticated
  USING (organization_id = (select my_org_id()) AND (select my_role()) = ANY (ARRAY['admin', 'admin_global']));

-- ── sender_profiles ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "SDR manages own sender profiles" ON public.sender_profiles;
DROP POLICY IF EXISTS "admin_global full access sender profiles" ON public.sender_profiles;
DROP POLICY IF EXISTS "admin reads org sender profiles" ON public.sender_profiles;

CREATE POLICY "sender_profiles_select"
  ON public.sender_profiles FOR SELECT
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR user_id = (select auth.uid())
    OR (organization_id = (select my_org_id()) AND (select my_role()) = 'admin')
  );

CREATE POLICY "sender_profiles_insert"
  ON public.sender_profiles FOR INSERT
  TO authenticated
  WITH CHECK ((select my_role()) = 'admin_global' OR user_id = (select auth.uid()));

CREATE POLICY "sender_profiles_update"
  ON public.sender_profiles FOR UPDATE
  TO authenticated
  USING ((select my_role()) = 'admin_global' OR user_id = (select auth.uid()))
  WITH CHECK ((select my_role()) = 'admin_global' OR user_id = (select auth.uid()));

CREATE POLICY "sender_profiles_delete"
  ON public.sender_profiles FOR DELETE
  TO authenticated
  USING ((select my_role()) = 'admin_global' OR user_id = (select auth.uid()));

-- ── user_areas ───────────────────────────────────────────────────────────
-- "admin read" has no org match at all — see the security note in the
-- header, preserved exactly as-is.
DROP POLICY IF EXISTS "user_areas: read own" ON public.user_areas;
DROP POLICY IF EXISTS "user_areas: admin read" ON public.user_areas;
CREATE POLICY "user_areas_select"
  ON public.user_areas FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE users.id = (select auth.uid()) AND users.role = ANY (ARRAY['admin', 'admin_global']))
  );

-- ── users ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Global admin manages all users" ON public.users; -- dead condition
DROP POLICY IF EXISTS "Org admin manages own org users" ON public.users;
DROP POLICY IF EXISTS "admin_global reads all users" ON public.users;
DROP POLICY IF EXISTS "User reads own profile" ON public.users;

CREATE POLICY "users_select"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR id = (select auth.uid())
  );

CREATE POLICY "users_insert"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK ((select my_role()) = 'admin' AND organization_id = (select my_org_id()));

CREATE POLICY "users_update"
  ON public.users FOR UPDATE
  TO authenticated
  USING ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
  WITH CHECK ((select my_role()) = 'admin' AND organization_id = (select my_org_id()));

CREATE POLICY "users_delete"
  ON public.users FOR DELETE
  TO authenticated
  USING ((select my_role()) = 'admin' AND organization_id = (select my_org_id()));

-- ── vendors ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_global can manage vendors" ON public.vendors;
CREATE POLICY "vendors_all"
  ON public.vendors FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = (select auth.uid()) AND users.role = 'admin_global'));

-- ── run_logs ─────────────────────────────────────────────────────────────
-- Only one policy per command already (INSERT with_check true — a service-
-- role-style insert like run_sdr_assignments, left as-is; SELECT is a
-- single policy, no overlap) — just the auth.uid() wrap on the SELECT one.
DROP POLICY IF EXISTS "admin reads run logs" ON public.run_logs;
CREATE POLICY "run_logs_select"
  ON public.run_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runs r JOIN users u ON u.organization_id = r.organization_id
      WHERE r.id = run_logs.run_id AND u.id = (select auth.uid())
    )
  );
