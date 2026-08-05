-- Remove delete_old_leads(), superseded by /api/cron/prune-untouched-prospects.
--
-- The function was introduced in 20260702_multi_market.sql and never
-- scheduled: pg_cron is not enabled on this project (verified 05/08 —
-- `cron.job` does not exist), so it has never run and no data was ever
-- deleted by it. It is being dropped rather than left dormant because a
-- dormant copy is a trap: it is one `SELECT cron.schedule(...)` away from
-- silently overriding the retention policy that replaced it.
--
-- What it did, and why none of it was salvageable:
--
--   DELETE FROM prospects WHERE created_at < now() - interval '3 months';
--
--   * No add-on exclusion. Its own comment said to add one "after the
--     organization_addons table is available" — that never happened, so an
--     org paying for Extended Data Retention would have been pruned like
--     everyone else.
--   * It would have errored anyway. `audit_log.prospect_id` references
--     prospects with ON DELETE NO ACTION, so any prospect with audit history
--     raises a foreign-key violation, and as a single statement the whole
--     DELETE aborts. The realistic outcome of enabling it was not data loss
--     but a job failing quietly at 03:00 every day.
--   * It deleted closed deals along with untouched leads, taking their
--     `conversations` and `notes` with them (both CASCADE) — including the
--     chat upload the CRM forces reps to provide when closing a deal.
--
-- The replacement lives in the application, not the database, so its rules
-- are reviewable in the repo and its behaviour is testable with
-- `?dry_run=1` before anything is removed.
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically.

DROP FUNCTION IF EXISTS public.delete_old_leads();

-- Defensive: if pg_cron is ever enabled later and someone restores the old
-- schedule from the comment in 20260702, this unschedules it. Wrapped so the
-- migration still succeeds on a database where pg_cron was never installed
-- (the current state) — `cron.unschedule` simply doesn't exist there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('delete-old-leads');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- No such job, or no permission to touch the cron schema. Neither is a
    -- reason to fail the migration; the DROP above is the part that matters.
    RAISE NOTICE 'delete-old-leads was not scheduled, nothing to unschedule';
END $$;

-- Verify: must return zero rows.
--   SELECT proname FROM pg_proc WHERE proname = 'delete_old_leads';
