-- Add 'cancelled' to the runs status check constraint
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check
  CHECK (status IN ('pending', 'running', 'scoring', 'drafting', 'completed', 'failed', 'cancelled'));
