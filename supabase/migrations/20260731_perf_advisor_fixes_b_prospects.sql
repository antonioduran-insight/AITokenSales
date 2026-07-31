-- ============================================================================
-- Performance Advisor fixes — batch B, part 1: prospects RLS consolidation
-- ============================================================================
-- prospects is the single biggest lever in the whole performance pass: one
-- query shape against this table (the Kanban/Prospects/Dashboard "select
-- prospects.*, area, assigned_user" pattern) accounts for ~98% of all
-- database time recorded (1.53M calls, 84.4% of total time as `authenticated`
-- alone). Every one of those calls paid RLS evaluation on this table row by
-- row. This migration does NOT change who can see or write what — every
-- USING/WITH CHECK expression below is copy-pasted from the policies
-- documented as currently live in 20260727_document_prospects_rls.sql and
-- 20260727_fix_prospects_admin_global_rls.sql, just reorganized and
-- optimized. Two independent fixes, stacked:
--
-- 1. Five overlapping policies -> four single-purpose ones (one per command).
--    Before, a SELECT had to evaluate 4 separate permissive policies and OR
--    the results; now it evaluates exactly 1. See the mapping below.
--
-- 2. Every auth.uid()/my_role()/my_org_id() call wrapped in `(select ...)`.
--    Per Supabase's own RLS performance guide, this forces the planner to
--    treat the call as an initPlan — evaluated ONCE per query instead of
--    once per row. Their own benchmark on this exact pattern (a
--    SECURITY DEFINER helper function with no row-dependent arguments,
--    which is exactly what my_role()/my_org_id() are) measured 178,000ms ->
--    12ms on a 100K-row table. See:
--    https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
--
-- Also adds `TO authenticated` to every policy — currently they apply to
-- PUBLIC (no TO clause), meaning Postgres evaluates them for anon and every
-- internal role too. Scoping to authenticated makes Postgres reject an
-- unauthenticated request at the role check, before it even reaches the
-- policy expression — cheaper, and this may also explain the 168,019
-- `anon`-role calls to this same query seen in Query Performance Statements
-- (a request with no valid session still runs and gets evaluated today; once
-- scoped to `authenticated` it's rejected immediately instead).
--
-- ── Mapping (old policy -> which new policy replaces it) ────────────────────
--   Global admin full access on prospects (FOR ALL)        -> select/insert/update/delete
--   Org admin full access on prospects     (FOR ALL)        -> select/insert/update/delete
--   SDR selects own org prospects          (FOR SELECT)     -> select
--   SDR updates own org prospects          (FOR UPDATE)     -> update
--   admin_global reads all prospects       (FOR SELECT)     -> select (now
--     redundant with "Global admin full access" after the 27/07 fix that
--     corrected its condition to my_role() = 'admin_global' — dropped, not
--     replaced by anything new, its access is already covered)
--
-- Run this in the Supabase SQL editor, AFTER batch A.
-- ============================================================================

DROP POLICY IF EXISTS "Global admin full access on prospects" ON public.prospects;
DROP POLICY IF EXISTS "Org admin full access on prospects" ON public.prospects;
DROP POLICY IF EXISTS "SDR selects own org prospects" ON public.prospects;
DROP POLICY IF EXISTS "SDR updates own org prospects" ON public.prospects;
DROP POLICY IF EXISTS "admin_global reads all prospects" ON public.prospects;

CREATE POLICY "prospects_select"
  ON public.prospects FOR SELECT
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR (assigned_to = (select auth.uid()) AND organization_id = (select my_org_id()))
  );

CREATE POLICY "prospects_insert"
  ON public.prospects FOR INSERT
  TO authenticated
  WITH CHECK (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
  );

CREATE POLICY "prospects_update"
  ON public.prospects FOR UPDATE
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR (assigned_to = (select auth.uid()) AND organization_id = (select my_org_id()))
  )
  WITH CHECK (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
    OR (assigned_to = (select auth.uid()) AND organization_id = (select my_org_id()))
  );

CREATE POLICY "prospects_delete"
  ON public.prospects FOR DELETE
  TO authenticated
  USING (
    (select my_role()) = 'admin_global'
    OR ((select my_role()) = 'admin' AND organization_id = (select my_org_id()))
  );
