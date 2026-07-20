-- Remove duplicate pipeline_stages rows (same organization_id + name), keeping
-- the one with the lowest position (ties broken by earliest id). Prospects
-- reference stages by `outreach_status` (name-derived), not by stage id, so
-- collapsing duplicate rows is safe.
--
-- Diagnostic (run first to see if there are real duplicates):
--   SELECT organization_id, lower(name) AS name, COUNT(*)
--   FROM pipeline_stages
--   GROUP BY organization_id, lower(name)
--   HAVING COUNT(*) > 1;

DELETE FROM pipeline_stages ps
USING pipeline_stages keep
WHERE ps.organization_id = keep.organization_id
  AND lower(ps.name) = lower(keep.name)
  AND (
    ps.position > keep.position
    OR (ps.position = keep.position AND ps.id > keep.id)
  );
