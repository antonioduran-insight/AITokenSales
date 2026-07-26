-- F17: PATCH /api/prospects (reassign) measured at ~4.9s. Part of that was
-- the admin-role check and target-SDR validation running sequentially
-- instead of in parallel (fixed in the route itself), but the bulk-transfer
-- mode's query - "every prospect currently assigned to this SDR, oldest
-- first" - also had no supporting index: `assigned_to` only appeared as the
-- trailing column of the (organization_id, linkedin_url, assigned_to)
-- partial unique index from 20260720_prospects_linkedin_per_sdr.sql, which a
-- query that doesn't filter on linkedin_url can't use efficiently.
--
-- Run this in the Supabase SQL editor.

CREATE INDEX IF NOT EXISTS prospects_assigned_to_created_at
  ON prospects (assigned_to, created_at)
  WHERE assigned_to IS NOT NULL;
