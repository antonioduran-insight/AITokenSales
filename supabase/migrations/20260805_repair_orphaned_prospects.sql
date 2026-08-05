-- Repair prospects that were inserted with organization_id = NULL.
--
-- HOW THEY GOT THERE
-- ------------------
-- `/api/scraper/to-crm` wrote `organization_id: caller.organization_id ?? null`.
-- Its only gate was `caller.role !== 'admin'`, but a legacy "global admin" is
-- expressed as `role = 'admin'` with `organization_id = NULL` (see
-- `isGlobalAdmin()` in src/lib/supabase/server.ts), so such a caller passed the
-- check and every lead they exported was written with a NULL org.
--
-- WHY IT WAS INVISIBLE
-- --------------------
-- Every RLS policy on `prospects` compares `organization_id = my_org_id()`, in
-- BOTH the admin branch and the SDR branch. NULL never equals anything, so the
-- rows are unreachable by every user of the product — including the SDR they
-- were assigned to. The export reported success, the leads were counted, and
-- they simply never appeared on anyone's board.
--
-- 20 rows, all `source = 'scraper'`, all with an `assigned_to`, created
-- 18–29 July 2026. The code path is fixed in the same commit as this file.
--
-- HOW THE OWNER IS RECOVERED
-- --------------------------
-- Not guessed: each row already names the SDR it was assigned to, and that
-- user belongs to exactly one organization. That user's org is the org the
-- lead should always have had.
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically. Run AFTER 20260805_workspaces_phase1.sql, so the
-- default workspaces already exist for step 2 to attach to.

-- Step 1 — restore the organization from the assigned user.
--
-- The two NOT EXISTS guards matter: `prospects_org_email_unique` and
-- `prospects_linkedin_assignee_unique` are both scoped by organization_id, so
-- filling that column in can collide with a row that already exists in the
-- target org. A single UPDATE hitting 23505 aborts the whole statement and
-- repairs nothing, so colliding rows are deliberately left alone and reported
-- by the query at the bottom rather than silently dropped.
UPDATE public.prospects p
SET organization_id = u.organization_id
FROM public.users u
WHERE p.assigned_to = u.id
  AND p.organization_id IS NULL
  AND u.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.prospects x
    WHERE x.organization_id = u.organization_id
      AND x.email IS NOT NULL
      AND x.email = p.email
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.prospects y
    WHERE y.organization_id = u.organization_id
      AND y.linkedin_url IS NOT NULL
      AND y.linkedin_url = p.linkedin_url
      AND y.assigned_to IS NOT DISTINCT FROM p.assigned_to
  );

-- Step 2 — now that they have an org, give them that org's default workspace,
-- exactly as 20260805_workspaces_phase1.sql did for every other prospect.
UPDATE public.prospects p
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.organization_id = p.organization_id
  AND p.workspace_id IS NULL;

-- Verify — expect zero rows. Anything returned is a lead whose repair was
-- blocked by a uniqueness collision (the same contact already exists in that
-- org) or that has no assigned user to inherit an org from. Those need a human
-- decision — most likely deletion, since a duplicate of a lead the org already
-- has is worth nothing — but this migration will not make that call.
--
--   SELECT id, name, company, assigned_to, source, created_at::date
--   FROM public.prospects
--   WHERE organization_id IS NULL
--   ORDER BY created_at;
