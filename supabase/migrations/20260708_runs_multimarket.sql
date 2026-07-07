-- Multi-market support for runs and SDR assignments
ALTER TABLE runs ADD COLUMN IF NOT EXISTS markets text[] DEFAULT '{}';
ALTER TABLE run_sdr_assignments ADD COLUMN IF NOT EXISTS assigned_markets text[] DEFAULT '{}';
