-- ============================================================
-- Drop duplicate/superseded RLS policies on support_tickets and
-- support_ticket_messages, left behind when 20260707_support_fix.sql
-- added broader policies (covering the 'support' role) without
-- removing the originals from 20260702_settings.sql. Postgres
-- evaluates same-command policies with OR, so both generations
-- have been coexisting harmlessly — this is a cleanup, not a
-- behavior fix.
--
-- Verified before writing this migration that the 3 policies kept
-- below are a strict superset of the 5 dropped here: every access
-- case the old ones granted (an org member reading/creating their
-- own org's tickets, admin_global's full cross-org access) is
-- preserved identically. The only differences are two widenings
-- that already match the app's actual current behavior, not new
-- gaps introduced by this migration:
--   - Ticket creation is no longer restricted to role = 'admin' at
--     the RLS layer — matches the API route (no such restriction)
--     and the UI, which already lets SDRs file their own tickets.
--   - The 'support' role gets the same cross-org access admin_global
--     already had — the entire point of 20260707_support_fix.sql.
--
-- In practice this only affects Realtime `postgres_changes` event
-- visibility (the two subscriptions in support/page.tsx) — every
-- actual read/write to these tables goes through /api/support/*
-- routes using the service-role admin client, which bypasses RLS
-- entirely.
-- ============================================================

DROP POLICY IF EXISTS "admin creates own org tickets" ON support_tickets;
DROP POLICY IF EXISTS "admin reads own org tickets" ON support_tickets;
DROP POLICY IF EXISTS "admin_global full access on support_tickets" ON support_tickets;

DROP POLICY IF EXISTS "ticket participants can read messages" ON support_ticket_messages;
DROP POLICY IF EXISTS "ticket participants can insert messages" ON support_ticket_messages;

-- Kept, untouched (listed here only for reference — not re-created,
-- already live from 20260707_support_fix.sql):
--   support_tickets: "org members can manage their tickets"
--   support_ticket_messages: "org members can read ticket messages"
--   support_ticket_messages: "org members can insert ticket messages"
