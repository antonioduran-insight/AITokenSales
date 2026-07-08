ALTER TABLE organizations ADD COLUMN IF NOT EXISTS anthropic_base_url text DEFAULT 'https://api.aitokenking.com.tw/api/v1';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS anthropic_model text DEFAULT 'claude-sonnet-4.6';
