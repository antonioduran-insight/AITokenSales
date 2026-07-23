-- Free-text description of what the org sells and to whom. Passed to the
-- scraper backend so generated outreach messages can reference the company's
-- actual products / focus.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_context text DEFAULT '';
