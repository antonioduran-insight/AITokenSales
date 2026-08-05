-- Atomic organization deletion.
--
-- THE BUG THIS REPLACES
-- ---------------------
-- `DELETE /api/global-admin/organizations/[id]` deleted fifteen tables as
-- fifteen separate HTTP calls and then deleted the organization last. Two
-- things went wrong with that:
--
--   1. It never deleted `prospects`, `audit_log`, `conversations`, `notes`,
--      `areas` or `csv_import_sessions` — all of which reference
--      `organizations` with ON DELETE NO ACTION. Any org with a single lead
--      failed on the final statement with
--      "violates foreign key constraint prospects_organization_id_fkey".
--
--   2. Far worse: the failure came AFTER users and their auth accounts had
--      already been deleted. A failed deletion therefore left a half-destroyed
--      organization — leads intact, nobody able to log in and reach them. The
--      operation reported an error, but the damage was already done and there
--      was nothing to roll back to.
--
-- Separate HTTP calls can never be atomic. A function can: everything below
-- runs in one transaction, so it either all happens or none of it does.
--
-- WHAT IS NOT HERE
-- ----------------
-- Auth accounts (`auth.users`). Those are removed by the Supabase Auth admin
-- API, which cannot participate in this transaction. The route calls it AFTER
-- this function returns successfully — deliberately in that order, because a
-- surviving auth account for a deleted org is a harmless orphan, while a
-- deleted auth account for an org that still exists is the exact failure this
-- migration exists to prevent.
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically.

CREATE OR REPLACE FUNCTION public.delete_organization(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Order is dictated by the FK graph, verified against production 05/08/2026.
  -- Only NO ACTION edges need explicit deletes; CASCADE edges (bridge_*,
  -- org_combos, monthly_lead_counts, organization_addons, organization_markets,
  -- pipeline_stages, scraper_accounts, sender_profiles, support_tickets,
  -- workspaces, addon_audit_log, user_areas) clear themselves.

  -- 1. audit_log blocks TWICE: on organization_id and on prospect_id, both
  --    NO ACTION. The second delete catches rows whose org column is null or
  --    stale but that still point at a lead about to disappear.
  DELETE FROM audit_log WHERE organization_id = p_org_id;
  DELETE FROM audit_log
   WHERE prospect_id IN (SELECT id FROM prospects WHERE organization_id = p_org_id);

  -- 2. conversations/notes cascade FROM prospects, but their own
  --    organization_id is NO ACTION, so a row belonging to the org while
  --    pointing at no prospect would survive and block. Clear both ways.
  DELETE FROM conversations WHERE organization_id = p_org_id;
  DELETE FROM notes         WHERE organization_id = p_org_id;

  -- 3. The leads themselves.
  DELETE FROM prospects WHERE organization_id = p_org_id;

  -- 4. scraper_leads cascade from `runs`, but only those that HAVE a run_id;
  --    their own organization_id is NO ACTION. Delete by org first so an
  --    orphaned lead can't hold the whole thing up.
  DELETE FROM scraper_leads WHERE organization_id = p_org_id;
  DELETE FROM runs          WHERE organization_id = p_org_id;

  -- 5. References areas AND users, so it goes before both.
  DELETE FROM csv_import_sessions WHERE organization_id = p_org_id;

  -- 6. users.area_id is NO ACTION, so people must go before areas.
  DELETE FROM users WHERE organization_id = p_org_id;

  -- 7. Now nothing points at areas any more.
  DELETE FROM areas WHERE organization_id = p_org_id;

  -- 8. And finally the org, whose CASCADE edges take the rest.
  DELETE FROM organizations WHERE id = p_org_id;
END;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, which would
-- expose "delete any organization" to every anon and logged-in user through
-- PostgREST's /rpc endpoint. Lock it to the service role, which only server
-- code holds — the route already verifies admin_global before calling.
REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_organization(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_organization(uuid) TO service_role;

-- Verify — the first must return one row, the rest must return nothing:
--
--   SELECT proname FROM pg_proc WHERE proname = 'delete_organization';
--
--   SELECT grantee FROM information_schema.role_routine_grants
--   WHERE routine_name = 'delete_organization' AND grantee IN ('PUBLIC','anon','authenticated');
