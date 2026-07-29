-- ============================================================
-- Hong Kong: default_language 'zh-TW' -> 'zh-HK'
--
-- The scraper's message generator distinguishes the two
-- (linkedin-scraper/api/message_generator.py:40-41):
--
--   "zh-tw": "Traditional Chinese (繁體中文), as used in Taiwan"
--   "zh-hk": "Traditional Chinese (繁體中文), as used in Hong Kong"
--
-- Hong Kong was set to 'zh-TW', so outreach to HK prospects was
-- generated with a Taiwanese register. Both are Traditional, so
-- it's not the P1 language bug — but written HK Chinese has its
-- own lexicon and it reads wrong in outreach.
--
-- Verified in production (28/07): the whole `markets` table is
-- otherwise correct (Canada/US 'en', Taiwan 'zh-TW', China
-- 'zh-CN', Spain 'es', etc.). This is the only wrong value found
-- in 53 rows.
--
-- NOTE: `markets` is a backend-owned table and its contents are
-- NOT versioned in either repo (grep for default_language across
-- supabase/migrations/ returns nothing). This migration is also
-- the first record anywhere of what these values should be. If
-- the table is ever rebuilt, that seed has to come from somewhere
-- — worth dumping it into a reference migration separately.
-- ============================================================

UPDATE public.markets
   SET default_language = 'zh-HK'
 WHERE name = 'Hong Kong'
   AND default_language <> 'zh-HK';

-- Verify:
--   SELECT name, region, default_language FROM markets
--   WHERE name IN ('Hong Kong','Taiwan','China');
-- Expected: Hong Kong zh-HK | Taiwan zh-TW | China zh-CN
