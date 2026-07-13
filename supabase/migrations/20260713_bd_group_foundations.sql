-- ============================================================
-- BD Group foundations — schema + config for channel/partnership
-- prospecting, distinct from individual-lead prospecting.
-- Purely additive: new tables + new nullable/defaulted columns
-- on existing tables. No existing columns, enums, or policies
-- are changed except extending organization_addons.addon_type
-- with a new allowed value.
-- Run in Supabase SQL Editor in order.
-- ============================================================

-- 1. channel_family_types — global reference table (admin_global managed)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_family_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE channel_family_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "everyone reads channel family types" ON channel_family_types
  FOR SELECT USING (true);

CREATE POLICY "admin_global manages channel family types" ON channel_family_types
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

-- Generic starter archetypes — deliberately industry/product agnostic so any
-- organization (not just this one) can use them as-is or add their own later.
INSERT INTO channel_family_types (code, label, description) VALUES
  ('infrastructure_telecom', 'Infrastructure & Telecom Providers',
   'Companies providing core infrastructure, connectivity, or telecom services that can bundle or resell partner offerings to their existing customer base.'),
  ('community_aggregators', 'Space & Community Aggregators',
   'Coworking operators, accelerators, associations, and other organizers with concentrated access to a target audience.'),
  ('platform_embedded', 'Platform & Embedded Software Partners',
   'SaaS platforms or software vendors positioned to embed, white-label, or cross-sell complementary offerings within their own product.'),
  ('professional_services_referrers', 'Professional Services Referrers',
   'Consultancies, agencies, and advisory firms whose clients regularly need the kind of solution being offered, making them natural referral sources.'),
  ('reseller_distributor', 'Resellers & Distributors',
   'Established sales organizations that resell or distribute third-party products or services to their own customer base.'),
  ('marketplace_directory', 'Marketplaces & Directories',
   'Online marketplaces, directories, or listing platforms where a partner presence could drive discovery and lead flow.')
ON CONFLICT (code) DO NOTHING;

-- 2. bd_channels — one row per company/channel target per organization
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS bd_channels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_name      text NOT NULL,
  channel_family    text NOT NULL REFERENCES channel_family_types(code),
  channel_score     integer,
  partnership_model text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'in_conversation', 'pilot_agreed', 'live', 'declined')),
  market            text,
  owner_sdr_id      uuid REFERENCES users(id),
  run_id            uuid REFERENCES runs(id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE bd_channels ENABLE ROW LEVEL SECURITY;

-- A channel has exactly ONE owner (unlike prospects, which are area-pooled
-- and visible to every SDR in that area) — so SDR visibility is owner-scoped,
-- matching the sender_profiles ownership pattern rather than the
-- prospects/area pattern.
CREATE POLICY "sdr manages own bd_channels" ON bd_channels
  FOR ALL USING (owner_sdr_id = auth.uid())
  WITH CHECK (owner_sdr_id = auth.uid());

CREATE POLICY "admin manages own org bd_channels" ON bd_channels
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_global full access bd_channels" ON bd_channels
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS bd_channels_updated_at ON bd_channels;
CREATE TRIGGER bd_channels_updated_at
  BEFORE UPDATE ON bd_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS bd_channels_org_idx ON bd_channels(organization_id);
CREATE INDEX IF NOT EXISTS bd_channels_owner_idx ON bd_channels(owner_sdr_id);
CREATE INDEX IF NOT EXISTS bd_channels_run_idx ON bd_channels(run_id);
CREATE INDEX IF NOT EXISTS bd_channels_family_idx ON bd_channels(channel_family);

-- 3. org_icp_keywords — per-org scoring signal keywords (generic dimensions,
--    not tied to any one org's industry — category is free text on purpose
--    so a non-AI org can define its own "signal" categories)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_icp_keywords (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category        text NOT NULL,
  keyword         text NOT NULL,
  weight          integer NOT NULL DEFAULT 1,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (organization_id, category, keyword)
);

ALTER TABLE org_icp_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read own org icp keywords" ON org_icp_keywords
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "admin manages own org icp keywords" ON org_icp_keywords
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_global full access icp keywords" ON org_icp_keywords
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE INDEX IF NOT EXISTS org_icp_keywords_org_idx ON org_icp_keywords(organization_id);

-- 4. org_channel_hooks — per-org pitch angle per channel family
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_channel_hooks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_family            text NOT NULL REFERENCES channel_family_types(code),
  hook_copy                 text,
  decision_maker_titles     text[] NOT NULL DEFAULT '{}',
  partnership_models_offered text[] NOT NULL DEFAULT '{}',
  created_at                timestamptz DEFAULT now(),
  UNIQUE (organization_id, channel_family)
);

ALTER TABLE org_channel_hooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read own org channel hooks" ON org_channel_hooks
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "admin manages own org channel hooks" ON org_channel_hooks
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_global full access channel hooks" ON org_channel_hooks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE INDEX IF NOT EXISTS org_channel_hooks_org_idx ON org_channel_hooks(organization_id);

-- 5. org_company_seed_lists — per-org named lists of seed companies to search under
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_company_seed_lists (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  list_name        text NOT NULL,
  company_names    text[] NOT NULL DEFAULT '{}',
  market           text,
  title_keywords   text[] NOT NULL DEFAULT '{}',
  seniority_levels text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz DEFAULT now(),
  UNIQUE (organization_id, list_name)
);

ALTER TABLE org_company_seed_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read own org seed lists" ON org_company_seed_lists
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "admin manages own org seed lists" ON org_company_seed_lists
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "admin_global full access seed lists" ON org_company_seed_lists
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE INDEX IF NOT EXISTS org_company_seed_lists_org_idx ON org_company_seed_lists(organization_id);

-- 6. scraper_leads — distinguish BD channel-contact candidates from individual leads
-- -------------------------------------------------------
ALTER TABLE scraper_leads ADD COLUMN IF NOT EXISTS lead_type text NOT NULL DEFAULT 'individual'
  CHECK (lead_type IN ('individual', 'bd_channel_contact'));
ALTER TABLE scraper_leads ADD COLUMN IF NOT EXISTS seed_company_name text;
ALTER TABLE scraper_leads ADD COLUMN IF NOT EXISTS verification_status text
  CHECK (verification_status IN ('pending', 'confirmed', 'rejected'));

-- 7. prospects — same lead_type split, plus link back to the bd_channels row
-- -------------------------------------------------------
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS lead_type text NOT NULL DEFAULT 'individual'
  CHECK (lead_type IN ('individual', 'bd_channel_contact'));
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS bd_channel_id uuid REFERENCES bd_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prospects_bd_channel_idx ON prospects(bd_channel_id);

-- 8. sender_profiles — LinkedIn account constraints, configurable per SDR
-- -------------------------------------------------------
ALTER TABLE sender_profiles ADD COLUMN IF NOT EXISTS linkedin_account_tier text;
ALTER TABLE sender_profiles ADD COLUMN IF NOT EXISTS connection_note_max_chars integer DEFAULT 300;
ALTER TABLE sender_profiles ADD COLUMN IF NOT EXISTS followup_max_chars integer DEFAULT 1900;

-- 9. organization_addons — add 'bd_group' as a new allowed add-on type
--    (existing allowed values are unchanged, this only widens the CHECK)
-- -------------------------------------------------------
ALTER TABLE organization_addons DROP CONSTRAINT IF EXISTS organization_addons_addon_type_check;
ALTER TABLE organization_addons ADD CONSTRAINT organization_addons_addon_type_check
  CHECK (addon_type IN (
    'account_management', 'multi_workspace',
    'extended_data_retention', 'sso', 'linkedin_auto_messaging',
    'bd_group'
  ));
