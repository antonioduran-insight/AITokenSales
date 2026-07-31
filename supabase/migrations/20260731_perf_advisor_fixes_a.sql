-- ============================================================================
-- Performance Advisor fixes — batch A (safe, additive, no behavior change)
-- ============================================================================
-- Sourced directly from the Supabase Performance/Security Advisor CSV export
-- (31/07). Everything here is either a new index (CREATE INDEX IF NOT EXISTS
-- — additive, nothing can break) or pinning a mutable search_path on an
-- existing function to its current effective value (public) — same behavior,
-- just closes the "search_path could be hijacked by the calling session"
-- warning. Nothing here touches RLS policies or changes what any query
-- returns. Batch B (RLS consolidation) is separate and reviewed on its own.
--
-- Run this in the Supabase SQL editor.
-- ============================================================================

-- ── 1. Missing indexes on foreign keys ──────────────────────────────────────
-- Every one of these showed up in the advisor as "foreign key without a
-- covering index" — Postgres has to scan the whole table for any join,
-- ON DELETE CASCADE check, or lookup by that column without one. Column
-- names below are read from each table's actual REFERENCES clause in
-- supabase/migrations, not guessed from the constraint name.

CREATE INDEX IF NOT EXISTS areas_organization_id_idx ON public.areas (organization_id);

CREATE INDEX IF NOT EXISTS audit_log_actor_id_idx ON public.audit_log (actor_id);
CREATE INDEX IF NOT EXISTS audit_log_organization_id_idx ON public.audit_log (organization_id);
CREATE INDEX IF NOT EXISTS audit_log_prospect_id_idx ON public.audit_log (prospect_id);

CREATE INDEX IF NOT EXISTS bridge_candidates_assigned_to_idx ON public.bridge_candidates (assigned_to);
CREATE INDEX IF NOT EXISTS bridge_candidates_seed_list_id_idx ON public.bridge_candidates (seed_list_id);

CREATE INDEX IF NOT EXISTS bridge_runs_organization_id_idx ON public.bridge_runs (organization_id);
CREATE INDEX IF NOT EXISTS bridge_runs_seed_list_id_idx ON public.bridge_runs (seed_list_id);

CREATE INDEX IF NOT EXISTS bridge_seed_lists_organization_id_idx ON public.bridge_seed_lists (organization_id);

CREATE INDEX IF NOT EXISTS conversations_organization_id_idx ON public.conversations (organization_id);

CREATE INDEX IF NOT EXISTS csv_import_sessions_area_id_idx ON public.csv_import_sessions (area_id);
CREATE INDEX IF NOT EXISTS csv_import_sessions_imported_by_idx ON public.csv_import_sessions (imported_by);
CREATE INDEX IF NOT EXISTS csv_import_sessions_organization_id_idx ON public.csv_import_sessions (organization_id);

CREATE INDEX IF NOT EXISTS notes_author_id_idx ON public.notes (author_id);
CREATE INDEX IF NOT EXISTS notes_organization_id_idx ON public.notes (organization_id);
CREATE INDEX IF NOT EXISTS notes_prospect_id_idx ON public.notes (prospect_id);

CREATE INDEX IF NOT EXISTS org_combos_combo_code_idx ON public.org_combos (combo_code);

CREATE INDEX IF NOT EXISTS organization_addons_organization_id_idx ON public.organization_addons (organization_id);

CREATE INDEX IF NOT EXISTS organization_markets_market_id_idx ON public.organization_markets (market_id);

CREATE INDEX IF NOT EXISTS prospects_created_by_idx ON public.prospects (created_by);

CREATE INDEX IF NOT EXISTS run_sdr_assignments_sender_profile_id_idx ON public.run_sdr_assignments (sender_profile_id);

CREATE INDEX IF NOT EXISTS runs_executed_by_idx ON public.runs (executed_by);

CREATE INDEX IF NOT EXISTS support_ticket_messages_created_by_idx ON public.support_ticket_messages (created_by);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_id_idx ON public.support_ticket_messages (ticket_id);

CREATE INDEX IF NOT EXISTS support_tickets_assigned_to_idx ON public.support_tickets (assigned_to);
CREATE INDEX IF NOT EXISTS support_tickets_created_by_idx ON public.support_tickets (created_by);
CREATE INDEX IF NOT EXISTS support_tickets_organization_id_idx ON public.support_tickets (organization_id);

CREATE INDEX IF NOT EXISTS user_areas_area_id_idx ON public.user_areas (area_id);

CREATE INDEX IF NOT EXISTS users_area_id_idx ON public.users (area_id);
CREATE INDEX IF NOT EXISTS users_organization_id_idx ON public.users (organization_id);

-- ── 2. Function Search Path Mutable ─────────────────────────────────────────
-- Pin search_path to 'public' on each flagged function. Without this, the
-- session calling the function controls search_path, which for a
-- SECURITY DEFINER function (my_role/my_org_id, both run with the
-- privileges of the function's owner) is a real privilege-escalation vector
-- — a caller could set search_path to a schema containing a same-named
-- decoy table/function and have it silently substituted. Set to 'public'
-- specifically (not empty) because these bodies reference tables by their
-- bare name (e.g. `monthly_lead_counts`, not `public.monthly_lead_counts`)
-- — an empty search_path would break them outright.

ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.my_role() SET search_path = public;
ALTER FUNCTION public.my_org_id() SET search_path = public;
ALTER FUNCTION public.update_monthly_lead_counts_updated_at() SET search_path = public;
ALTER FUNCTION public.increment_monthly_leads(uuid, varchar, integer) SET search_path = public;
ALTER FUNCTION public.delete_old_leads() SET search_path = public;
