-- ============================================================
-- QA-F34: prospects is the most sensitive table in the system
-- (all lead/contact data), and its RLS policies were configured
-- directly in the Supabase dashboard — never captured in a
-- versioned migration. If the project ever needs to be rebuilt
-- or cloned for a new client, these access rules had no source
-- of truth in the repo.
--
-- This migration codifies exactly what is live in production
-- today, read via pg_policies / pg_proc. It changes nothing —
-- every DROP POLICY IF EXISTS + CREATE POLICY pair recreates the
-- identical policy (same name, same cmd, same qual), and both
-- CREATE OR REPLACE FUNCTION statements reproduce the existing
-- function bodies verbatim.
--
-- Observation (not a fix, just noted for whoever reads this next):
-- "Global admin full access on prospects" is named for a global
-- admin but its qual checks my_role() = 'admin' (not 'admin_global')
-- AND my_org_id() IS NULL — under the current role model only
-- admin_global users have a null organization_id, so this policy's
-- condition can never actually be satisfied by any real user today.
-- The separate "admin_global reads all prospects" policy below is
-- what actually grants admin_global access, but only for SELECT —
-- admin_global has no INSERT/UPDATE/DELETE path onto prospects via
-- RLS. Left exactly as-is; this migration only documents current
-- behavior, not corrects it.
-- ============================================================

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

-- ── Helper functions the policies below depend on ──────────────
CREATE OR REPLACE FUNCTION public.my_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role FROM public.users WHERE id = auth.uid()
$function$;

-- ── Policies ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "Global admin full access on prospects" ON public.prospects;
CREATE POLICY "Global admin full access on prospects"
  ON public.prospects FOR ALL
  USING (my_role() = 'admin' AND my_org_id() IS NULL);

DROP POLICY IF EXISTS "Org admin full access on prospects" ON public.prospects;
CREATE POLICY "Org admin full access on prospects"
  ON public.prospects FOR ALL
  USING (my_role() = 'admin' AND organization_id = my_org_id());

DROP POLICY IF EXISTS "SDR selects own org prospects" ON public.prospects;
CREATE POLICY "SDR selects own org prospects"
  ON public.prospects FOR SELECT
  USING (assigned_to = auth.uid() AND organization_id = my_org_id());

DROP POLICY IF EXISTS "SDR updates own org prospects" ON public.prospects;
CREATE POLICY "SDR updates own org prospects"
  ON public.prospects FOR UPDATE
  USING (assigned_to = auth.uid() AND organization_id = my_org_id());

DROP POLICY IF EXISTS "admin_global reads all prospects" ON public.prospects;
CREATE POLICY "admin_global reads all prospects"
  ON public.prospects FOR SELECT
  USING (my_role() = 'admin_global');
