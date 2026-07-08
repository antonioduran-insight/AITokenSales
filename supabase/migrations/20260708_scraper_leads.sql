-- Scraper leads table — backend writes here directly; to-crm imports into prospects
CREATE TABLE IF NOT EXISTS scraper_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES runs(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  sdr_id uuid REFERENCES users(id),
  linkedin_url text,
  first_name text,
  last_name text,
  full_name text,
  company text,
  title text,
  industry text,
  company_size text,
  location text,
  email text,
  icp_score numeric,
  temperature text,
  market text,
  search_combo text,
  custom1 text,
  custom2 text,
  exported_to_crm boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scraper_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin reads own org scraper leads" ON scraper_leads
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "admin_global full access scraper leads" ON scraper_leads
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin_global')
  );

CREATE INDEX IF NOT EXISTS scraper_leads_run_idx ON scraper_leads(run_id);
CREATE INDEX IF NOT EXISTS scraper_leads_org_idx ON scraper_leads(organization_id);
