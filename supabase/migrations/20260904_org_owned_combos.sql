-- ============================================================
-- Combos owned by the organization
--
-- RUN THIS BY HAND IN THE SUPABASE SQL EDITOR. Nothing applies it
-- automatically. Safe to run more than once.
--
-- WHY
-- ---
-- `scraper_combos_master` was a single global catalogue only Insight Software
-- could edit; `org_combos` let a customer toggle rows in it on and off and
-- nothing more. So onboarding a customer whose buyers were not already in our
-- catalogue required one of us to hand-insert a row into a table every other
-- customer also sees. This adds an owner column: NULL keeps a row global (the
-- shared catalogue, unchanged), a real org id makes it that org's own combo,
-- invisible to everyone else.
--
-- It also drops a CHECK that was already breaking production — see step 2.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Owner column
-- ------------------------------------------------------------
ALTER TABLE scraper_combos_master
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

COMMENT ON COLUMN scraper_combos_master.organization_id IS
  'NULL = global catalogue row, readable by every org (only admin_global may edit it). '
  'Non-null = that organization''s own combo: only they can read, edit or delete it. '
  '`code` stays globally UNIQUE, so a per-org row can never collide with a global one — '
  'custom codes are minted as custom_<12 hex> by POST/PUT /api/scraper-combos.';

CREATE INDEX IF NOT EXISTS scraper_combos_master_org_idx
  ON scraper_combos_master(organization_id);

-- ------------------------------------------------------------
-- 2. Drop the CHECK on prospects.search_combo
--
-- It allowed exactly combo_A..combo_F. That list was already wrong BEFORE any
-- custom combo existed: the catalogue seeded combo_A, B, C, D, E and **G** —
-- there is no combo_F — so every lead found by combo_G violated the CHECK on
-- insert. `assignRunLeads()` only tolerates duplicate-key errors row by row; a
-- check violation is not one, so it aborts with a 500 and the WHOLE run fails
-- to reach the SDR's board, not just the offending lead.
--
-- Dropped rather than widened. A CHECK enumerating combo codes has to be
-- rewritten every time the catalogue changes, and per-org combos make that
-- continuous. `search_combo` is display-only — every surface resolves it via
-- useComboLabels() and already falls back to rendering the raw code — so an
-- unknown value degrades to a label, never to an error.
--
-- Matched by definition, not by name: the constraint's name was never recorded
-- anywhere and differs between environments.
-- ------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'prospects'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%search_combo%'
  LOOP
    EXECUTE format('ALTER TABLE public.prospects DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped CHECK constraint % on prospects.search_combo', c.conname;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. RLS
--
-- The old SELECT policy was `USING (true)` — fine for a catalogue everybody
-- shares, a cross-tenant leak the moment one row belongs to one customer.
--
-- Dropped by what it DOES, not by what it is called. The first version of this
-- migration named it, copying the spelling out of 20260706_scraper_v2.sql
-- ("everyone reads combo master") — and production turned out to hold
-- "Everyone reads combo master", with a capital E. Policy names are
-- case-sensitive identifiers, so the DROP silently matched nothing, the blanket
-- policy survived, and because permissive policies are OR'ed together its
-- `true` overrode the scoped policy added below: every authenticated user could
-- read every org's private combos. Caught by counting policies after the fact.
--
-- So: drop every permissive SELECT policy on this table whose qualifier is
-- literally `true`, whatever it is called. That is precisely the set of
-- policies that cannot coexist with per-org rows, and nothing else matches —
-- the scoped policy created below has a real qualifier, and the admin_global
-- policy is FOR ALL, not SELECT.
-- ------------------------------------------------------------
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scraper_combos_master'
      AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE'
      AND COALESCE(qual, '') IN ('true', '(true)')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.scraper_combos_master', p.policyname);
    RAISE NOTICE 'Dropped blanket SELECT policy % on scraper_combos_master', p.policyname;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "read global and own combos" ON scraper_combos_master;
CREATE POLICY "read global and own combos" ON scraper_combos_master
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- An org admin manages their OWN rows only. `organization_id IS NOT NULL` is
-- what keeps them out of the global catalogue: without it, the comparison
-- `NULL = <their org>` is NULL (not true), which happens to deny anyway — but
-- relying on three-valued logic for a security boundary is how these policies
-- go wrong. State it.
DROP POLICY IF EXISTS "admin manages own org combo definitions" ON scraper_combos_master;
CREATE POLICY "admin manages own org combo definitions" ON scraper_combos_master
  FOR ALL
  USING (
    organization_id IS NOT NULL
    AND organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'admin_global'))
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'admin_global'))
  );

-- "admin_global manages combo master" (FOR ALL, from 20260706_scraper_v2.sql)
-- is deliberately left in place: it is what keeps the global catalogue
-- editable by us.

-- ------------------------------------------------------------
-- 4. Nothing to backfill
--
-- Every existing row keeps organization_id NULL and therefore stays global and
-- visible to every org, exactly as before this migration. No org loses a combo
-- and no run changes behaviour until someone creates a custom one.
-- ------------------------------------------------------------
