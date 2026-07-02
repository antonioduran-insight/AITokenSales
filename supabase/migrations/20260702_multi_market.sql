-- ============================================================
-- Multi-market support: user_areas + monthly_lead_counts
-- + auto-delete old leads via delete_old_leads() + pg_cron
-- ============================================================

-- 1. user_areas — many-to-many between users and areas
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_areas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id       uuid        NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, area_id)
);

-- Seed from existing area_id column so existing SDRs keep their area
INSERT INTO user_areas (user_id, area_id)
  SELECT id, area_id
  FROM   users
  WHERE  area_id IS NOT NULL
  ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE user_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_areas: read own" ON user_areas;
CREATE POLICY "user_areas: read own"
  ON user_areas FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_areas: admin read" ON user_areas;
CREATE POLICY "user_areas: admin read"
  ON user_areas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role IN ('admin', 'admin_global')
    )
  );

-- 2. monthly_lead_counts — per-org per-month counter
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_lead_counts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year_month      varchar(7)  NOT NULL, -- 'YYYY-MM'
  count           integer     NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (organization_id, year_month)
);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION update_monthly_lead_counts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_monthly_lead_counts_updated_at ON monthly_lead_counts;
CREATE TRIGGER trg_monthly_lead_counts_updated_at
  BEFORE UPDATE ON monthly_lead_counts
  FOR EACH ROW EXECUTE FUNCTION update_monthly_lead_counts_updated_at();

-- RLS (only service role writes; admins read)
ALTER TABLE monthly_lead_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_lead_counts: admin read" ON monthly_lead_counts;
CREATE POLICY "monthly_lead_counts: admin read"
  ON monthly_lead_counts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN   organizations o ON o.id = u.organization_id
      WHERE  u.id = auth.uid()
        AND  u.role = 'admin'
        AND  o.id = monthly_lead_counts.organization_id
    )
  );

-- 3. increment_monthly_leads() — atomic upsert + increment
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_monthly_leads(
  p_org_id    uuid,
  p_year_month varchar(7),
  p_count     integer
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO monthly_lead_counts (organization_id, year_month, count)
  VALUES (p_org_id, p_year_month, p_count)
  ON CONFLICT (organization_id, year_month)
  DO UPDATE SET count = monthly_lead_counts.count + EXCLUDED.count,
                updated_at = now();
END;
$$;

-- 4. delete_old_leads() + pg_cron schedule
-- -------------------------------------------------------
-- Deletes prospects older than 3 months.
-- After the organization_addons table is available (from the
-- org-settings migration), add an extended_data_retention
-- exclusion to the WHERE clause.
CREATE OR REPLACE FUNCTION delete_old_leads()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM prospects
  WHERE created_at < now() - interval '3 months';
END;
$$;

-- Schedule: run every day at 03:00 UTC
-- Enable pg_cron in Supabase dashboard first (Database → Extensions → pg_cron),
-- then run this manually in the SQL editor:
--
-- SELECT cron.schedule('delete-old-leads', '0 3 * * *', 'SELECT delete_old_leads()');

