-- Archiving for prospects: hide a lead from the working views without
-- deleting it and without touching billing.
--
-- WHAT ARCHIVING IS, AND IS NOT
-- ----------------------------
-- A rep who has finished with a lead — wrong person, went cold, not worth
-- pursuing — needs it off the board. Today the only options are to leave it
-- cluttering the Kanban forever or to delete it, which loses the record.
--
-- Archiving is neither. The row stays, the lead disappears from Kanban and
-- the Leads table, and:
--
--   * MONTHLY LEAD COUNTS ARE NOT AFFECTED. Quota is computed by
--     `getLeadQuota()` from `scraper_leads` where `exported_to_crm = true`,
--     inside the org's billing period — it has never counted `prospects` at
--     all. Archiving therefore cannot refund a lead, which is the intended
--     behaviour: the lead was delivered and paid for. This is a property of
--     the existing design, not something this migration enforces, so anyone
--     later moving quota onto `prospects` must keep it in mind.
--
--   * DEDUPLICATION STILL SEES IT. Every insert path (CSV import, scraper
--     assign, bridge assign, dedup.ts) deliberately does NOT filter on
--     archived_at. An archived lead that stopped counting as a duplicate
--     would be re-imported as new and reappear on the board — the exact
--     opposite of what the rep asked for.
--
-- `archived_at` rather than a boolean: "when" answers questions a flag can't,
-- and NULL/NOT NULL is the same cheap check.
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Nullable and no FK action needed beyond SET NULL: losing the identity of
-- whoever archived it must never block deleting that person.
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS archived_by uuid
  REFERENCES public.users(id) ON DELETE SET NULL;

-- Partial index: every listing query filters `archived_at IS NULL`, and the
-- unarchived rows are the overwhelming majority, so indexing only the
-- archived ones keeps it small while still serving the "show me the archive"
-- view. The IS NULL case is answered by the existing org/area indexes.
CREATE INDEX IF NOT EXISTS prospects_archived_idx
  ON public.prospects (organization_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- Verify — expect two rows, and zero archived to start with:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'prospects'
--     AND column_name IN ('archived_at', 'archived_by');
--
--   SELECT count(*) FROM public.prospects WHERE archived_at IS NOT NULL;
