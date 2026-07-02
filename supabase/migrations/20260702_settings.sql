-- ============================================================
-- Settings migration: pipeline_stages + organization_addons
--                     + support_tickets + support_ticket_messages
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

DROP POLICY IF EXISTS "admin full access on pipeline_stages" ON pipeline_stages;
CREATE POLICY "admin full access on pipeline_stages" ON pipeline_stages
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'admin_global'))
  );

DROP POLICY IF EXISTS "sdr reads own org pipeline_stages" ON pipeline_stages;
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

DROP POLICY IF EXISTS "admin reads own org addons" ON organization_addons;
CREATE POLICY "admin reads own org addons" ON organization_addons
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_global manages addons" ON organization_addons;
CREATE POLICY "admin_global manages addons" ON organization_addons
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

-- 4. support_tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  subject text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin creates own org tickets" ON support_tickets;
CREATE POLICY "admin creates own org tickets" ON support_tickets
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "admin reads own org tickets" ON support_tickets;
CREATE POLICY "admin reads own org tickets" ON support_tickets
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admin_global full access on support_tickets" ON support_tickets;
CREATE POLICY "admin_global full access on support_tickets" ON support_tickets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS support_tickets_updated_at ON support_tickets;
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. support_ticket_messages table
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket participants can read messages" ON support_ticket_messages;
CREATE POLICY "ticket participants can read messages" ON support_ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = ticket_id
        AND t.organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    )
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

DROP POLICY IF EXISTS "ticket participants can insert messages" ON support_ticket_messages;
CREATE POLICY "ticket participants can insert messages" ON support_ticket_messages
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM support_tickets t
        WHERE t.id = ticket_id
          AND t.organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
      )
      OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
    )
  );

-- 6. Default pipeline stages for AITokenSales org
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
