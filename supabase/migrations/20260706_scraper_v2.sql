-- ============================================================
-- Scraper V2 — full schema for account-based pipeline
-- Run in Supabase SQL Editor in order
-- ============================================================

-- 1. scraper_access flag on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS scraper_access boolean NOT NULL DEFAULT false;

-- 2. API keys on organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS apify_token text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS anthropic_key text;

-- 3. Runs table (Supabase mirror of Railway backend runs)
CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  executed_by uuid REFERENCES users(id),
  combos text[] NOT NULL DEFAULT '{}',
  market text NOT NULL DEFAULT '',
  total_leads_requested integer DEFAULT 0,
  sdr_count integer DEFAULT 0,
  plan text DEFAULT 'basic',
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads own org runs" ON runs
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "admin_global full access runs" ON runs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE INDEX IF NOT EXISTS runs_org_idx ON runs(organization_id);
CREATE INDEX IF NOT EXISTS runs_executed_by_idx ON runs(executed_by);

-- 4. Combo master table (global, managed by admin_global)
CREATE TABLE IF NOT EXISTS scraper_combos_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  title_keywords text[] NOT NULL DEFAULT '{}',
  seniority_levels text[] NOT NULL DEFAULT '{}',
  company_headcounts text[] NOT NULL DEFAULT '{}',
  functions text[] NOT NULL DEFAULT '{}',
  is_active boolean DEFAULT true,
  position integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

INSERT INTO scraper_combos_master (code, name, description, title_keywords, seniority_levels, company_headcounts, functions, position)
VALUES
  ('combo_A', 'IT Manager / CIO', 'IT decision makers in mid-size companies',
   ARRAY['IT Manager','IT Director','CIO','Head of IT','Chief Information Officer','資訊主管','IT主管'],
   ARRAY['Director','CXO','Vice President'],
   ARRAY['B','C'],
   ARRAY[]::text[], 0),

  ('combo_B', 'Marketing Director', 'Marketing leaders and growth professionals',
   ARRAY['Marketing Director','CMO','Head of Marketing','VP Marketing','Chief Marketing Officer','行銷總監','行銷主管'],
   ARRAY['Director','CXO','Vice President'],
   ARRAY['B','C'],
   ARRAY[]::text[], 1),

  ('combo_C', 'Digital Transform / CDO', 'Digital transformation and innovation leaders',
   ARRAY['CDO','Chief Digital Officer','Digital Transformation','Head of Digital','數位長','數位轉型'],
   ARRAY['Director','CXO','Vice President'],
   ARRAY['C','D'],
   ARRAY[]::text[], 2),

  ('combo_D', 'CTO / VP Engineering', 'Technical leadership in technology companies',
   ARRAY['CTO','VP Engineering','VP of Engineering','Chief Technology Officer','技術長','工程主管'],
   ARRAY['Director','CXO','Vice President'],
   ARRAY['B','C'],
   ARRAY[]::text[], 3),

  ('combo_E', 'E-commerce / Ops', 'Operations and e-commerce managers',
   ARRAY['E-commerce Manager','Operations Director','Head of Operations','COO','電商經理','營運主管'],
   ARRAY['Director','Vice President','Manager'],
   ARRAY['C','D'],
   ARRAY[]::text[], 4),

  ('combo_G', 'Product / Eng Manager', 'Product and engineering managers',
   ARRAY['Product Manager','Engineering Manager','Head of Product','VP Product','產品主管','工程經理'],
   ARRAY['Manager','Director'],
   ARRAY['B','C'],
   ARRAY[]::text[], 5)

ON CONFLICT (code) DO NOTHING;

ALTER TABLE scraper_combos_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "everyone reads combo master" ON scraper_combos_master
  FOR SELECT USING (true);

CREATE POLICY "admin_global manages combo master" ON scraper_combos_master
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

-- 5. Combos activated per organization
CREATE TABLE IF NOT EXISTS org_combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  combo_code text NOT NULL REFERENCES scraper_combos_master(code) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, combo_code)
);

ALTER TABLE org_combos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads own org combos" ON org_combos
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "admin manages own org combos" ON org_combos
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','admin_global'))
  );

CREATE POLICY "admin_global full access org combos" ON org_combos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

-- Seed: activate all combos for AITokenSales
INSERT INTO org_combos (organization_id, combo_code, is_active)
SELECT o.id, c.code, true
FROM organizations o, scraper_combos_master c
WHERE o.slug = 'aitokensales'
ON CONFLICT (organization_id, combo_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS org_combos_org_idx ON org_combos(organization_id);

-- 6. Sender profiles per SDR (Premium+)
CREATE TABLE IF NOT EXISTS sender_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  title text NOT NULL,
  company text NOT NULL,
  style_hint text NOT NULL DEFAULT '',
  icp_focus text[] NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'en',
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sender_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sdr manages own sender profiles" ON sender_profiles
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "admin reads org sender profiles" ON sender_profiles
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','admin_global'))
  );

CREATE POLICY "admin_global full access sender profiles" ON sender_profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE INDEX IF NOT EXISTS sender_profiles_user_idx ON sender_profiles(user_id);
CREATE INDEX IF NOT EXISTS sender_profiles_org_idx ON sender_profiles(organization_id);

-- 7. SDR assignments per run
CREATE TABLE IF NOT EXISTS run_sdr_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sdr_id uuid NOT NULL REFERENCES users(id),
  sender_profile_id uuid REFERENCES sender_profiles(id),
  leads_assigned integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (run_id, sdr_id)
);

ALTER TABLE run_sdr_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads own org run assignments" ON run_sdr_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM runs r
      WHERE r.id = run_id
      AND r.organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY "admin_global full access run assignments" ON run_sdr_assignments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE POLICY "service role inserts run assignments" ON run_sdr_assignments
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS run_sdr_assignments_run_idx ON run_sdr_assignments(run_id);
CREATE INDEX IF NOT EXISTS run_sdr_assignments_sdr_idx ON run_sdr_assignments(sdr_id);
