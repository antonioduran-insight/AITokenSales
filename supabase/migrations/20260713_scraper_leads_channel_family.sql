-- Gap from the BD Group schema phase: the scraper backend tags each BD
-- candidate with the channel family it was searched under, but the column
-- to hold that tag was never added to scraper_leads. Needed so the BD
-- Leads review screen's Confirm action can classify the resulting
-- bd_channels row.
ALTER TABLE scraper_leads ADD COLUMN IF NOT EXISTS channel_family text
  REFERENCES channel_family_types(code);
