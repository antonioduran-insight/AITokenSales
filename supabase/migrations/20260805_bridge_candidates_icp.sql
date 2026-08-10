-- ICP scoring for Bridge candidates.
--
-- WHAT WAS BROKEN
-- ---------------
-- Bridge candidates had no score at all, and `bridge-assign.ts` wrote
-- `lead_temperature: 'Cold'` as a literal for every single one. So every
-- partnership contact arrived on the Kanban as Cold with a blank ICP column,
-- indistinguishable from each other — the same shape of bug as the scraper's
-- always-Cold problem (that one was `icp_tier` being computed and then
-- dropped before the insert; this one was never computed at all).
--
-- WHY A SEPARATE SCALE
-- -------------------
-- The sales scorer gives 40 of its 100 points as flat constants, justified by
-- filters the Apify actor applies on input. Only one of those three filters
-- exists in Bridge (company headcount, via the seed list). Nothing filters
-- LinkedIn activity, so awarding those points to a partnership candidate would
-- be crediting a check that never ran.
--
-- Bridge instead has evidence the sales pipeline lacks: the admin typed the
-- target companies into the seed list by hand. `scraper/bridge_icp_scorer.py`
-- re-earns the sales scorer's 25 constant points as a 25-point "the company
-- was deliberately targeted" component, and weights job title higher since
-- fewer components carry the discrimination.
--
-- Thresholds are shared (70 / 50) and the totals land on the same four rungs,
-- so the two lead types mean the same thing side by side on one board:
--
--     Bridge   40 COLD   60 WARM   80 HOT   100 HOT
--     Sales    40 COLD   60 WARM   70 HOT    90 HOT
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically. Run it BEFORE deploying the backend, or every
-- candidate insert fails with PGRST204 on the unknown columns.

ALTER TABLE public.bridge_candidates
  ADD COLUMN IF NOT EXISTS icp_score integer,
  ADD COLUMN IF NOT EXISTS icp_tier text;

-- Same three values the sales pipeline uses, checked so a typo in the scorer
-- surfaces as a failed insert rather than a tier the CRM silently maps to Cold.
ALTER TABLE public.bridge_candidates
  DROP CONSTRAINT IF EXISTS bridge_candidates_icp_tier_check;
ALTER TABLE public.bridge_candidates
  ADD CONSTRAINT bridge_candidates_icp_tier_check
  CHECK (icp_tier IS NULL OR icp_tier IN ('HOT', 'WARM', 'COLD'));

-- Backfill the 620 candidates that predate scoring.
--
-- Deliberately reimplements the scorer in SQL rather than leaving these NULL:
-- the inputs (title, about, company_name) are all stored, so the score is
-- fully recoverable, and a permanently unscored older half of the table would
-- make the ICP column untrustworthy exactly where it is most useful — the
-- backlog somebody is about to work through.
--
-- The keyword lists MUST match scraper/icp_scorer.py (PRIORITY_TITLES and
-- AI_SIGNAL_KEYWORDS). They are duplicated here only because this runs once,
-- against rows the Python path will never revisit; new candidates are always
-- scored by the Python scorer, which stays the single source of truth.
WITH scored AS (
  SELECT
    id,
    (CASE WHEN lower(coalesce(title, '')) ~ '(cto|cio|ceo|founder|co-founder|vp engineering|marketing director|cdo|coo|product manager|engineering manager)'
          THEN 40 ELSE 0 END)
  + (CASE WHEN lower(coalesce(about, '')) ~ '(chatgpt|openai|claude|ai|llm|copilot)'
          THEN 20 ELSE 0 END)
  + (CASE WHEN company_name IS NOT NULL AND company_name <> '' THEN 25 ELSE 0 END)
  + 15 AS total
  FROM public.bridge_candidates
  WHERE icp_score IS NULL
)
UPDATE public.bridge_candidates c
SET icp_score = s.total,
    icp_tier  = CASE WHEN s.total >= 70 THEN 'HOT'
                     WHEN s.total >= 50 THEN 'WARM'
                     ELSE 'COLD' END
FROM scored s
WHERE c.id = s.id;

-- Verify — no NULLs left, and a distribution that isn't all one bucket:
--
--   SELECT icp_tier, count(*), min(icp_score), max(icp_score)
--   FROM public.bridge_candidates
--   GROUP BY icp_tier ORDER BY min(icp_score) DESC;
