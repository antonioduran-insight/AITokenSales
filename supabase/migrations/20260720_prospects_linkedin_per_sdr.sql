-- "Send to another SDR" needs the SAME lead to live on multiple SDR kanbans,
-- one prospect row per SDR. The old org-wide unique key on linkedin_url blocked
-- that (prospects_linkedin_unique → "duplicate key value violates unique
-- constraint"). Replace it with a per-SDR unique key so a lead is unique per
-- (org, linkedin_url, assigned_to) instead of per (org, linkedin_url).
--
-- Run this in the Supabase SQL editor. Safe to re-run.

-- Drop the old constraint / index however it was defined.
ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_linkedin_unique;
DROP INDEX IF EXISTS prospects_linkedin_unique;

-- One prospect per (org, linkedin_url, assigned_to). Only rows WITH a
-- linkedin_url are constrained; manual prospects without one are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS prospects_linkedin_assignee_unique
  ON prospects (organization_id, linkedin_url, assigned_to)
  WHERE linkedin_url IS NOT NULL;
