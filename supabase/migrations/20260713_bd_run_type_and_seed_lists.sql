-- BD runs live in the same runs table as individual-lead runs, but need
-- to be distinguishable, and need to record which seed lists they used
-- (BD runs take seed lists instead of combos/market).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS run_type text NOT NULL DEFAULT 'individual'
  CHECK (run_type IN ('individual', 'bd'));

CREATE TABLE IF NOT EXISTS run_seed_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seed_list_id  uuid NOT NULL REFERENCES org_company_seed_lists(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (run_id, seed_list_id)
);

ALTER TABLE run_seed_lists ENABLE ROW LEVEL SECURITY;

-- Mirrors run_sdr_assignments' RLS shape exactly
CREATE POLICY "admin reads own org run seed lists" ON run_seed_lists
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM runs r
      WHERE r.id = run_id
      AND r.organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY "admin_global full access run seed lists" ON run_seed_lists
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE POLICY "service role inserts run seed lists" ON run_seed_lists
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS run_seed_lists_run_idx ON run_seed_lists(run_id);
CREATE INDEX IF NOT EXISTS run_seed_lists_seed_list_idx ON run_seed_lists(seed_list_id);
