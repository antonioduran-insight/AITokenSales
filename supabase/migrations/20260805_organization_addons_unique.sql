-- One row per (organization_id, addon_type) on organization_addons.
--
-- WHY THIS MATTERS, and why it is not merely hygiene:
--
-- Nothing stopped an org from having the same add-on twice. The activation
-- endpoint did a check-then-insert (SELECT ... .single(), then INSERT if
-- nothing came back), which is a race: two concurrent activations of the same
-- add-on both see "not there" and both insert. Once a duplicate pair exists,
-- every reader that expects at most one row starts failing:
--
--   * /api/bridge/[...path] gates on `.maybeSingle()`. PostgREST errors when a
--     "single" query matches several rows, so the gate reads as "no add-on"
--     and returns 403 — Bridge breaks for an org that IS paying for it.
--   * requireAddon() (src/lib/utils/route-guard.ts) fails the same way and
--     redirects the admin away from a page they are entitled to.
--   * The activation endpoint's own `.single()` then errors too, so the next
--     activation takes the INSERT branch again and adds a THIRD row.
--   * Revenue Reports sums ADDON_MONTHLY_PRICE over the org's add-on list, so
--     a duplicated $300 add-on is reported as $600/mo of MRR that nobody is
--     being billed for.
--
-- Every one of those fails quietly — a 403, a redirect, an inflated number.
-- The constraint is what makes the race impossible rather than unlikely.
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically.

-- Step 1 — collapse any duplicates that already exist, keeping one row per
-- pair. Preference order, most to least important:
--   1. an active row beats an inactive one (losing an active entitlement would
--      silently switch a paying customer's feature off)
--   2. a row with a price beats one without (price_monthly is nullable and
--      currently never written; when it starts being written, keep the value)
--   3. most recently activated wins the remaining ties
--
-- Deliberately DELETE rather than deactivate: a leftover inactive duplicate
-- would still violate the unique constraint added in step 2.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY organization_id, addon_type
      ORDER BY
        is_active DESC NULLS LAST,
        (price_monthly IS NOT NULL) DESC,
        activated_at DESC NULLS LAST,
        id
    ) AS rn
  FROM public.organization_addons
)
DELETE FROM public.organization_addons
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2 — make it impossible from here on.
ALTER TABLE public.organization_addons
  DROP CONSTRAINT IF EXISTS organization_addons_org_addon_unique;

ALTER TABLE public.organization_addons
  ADD CONSTRAINT organization_addons_org_addon_unique
  UNIQUE (organization_id, addon_type);

-- Verify: this must return zero rows.
--
--   SELECT organization_id, addon_type, count(*)
--   FROM public.organization_addons
--   GROUP BY 1, 2
--   HAVING count(*) > 1;
--
-- And to see what step 1 collapsed (run BEFORE applying, if you want a record):
--
--   SELECT organization_id, addon_type, count(*), array_agg(id)
--   FROM public.organization_addons
--   GROUP BY 1, 2
--   HAVING count(*) > 1;
