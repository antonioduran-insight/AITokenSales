-- Performance: Kanban and the Prospects table both run the same query shape
-- constantly — filter by area_id (SDR-scoped views), order by created_at
-- desc, and either paginate with .range() (Prospects table) or page through
-- the whole result set 1000 rows at a time (Kanban, via fetchAllProspects).
-- Neither had a supporting index for that filter+sort combination, so
-- Postgres had to scan and sort on every single request — the same class of
-- problem already found and fixed once for `assigned_to` in
-- 20260727_prospects_assigned_to_index.sql. This is the same fix applied to
-- the two other hot filter columns.
--
-- Two separate indexes because Postgres can only use the composite index's
-- sort ordering when area_id is also filtered (SDR views); the admin/no-area-
-- filter path (org-wide Kanban view, admin's Prospects table) needs its own
-- plain index on created_at to avoid a full-table sort on every page.
--
-- Run this in the Supabase SQL editor — migrations here are not applied
-- automatically.

CREATE INDEX IF NOT EXISTS prospects_area_id_created_at
  ON prospects (area_id, created_at DESC);

CREATE INDEX IF NOT EXISTS prospects_created_at
  ON prospects (created_at DESC);
