-- ============================================================
-- audit_log.event_type: add the two values the app already writes
-- but the CHECK constraint rejects.
--
-- Verified in production (28/07) with:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'audit_log_event_type_check';
--
-- The live list had exactly 8 values and was missing BOTH:
--
--   prospect_updated    -- written by ProspectDrawer's 4 editable fields
--                          (Company, Job Title, Market, Search Combo)
--   conversation_added  -- written when a closed-deal chat is uploaded
--
-- Every insert with either value failed with 23514, and
-- logAuditEvent() never read the error, so it was completely
-- silent. Measured: 711 audit rows in the whole history and
-- ZERO of type prospect_updated (filtering the Audit Log page by
-- that type, All time / All events, returned "0 events"). Same
-- for conversation_added.
--
-- This is the exact trap CLAUDE.md documents for addon_type:
-- adding a new value needs the app-side entry AND a migration
-- widening the CHECK. It was missed twice on this table.
--
-- Companion app-side fix (same batch): src/lib/utils/audit.ts now
-- returns a boolean and logs the error, so a future missing value
-- surfaces immediately instead of silently.
-- ============================================================

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_event_type_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'prospect_created'::text,
    'prospect_updated'::text,     -- added here
    'status_changed'::text,
    'prospect_reassigned'::text,
    'note_added'::text,
    'conversation_added'::text,   -- added here
    'duplicate_attempt'::text,
    'sdr_created'::text,
    'sdr_deactivated'::text,
    'csv_import'::text
  ]));

-- Sanity check after running (both must return true):
--   SELECT pg_get_constraintdef(oid) LIKE '%prospect_updated%'
--        , pg_get_constraintdef(oid) LIKE '%conversation_added%'
--   FROM pg_constraint WHERE conname = 'audit_log_event_type_check';
