-- ============================================================
-- Settings migration: pipeline_stages + organization_addons
-- Run this in the Supabase SQL editor before deploying the
-- feature/org-settings-support-blur branch.
-- ============================================================

-- 1. Add domain_blacklist column to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS domain_blacklist text;

-- 2. pipeline_stages table
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6C63FF',
  position integer NOT NULL DEFAULT 0,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin full access on pipeline_stages" ON pipeline_stages
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'admin_global'))
  );

CREATE POLICY "sdr reads own org pipeline_stages" ON pipeline_stages
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- 3. organization_addons table
CREATE TABLE IF NOT EXISTS organization_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  addon_type text NOT NULL CHECK (addon_type IN (
    'account_management', 'multi_workspace',
    'extended_data_retention', 'sso', 'linkedin_auto_messaging'
  )),
  is_active boolean DEFAULT true,
  price_monthly numeric,
  activated_at timestamptz DEFAULT now()
);

ALTER TABLE organization_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads own org addons" ON organization_addons
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "admin_global manages addons" ON organization_addons
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

-- 4. Default pipeline stages for AITokenSales org
INSERT INTO pipeline_stages (organization_id, name, color, position, is_default)
SELECT
  o.id,
  s.stage_name,
  s.stage_color,
  s.stage_position,
  true
FROM organizations o,
(VALUES
  ('New',                '#6C63FF', 0),
  ('Connection Sent',    '#3B82F6', 1),
  ('Connected',          '#22C55E', 2),
  ('Replied',            '#F59E0B', 3),
  ('Demo Scheduled',     '#EC4899', 4),
  ('Closed',             '#10B981', 5),
  ('Nurture',            '#8B5CF6', 6)
) AS s(stage_name, stage_color, stage_position)
WHERE o.slug = 'aitokensales'
ON CONFLICT DO NOTHING;

-- 5. Support tickets RLS — allow org admins to INSERT their own tickets
-- (the table likely already exists; these policies may already be set)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'support_tickets'
      AND policyname = 'admin creates own org tickets'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "admin creates own org tickets" ON support_tickets
        FOR INSERT WITH CHECK (
          organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
          AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
        );
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'support_tickets'
      AND policyname = 'admin reads own org tickets'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "admin reads own org tickets" ON support_tickets
        FOR SELECT USING (
          organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
        );
    $policy$;
  END IF;
END;
$$;
