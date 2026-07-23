-- Bridge is a separate add-on from the lead scraper: it finds B2B partnership
-- contacts inside specific companies for the admin to review manually.
-- Allow 'bridge' as an addon_type.

ALTER TABLE organization_addons DROP CONSTRAINT IF EXISTS organization_addons_addon_type_check;
ALTER TABLE organization_addons ADD CONSTRAINT organization_addons_addon_type_check
  CHECK (addon_type IN (
    'account_management',
    'multi_workspace',
    'extended_data_retention',
    'sso',
    'linkedin_auto_messaging',
    'bridge'
  ));
