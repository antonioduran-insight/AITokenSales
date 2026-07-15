-- Product description per organization, so scraper-generated outreach
-- messages can reference what the org actually sells instead of an
-- empty template.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS product_description text;
