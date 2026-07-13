-- Turn the bd_group add-on on for our own org, so BD Group screens remain
-- usable now that they're gated behind organization_addons.is_active.
-- Mirrors the existing seed-data convention (org_combos, pipeline_stages)
-- of activating things for the 'aitokensales' org by slug.
-- organization_addons has no unique constraint on (organization_id,
-- addon_type), so idempotency is via NOT EXISTS rather than ON CONFLICT.
INSERT INTO organization_addons (organization_id, addon_type, is_active)
SELECT o.id, 'bd_group', true
FROM organizations o
WHERE o.slug = 'aitokensales'
  AND NOT EXISTS (
    SELECT 1 FROM organization_addons oa
    WHERE oa.organization_id = o.id AND oa.addon_type = 'bd_group'
  );
