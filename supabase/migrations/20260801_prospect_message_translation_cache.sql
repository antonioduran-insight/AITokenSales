-- ============================================================================
-- Persist message translations on prospects (one cached slot per field)
-- ============================================================================
-- POST /api/prospects/[id]/translate previously returned the translated text
-- without storing it — every drawer close/reopen lost it, and the SDR had to
-- re-translate (and re-spend the org's Anthropic tokens) every time they
-- wanted to see it again. This adds one cached translation slot per message
-- field, overwritten by whatever language was translated to most recently —
-- not a full multi-language history, just "the last translation, kept next
-- to the original so the drawer can toggle between them".
--
-- Additive only: new nullable columns, no existing data or behavior changes.
-- `prospects` already has RLS policies scoped by organization_id/assigned_to
-- (see 20260731_perf_advisor_fixes_b_prospects.sql) — those cover `SELECT *`
-- and column-level updates alike, so no policy changes needed here.
--
-- Run this in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS custom1_translation text,
  ADD COLUMN IF NOT EXISTS custom1_translation_lang text,
  ADD COLUMN IF NOT EXISTS custom2_translation text,
  ADD COLUMN IF NOT EXISTS custom2_translation_lang text;
