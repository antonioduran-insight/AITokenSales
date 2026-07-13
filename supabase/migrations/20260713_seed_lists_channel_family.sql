-- Each org_company_seed_lists row represents companies for one channel
-- family/archetype — missed on initial creation, adding it now.
ALTER TABLE org_company_seed_lists ADD COLUMN IF NOT EXISTS channel_family text
  REFERENCES channel_family_types(code);
