-- ============================================================
-- FUNC-F8 fix: pipeline_stages <-> outreach_status was mapped purely by
-- position, and the write path (Settings' saveOrder, 0-indexed) and read
-- path (KanbanBoard's stageMap lookup, 1-indexed) disagreed on the index
-- base. Net effect, confirmed in the app code: EVERY org's Kanban column
-- labels are shifted by exactly one position from what's actually seeded
-- (e.g. the "Demo Scheduled" column has been showing the label meant for
-- "Closed", and "Closed" has been showing the label meant for "Nurture") -
-- even before any admin ever touched the reorder/rename UI. Any org that
-- DID rename/reorder/add/delete stages afterwards likely did so while
-- looking at these already-mislabeled columns, so the existing `position`
-- values cannot be trusted to reconstruct "what the admin really meant."
--
-- This migration adds an explicit, unique-per-org outreach_status column
-- and assigns it by RANK ORDER of each org's existing stage rows (position
-- ASC, id ASC as tiebreak) - 1st row -> new, 2nd -> connection_sent, ...,
-- 7th -> nurture - preserving whatever custom name/color an admin set,
-- without deleting anything. Run this in two steps so you can eyeball the
-- result before the constraints are finalized.
-- ============================================================

-- STEP 1 — add the column (nullable for now) and backfill by rank.
-- Safe to run standalone; touches no existing name/color/position values.

ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS outreach_status text;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY organization_id ORDER BY position ASC, id ASC) AS rnk
  FROM pipeline_stages
)
UPDATE pipeline_stages ps
SET outreach_status = CASE ranked.rnk
  WHEN 1 THEN 'new'
  WHEN 2 THEN 'connection_sent'
  WHEN 3 THEN 'connected'
  WHEN 4 THEN 'replied'
  WHEN 5 THEN 'demo_scheduled'
  WHEN 6 THEN 'closed'
  WHEN 7 THEN 'nurture'
  ELSE NULL -- an org with MORE than 7 rows (leftover dupes) - see STEP 1b
END
FROM ranked
WHERE ps.id = ranked.id;

-- STEP 1a — diagnostic: run this before continuing. Every org should show
-- exactly 7 rows, one per status, with none NULL. If a row is NULL here,
-- that org had more than 7 pipeline_stages rows (duplicates/leftovers from
-- the old bug) - decide by hand whether to delete or re-map it before
-- STEP 2, since STEP 2's constraints will reject any remaining NULL/dupe.
--
--   SELECT organization_id, id, name, position, outreach_status
--   FROM pipeline_stages
--   ORDER BY organization_id, position;
--
--   -- Orgs with a NULL row (more than 7 stages) or fewer than 7 rows:
--   SELECT organization_id, COUNT(*), COUNT(outreach_status) AS mapped
--   FROM pipeline_stages
--   GROUP BY organization_id
--   HAVING COUNT(*) <> 7 OR COUNT(outreach_status) <> 7;
--
-- For an org with FEWER than 7 rows, insert the missing canonical status/
-- name/color rows by hand (see the seed VALUES list in
-- 20260702_settings.sql) before running STEP 2.

-- STEP 2 — finalize once every row above is resolved (run separately,
-- after confirming STEP 1a is clean):
--
--   ALTER TABLE pipeline_stages ALTER COLUMN outreach_status SET NOT NULL;
--   ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_status_check
--     CHECK (outreach_status IN ('new','connection_sent','connected','replied','demo_scheduled','closed','nurture'));
--   ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_org_status_unique
--     UNIQUE (organization_id, outreach_status);
