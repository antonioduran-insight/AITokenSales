-- ============================================================
-- Plan DEMO
--
-- RUN THIS BY HAND IN THE SUPABASE SQL EDITOR, BEFORE deploying the code
-- that offers the plan. Safe to run more than once.
--
-- WHY
-- ---
-- A prospect needs to try the product with real limits chosen for them:
-- how many leads, how many SDR seats, which add-ons. Those three were
-- already per-organization fields — what the plan decides, and what was
-- hardcoded, is everything else: which features are visible (Stats and the
-- Audit Log required Premium+), whether sender profiles are allowed (blocked
-- on Basic), which add-ons may be sold at all (Multi-workspace is
-- Enterprise-only), and how much the organization contributes to revenue.
--
-- `demo` unlocks every feature — a demo that hides half the product is not a
-- demo — while its numbers stay whatever Global Admin set, and it is excluded
-- from MRR and from the quarter/vendor reports, exactly like `ultra`.
--
-- There is deliberately NO expiry column. A trial ends when someone switches
-- the organization off with the toggle that already exists. If trials ever
-- start being forgotten, that is when to add `demo_expires_at` and a cron —
-- not before.
-- ============================================================

-- ------------------------------------------------------------
-- Widen the plan CHECK, if there is one.
--
-- The `organizations` table predates this migrations folder, so its exact
-- constraint is not in this repo and its NAME differs between environments —
-- the same trap as prospects.search_combo in 20260904. So: find any CHECK on
-- this table that mentions `plan`, and rebuild it with `demo` added rather
-- than guessing at a name. If the column has no CHECK at all, this does
-- nothing and the plan works regardless.
-- ------------------------------------------------------------
DO $$
DECLARE
  c record;
  rebuilt boolean := false;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'organizations'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%plan%'
  LOOP
    EXECUTE format('ALTER TABLE public.organizations DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped plan CHECK % on organizations', c.conname;
    rebuilt := true;
  END LOOP;

  IF rebuilt THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_plan_check
      CHECK (plan IN ('basic', 'premium', 'enterprise', 'ultra', 'demo'));
    RAISE NOTICE 'Recreated organizations_plan_check including demo';
  ELSE
    RAISE NOTICE 'organizations has no CHECK on plan — nothing to widen';
  END IF;
END $$;

-- ------------------------------------------------------------
-- Verify — the first should list the constraint (or nothing, which is also
-- fine), and the second must succeed and then roll back.
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.organizations'::regclass AND contype = 'c';
--
--   BEGIN;
--     UPDATE organizations SET plan = 'demo'
--     WHERE id = (SELECT id FROM organizations LIMIT 1);
--   ROLLBACK;
-- ------------------------------------------------------------
