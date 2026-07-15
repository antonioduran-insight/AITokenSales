-- The anthropic_model default seeded in 20260708_anthropic_model_url.sql
-- ('claude-sonnet-4.6') does not exist on the org's Anthropic proxy — every
-- individual-lead run and BD messaging call falls back to this same bad
-- value whenever an org hasn't explicitly overridden it, and the value has
-- likely been silently failing with a 404 from the scraper backend ever
-- since that migration shipped. Confirmed against the proxy's own /models
-- endpoint (source of truth) that the current model is 'claude-sonnet-5' —
-- not another guess.
--
-- Two separate things, both needed:
-- 1. Change the column default so newly-created orgs stop inheriting the
--    bad value.
-- 2. Backfill existing orgs that are still sitting on the literal bad
--    default (i.e. nobody has manually corrected it since creation) to the
--    real value. Orgs where an admin_global already set a different,
--    deliberate anthropic_model are left untouched.
ALTER TABLE organizations ALTER COLUMN anthropic_model SET DEFAULT 'claude-sonnet-5';

UPDATE organizations
SET anthropic_model = 'claude-sonnet-5'
WHERE anthropic_model = 'claude-sonnet-4.6';
