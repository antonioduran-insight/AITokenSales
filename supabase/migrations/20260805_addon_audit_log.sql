-- Internal trail of add-on activations and deactivations.
--
-- Turning an add-on on or off is a billing event with real money attached
-- ($300/mo for Multi-workspace, for instance) and it left no trace anywhere:
-- "who enabled this, and when" was unanswerable. `organization_addons` only
-- holds current state — flipping is_active back and forth overwrites history.
--
-- DELIBERATELY NOT `audit_log`: that table is org-scoped, its RLS lets an
-- org's own admin read it, and it is rendered in the customer-facing
-- /audit page whose event vocabulary is entirely prospect and SDR lifecycle.
-- Add-on changes are performed by Insight Software staff, not by anyone on
-- the customer's team, so they belong in an internal-only table rather than
-- mixed into a feed the customer reads.
--
-- RUN THIS BY HAND in the Supabase SQL editor: migrations in this repo are
-- NOT applied automatically.

CREATE TABLE IF NOT EXISTS public.addon_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The org the add-on was changed FOR (not the actor's org — admin_global
  -- has none). ON DELETE CASCADE: if the org is gone there is no billing
  -- question left to answer about it.
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  addon_type text NOT NULL,
  action text NOT NULL CHECK (action IN ('activated', 'deactivated')),

  -- Actor is nullable and NOT a foreign key on purpose: the trail has to
  -- outlive the staff account that performed the action. A FK with ON DELETE
  -- SET NULL would work, but deleting a user would then quietly erase who did
  -- what — the name snapshot below is the durable record.
  actor_id uuid,
  actor_name text,

  -- Snapshot of the price at the moment of the change. `organization_addons`
  -- holds only the current value, so without this a later repricing would
  -- rewrite what past activations appear to have cost.
  price_monthly numeric,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- The one query this table exists to serve: an org's add-on history, newest
-- first, shown on that org's Global Admin detail page.
CREATE INDEX IF NOT EXISTS addon_audit_log_org_created_idx
  ON public.addon_audit_log (organization_id, created_at DESC);

ALTER TABLE public.addon_audit_log ENABLE ROW LEVEL SECURITY;

-- admin_global only. Writes go through the service-role client, which
-- bypasses RLS entirely, so no INSERT policy is needed — and not having one
-- means a compromised session client cannot forge trail entries.
DROP POLICY IF EXISTS "admin_global reads addon audit" ON public.addon_audit_log;
CREATE POLICY "admin_global reads addon audit" ON public.addon_audit_log
  FOR SELECT USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin_global'
  );

-- No addon_type CHECK here, on purpose. `organization_addons.addon_type` has
-- one, and CLAUDE.md documents that constraint being missed twice when new
-- add-ons shipped. A history table that rejects a row because the vocabulary
-- moved on would lose the very event it exists to record — the current-state
-- table is the right place to enforce what is valid.

-- Verify:
--   SELECT * FROM public.addon_audit_log ORDER BY created_at DESC LIMIT 20;
