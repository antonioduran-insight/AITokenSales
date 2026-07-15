-- BD channel-contact prospects have exactly one owner (unlike individual
-- leads, which are visible to every SDR in their assigned area today).
-- This RESTRICTIVE policy narrows whatever permissive SELECT/UPDATE/DELETE
-- policies already exist on prospects, without needing to know or touch
-- their exact definitions: for the sdr role specifically, bd_channel_contact
-- rows are only visible/writable when assigned_to = auth.uid(). Ordinary
-- individual-lead rows, and every other role (admin, admin_global, support),
-- are completely unaffected — restrictive policies AND with the existing
-- permissive ones, they don't replace them.
DROP POLICY IF EXISTS "sdr bd_channel_contact rows owner-only" ON prospects;
CREATE POLICY "sdr bd_channel_contact rows owner-only" ON prospects
  AS RESTRICTIVE
  FOR ALL
  USING (
    lead_type != 'bd_channel_contact'
    OR assigned_to = auth.uid()
    OR (SELECT role FROM users WHERE id = auth.uid()) != 'sdr'
  );
