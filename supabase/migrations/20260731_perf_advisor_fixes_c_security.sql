-- ============================================================================
-- Security fixes — two RLS gaps found while reading pg_policies for batch B
-- ============================================================================
-- Both were flagged to Nick and confirmed to fix. Written as a standalone
-- follow-up (not an edit to fixes_b_rest.sql) so it's safe to run whether or
-- not fixes_b_rest.sql has been applied yet — every DROP is IF EXISTS, and it
-- targets both the original policy names and the _rest.sql names.
--
-- Run this in the Supabase SQL editor, any time after (or instead of, for
-- just these two policies) fixes_b_rest.sql.
-- ============================================================================

-- ── 1. run_sdr_assignments: INSERT was WITH CHECK (true), role {public} ────
-- Any authenticated request could insert an arbitrary row here — wrong SDR,
-- wrong run, wrong org, fabricated leads_assigned — nothing was checked.
-- In practice the app never hits this path: every real write goes through
-- assignRunLeads() (src/lib/utils/run-assign.ts) using the service-role
-- admin client, which bypasses RLS entirely — so tightening this closes a
-- real hole without changing any app behavior. New condition mirrors the
-- SELECT policy: admin_global always, or an admin acting on a run inside
-- their own org.
DROP POLICY IF EXISTS "service role inserts run assignments" ON public.run_sdr_assignments;
DROP POLICY IF EXISTS "run_sdr_assignments_insert" ON public.run_sdr_assignments;

CREATE POLICY "run_sdr_assignments_insert"
  ON public.run_sdr_assignments FOR INSERT
  TO authenticated
  WITH CHECK (
    (select my_role()) = 'admin_global'
    OR (
      (select my_role()) = 'admin'
      AND EXISTS (
        SELECT 1 FROM runs r
        WHERE r.id = run_sdr_assignments.run_id
        AND r.organization_id = (select my_org_id())
      )
    )
  );

-- ── 2. user_areas: admin read had no organization scoping at all ──────────
-- Any admin/admin_global account could read EVERY org's user_areas rows —
-- an org admin from Org A could see Org B's SDR-to-area assignments.
-- Fixed to: admin_global keeps global visibility (intended), a plain admin
-- is now scoped to rows belonging to users in their own organization.
DROP POLICY IF EXISTS "user_areas: admin read" ON public.user_areas;
DROP POLICY IF EXISTS "user_areas_select" ON public.user_areas;
DROP POLICY IF EXISTS "user_areas: read own" ON public.user_areas;

CREATE POLICY "user_areas_select"
  ON public.user_areas FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    OR (select my_role()) = 'admin_global'
    OR (
      (select my_role()) = 'admin'
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = user_areas.user_id
        AND u.organization_id = (select my_org_id())
      )
    )
  );
