-- Defense-in-depth fix, not a behavior change today: Global Admin writes to
-- prospects via the service-role client, which bypasses RLS entirely, so
-- this policy being wrong has caused no visible bug. But as documented in
-- 20260727_document_prospects_rls.sql, "Global admin full access on
-- prospects" checked (my_role() = 'admin' AND my_org_id() IS NULL) — a
-- condition no real user can ever satisfy under the current role model,
-- since only admin_global accounts have a null organization_id, and they
-- have role = 'admin_global', not 'admin'. Replaced with the correct
-- condition so the policy actually grants what its name says, in case
-- prospects is ever reached without the service-role client.

DROP POLICY IF EXISTS "Global admin full access on prospects" ON public.prospects;
CREATE POLICY "Global admin full access on prospects"
  ON public.prospects FOR ALL
  USING (my_role() = 'admin_global');
