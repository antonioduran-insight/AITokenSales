-- New Run now picks a region (Asia / Latin America / Europe / USA) first,
-- then one or more specific countries within it. `markets` (text[], already
-- present) holds the chosen countries; this column records the region
-- itself for reference/logging and future reporting.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS region text;
