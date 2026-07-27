-- ============================================================
-- Enable Realtime on support_tickets so new tickets and status
-- changes show up live in the Support UI without a page reload.
-- support_ticket_messages was already added to the publication in
-- 20260707_support_fix.sql; support_tickets itself never was.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'support_tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE support_tickets;
  END IF;
END $$;
