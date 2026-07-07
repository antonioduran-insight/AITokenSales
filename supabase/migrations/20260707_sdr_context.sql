ALTER TABLE users ADD COLUMN IF NOT EXISTS years_experience integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS seniority text CHECK (seniority IN ('Junior','Mid','Senior','Director','Executive'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS expertise_area text;
