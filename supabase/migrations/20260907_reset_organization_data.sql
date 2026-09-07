-- ============================================================
-- Wipe an organization's DATA, keep its SETUP.
--
-- RUN THIS BY HAND IN THE SUPABASE SQL EDITOR. Safe to run more than once.
--
-- WHY THIS IS NOT `delete_organization`
-- -------------------------------------
-- A demo account is reused: you show it to one prospect today and another one
-- next week. Deleting the organization and building it again means redoing the
-- plan, the limits, the markets, the combos, the Apify and model credentials,
-- the areas and the users — several minutes of setup, every time, with a chance
-- of getting one of them wrong before a sales call.
--
-- So this deletes what a demo GENERATES and keeps what a demo IS:
--
--   Deleted   leads, scraped leads, runs and their logs, conversations, notes,
--             the audit trail, CSV import sessions, every Bridge seed list /
--             run / candidate, support tickets, and the monthly lead counters.
--
--   Kept      the organization row and every setting on it, users (and their
--             logins), areas, sender profiles, add-ons, markets, combos —
--             including the org's own custom ones — pipeline stages,
--             workspaces, and addon_audit_log, which is our billing record and
--             not the customer's data.
--
-- KEEPING THE USERS IS ALSO WHAT MAKES THIS SAFE TO DO IN SQL. Deleting people
-- means deleting `auth.users`, which lives outside this transaction and cannot
-- be rolled back with it — the exact split that left `testorg` half-destroyed
-- in August. Nothing here touches auth at all. To remove a test SDR, delete
-- them from Users in the CRM, which handles the auth account through the API.
--
-- THE QUOTA RESETS TOO, and that is deliberate: `getLeadQuota()` counts
-- `scraper_leads` with `exported_to_crm = true` inside the billing period, so
-- removing them gives the account its full allowance back. A demo that runs out
-- of leads halfway through the second demo is worse than useless.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_organization_data(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_prospects     int := 0;
  n_scraper_leads int := 0;
  n_runs          int := 0;
  n_conversations int := 0;
  n_notes         int := 0;
  n_audit         int := 0;
  n_bridge        int := 0;
  n_tickets       int := 0;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'reset_organization_data requires an organization id';
  END IF;

  -- Order follows the FK graph documented in 20260805_delete_organization_fn.sql,
  -- which was verified against production. The edges that matter here are the
  -- NO ACTION ones pointing AT prospects: audit_log.prospect_id,
  -- conversations.prospect_id and notes.prospect_id all block the delete of a
  -- lead, so they go first.

  -- 1. Audit trail. Twice, for the same reason as the delete function: rows
  --    reach it either by organization_id or by prospect_id, and a row with a
  --    null/stale org column still blocks the lead it points at.
  DELETE FROM audit_log WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_audit = ROW_COUNT;
  DELETE FROM audit_log
   WHERE prospect_id IN (SELECT id FROM prospects WHERE organization_id = p_org_id);

  -- 2. Conversations and notes, both ways.
  DELETE FROM conversations WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_conversations = ROW_COUNT;
  DELETE FROM conversations
   WHERE prospect_id IN (SELECT id FROM prospects WHERE organization_id = p_org_id);

  DELETE FROM notes WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_notes = ROW_COUNT;
  DELETE FROM notes
   WHERE prospect_id IN (SELECT id FROM prospects WHERE organization_id = p_org_id);

  -- 3. The leads on the boards.
  DELETE FROM prospects WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_prospects = ROW_COUNT;

  -- 4. Scraper output. By org first: a lead whose run is already gone has a
  --    null run_id and would otherwise survive and keep counting against quota.
  --    run_logs and run_sdr_assignments cascade from runs.
  DELETE FROM scraper_leads WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_scraper_leads = ROW_COUNT;
  DELETE FROM runs WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  -- 5. Import history. References areas and users, both of which SURVIVE a
  --    reset, so there is no ordering constraint — but the sessions are a
  --    record of test imports and belong with the rest of the data.
  DELETE FROM csv_import_sessions WHERE organization_id = p_org_id;

  -- 6. Bridge is self-contained. bridge_run_logs has no organization_id of its
  --    own and cascades from bridge_runs, so it is not listed.
  DELETE FROM bridge_candidates WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_bridge = ROW_COUNT;
  DELETE FROM bridge_runs       WHERE organization_id = p_org_id;
  DELETE FROM bridge_seed_lists WHERE organization_id = p_org_id;

  -- 7. Support threads opened while testing.
  DELETE FROM support_ticket_messages
   WHERE ticket_id IN (SELECT id FROM support_tickets WHERE organization_id = p_org_id);
  DELETE FROM support_tickets WHERE organization_id = p_org_id;
  GET DIAGNOSTICS n_tickets = ROW_COUNT;

  -- 8. The calendar-month counter cache. The billing-period quota is derived
  --    from scraper_leads (already gone above); this is the other half.
  DELETE FROM monthly_lead_counts WHERE organization_id = p_org_id;

  RETURN jsonb_build_object(
    'prospects',     n_prospects,
    'scraper_leads', n_scraper_leads,
    'runs',          n_runs,
    'conversations', n_conversations,
    'notes',         n_notes,
    'audit_log',     n_audit,
    'bridge_candidates', n_bridge,
    'support_tickets',   n_tickets
  );
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which would put "wipe any
-- organization's data" on PostgREST's /rpc endpoint for every logged-in user.
-- Same lockdown as delete_organization: service role only, and the route
-- verifies admin_global before calling it.
REVOKE ALL ON FUNCTION public.reset_organization_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_organization_data(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reset_organization_data(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_organization_data(uuid) TO service_role;

-- Verify — the first must return one row, the second must return nothing:
--
--   SELECT proname FROM pg_proc WHERE proname = 'reset_organization_data';
--
--   SELECT grantee FROM information_schema.role_routine_grants
--   WHERE routine_name = 'reset_organization_data'
--     AND grantee IN ('PUBLIC','anon','authenticated');
