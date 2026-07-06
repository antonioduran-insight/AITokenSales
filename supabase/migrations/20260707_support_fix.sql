-- ============================================================
-- Fix support tables:
--   1. Rename author_id -> created_by in support_ticket_messages
--      (if it was created with the old column name)
--   2. Create tables fresh with correct schema if they don't exist
--   3. Enable Realtime on support_ticket_messages
-- ============================================================

-- Ensure support_tickets exists with the right columns
CREATE TABLE IF NOT EXISTS support_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES auth.users(id),
  subject         text NOT NULL,
  description     text NOT NULL,
  priority        text NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to     uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Ensure support_ticket_messages exists using created_by (correct name)
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  content    text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- If the table was created with the old column name author_id, rename it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'support_ticket_messages' AND column_name = 'author_id'
  ) THEN
    ALTER TABLE support_ticket_messages RENAME COLUMN author_id TO created_by;
  END IF;
END $$;

-- RLS
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- support_tickets policies
DROP POLICY IF EXISTS "org members can manage their tickets" ON support_tickets;
CREATE POLICY "org members can manage their tickets" ON support_tickets
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin_global', 'support'))
  );

-- support_ticket_messages policies
DROP POLICY IF EXISTS "org members can read ticket messages" ON support_ticket_messages;
CREATE POLICY "org members can read ticket messages" ON support_ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = ticket_id
        AND (
          t.organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin_global', 'support'))
        )
    )
  );

DROP POLICY IF EXISTS "org members can insert ticket messages" ON support_ticket_messages;
CREATE POLICY "org members can insert ticket messages" ON support_ticket_messages
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = ticket_id
        AND (
          t.organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin_global', 'support'))
        )
    )
  );

-- Enable Realtime so the live chat subscription works
ALTER PUBLICATION supabase_realtime ADD TABLE support_ticket_messages;

-- updated_at trigger (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS support_tickets_updated_at ON support_tickets;
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
