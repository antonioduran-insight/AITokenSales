-- Multi-workspace, phase 1: data model + RLS. No behaviour change on deploy.
--
-- WHAT A WORKSPACE IS
-- -------------------
-- A site/branch inside ONE organization — an Enterprise customer with an
-- office in Taiwan and another in Hong Kong. The organization stays the top
-- level tenant; workspaces partition it internally.
--
-- Workspaces are ORTHOGONAL TO MARKETS. Two sites can work the same markets,
-- and `areas`/`markets` are untouched by this migration. A workspace answers
-- "which office does this belong to", not "which territory".
--
-- NULL MEANS ORG-WIDE, AND THAT IS THE WHOLE SAFETY STORY
-- ------------------------------------------------------
-- `users.workspace_id IS NULL` = sees every workspace in the org. That is the
-- customer's own head-office admin (distinct from the `admin_global` role,
-- which is Insight Software staff, not a customer role at all).
--
-- The backfill below therefore leaves EVERY existing user NULL. Nobody's
-- visibility changes the day this ships. Prospects do get a default workspace
-- so they belong somewhere, but since no user is scoped to one yet, no filter
-- is active. Assigning a person to a site becomes a deliberate act later.
--
-- Doing the opposite — backfilling users into the default workspace — would be
-- the single most dangerous line in this file: every admin would silently
-- become a site admin, and any org whose data landed in a different workspace
-- would look empty.
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Two sites in one org can't share a name: the picker that assigns people to
  -- a site would be ambiguous, and "Hong Kong" appearing twice is always a
  -- mistake rather than an intent.
  CONSTRAINT workspaces_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS workspaces_organization_id_idx
  ON public.workspaces (organization_id);

-- ---------------------------------------------------------------------------
-- 2. The columns
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL on both: deleting a site must never delete the people who
-- worked in it or the leads they collected. They fall back to org-wide, which
-- is visible to the head-office admin and therefore recoverable, rather than
-- disappearing.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES public.workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_workspace_id_idx
  ON public.users (workspace_id) WHERE workspace_id IS NOT NULL;

-- Paired with organization_id because every policy below filters on both.
CREATE INDEX IF NOT EXISTS prospects_org_workspace_idx
  ON public.prospects (organization_id, workspace_id);

-- ---------------------------------------------------------------------------
-- 3. my_workspace_id(), mirroring my_org_id()
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason the existing helpers are: the policies
-- on `users` need to read `users`, and a plain query there would recurse
-- through RLS. search_path is pinned to 'public' (not empty) because the body
-- references the table by bare name — exactly the treatment
-- 20260731_perf_advisor_fixes_a applied to my_role()/my_org_id().
CREATE OR REPLACE FUNCTION public.my_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM public.users WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------
-- One default site per organization, named after the org so it is
-- self-describing in a picker ("Acme", later joined by "Acme Hong Kong")
-- instead of a placeholder in a language this project would have to choose.
INSERT INTO public.workspaces (organization_id, name)
SELECT o.id, o.name
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.workspaces w WHERE w.organization_id = o.id
);

-- Existing prospects join their org's default site.
UPDATE public.prospects p
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.organization_id = p.organization_id
  AND p.workspace_id IS NULL;

-- users.workspace_id is deliberately left NULL for everyone. See the header.

-- ---------------------------------------------------------------------------
-- 5. RLS on the new table
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Anyone in the org can READ the list — an SDR's own site has to render
-- somewhere, and the row holds nothing sensitive.
DROP POLICY IF EXISTS workspaces_select ON public.workspaces;
CREATE POLICY workspaces_select ON public.workspaces
  FOR SELECT USING (
    (SELECT my_role()) = 'admin_global'
    OR organization_id = (SELECT my_org_id())
  );

-- Only the org-wide admin (workspace_id IS NULL) may create, rename or
-- deactivate sites. A site admin managing sites would be able to create one
-- and move themselves into it, which defeats the partition.
DROP POLICY IF EXISTS workspaces_write ON public.workspaces;
CREATE POLICY workspaces_write ON public.workspaces
  FOR ALL USING (
    (SELECT my_role()) = 'admin'
    AND organization_id = (SELECT my_org_id())
    AND (SELECT my_workspace_id()) IS NULL
  );

-- ---------------------------------------------------------------------------
-- 6. Existing policies: extend the `admin` branch only
-- ---------------------------------------------------------------------------
-- ALTER POLICY, not DROP + CREATE. ALTER changes only the clause named, so
-- anything not inspected while writing this (for instance a separate WITH
-- CHECK on an UPDATE policy) is preserved untouched. Recreating from scratch
-- would silently drop whatever wasn't reproduced here.
--
-- The SDR branch (`assigned_to = auth.uid()`) is deliberately NOT modified:
-- a lead assigned to a Taiwan rep is already invisible to everyone else, so
-- site scoping adds nothing and every edit here is a chance to break access
-- for the role that uses the CRM most.

ALTER POLICY prospects_select ON public.prospects
  USING (
    (SELECT my_role()) = 'admin_global'
    OR (
      (SELECT my_role()) = 'admin'
      AND organization_id = (SELECT my_org_id())
      AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
    )
    OR (assigned_to = (SELECT auth.uid()) AND organization_id = (SELECT my_org_id()))
  );

ALTER POLICY prospects_update ON public.prospects
  USING (
    (SELECT my_role()) = 'admin_global'
    OR (
      (SELECT my_role()) = 'admin'
      AND organization_id = (SELECT my_org_id())
      AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
    )
    OR (assigned_to = (SELECT auth.uid()) AND organization_id = (SELECT my_org_id()))
  );

ALTER POLICY prospects_delete ON public.prospects
  USING (
    (SELECT my_role()) = 'admin_global'
    OR (
      (SELECT my_role()) = 'admin'
      AND organization_id = (SELECT my_org_id())
      AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
    )
  );

ALTER POLICY prospects_insert ON public.prospects
  WITH CHECK (
    (SELECT my_role()) = 'admin_global'
    OR (
      (SELECT my_role()) = 'admin'
      AND organization_id = (SELECT my_org_id())
      AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
    )
  );

-- users: the column lives on the row being checked, so a site admin sees and
-- manages only their own site's people. The `id = auth.uid()` branch stays so
-- everyone can always read themselves regardless of site.
ALTER POLICY users_select ON public.users
  USING (
    (SELECT my_role()) = 'admin_global'
    OR (
      (SELECT my_role()) = 'admin'
      AND organization_id = (SELECT my_org_id())
      AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
    )
    OR id = (SELECT auth.uid())
  );

ALTER POLICY users_update ON public.users
  USING (
    (SELECT my_role()) = 'admin'
    AND organization_id = (SELECT my_org_id())
    AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
  );

ALTER POLICY users_delete ON public.users
  USING (
    (SELECT my_role()) = 'admin'
    AND organization_id = (SELECT my_org_id())
    AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
  );

ALTER POLICY users_insert ON public.users
  WITH CHECK (
    (SELECT my_role()) = 'admin'
    AND organization_id = (SELECT my_org_id())
    AND ((SELECT my_workspace_id()) IS NULL OR workspace_id = (SELECT my_workspace_id()))
  );

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- 1. One workspace per org, and every prospect placed in one:
--
--    SELECT (SELECT count(*) FROM organizations)                       AS orgs,
--           (SELECT count(*) FROM workspaces)                          AS workspaces,
--           (SELECT count(*) FROM prospects WHERE workspace_id IS NULL) AS prospects_sin_sede,
--           (SELECT count(*) FROM users WHERE workspace_id IS NOT NULL) AS usuarios_con_sede;
--
--    Expect: orgs = workspaces, prospects_sin_sede = 0, usuarios_con_sede = 0.
--    That last zero is the point — nobody is scoped yet, so nothing filters.
--
-- 2. The helper resolves without recursing:
--
--    SELECT public.my_workspace_id();   -- NULL for every current user
--
-- 3. Policies carry the new clause:
--
--    SELECT policyname, cmd FROM pg_policies
--    WHERE tablename IN ('prospects','users') AND qual::text LIKE '%my_workspace_id%';
