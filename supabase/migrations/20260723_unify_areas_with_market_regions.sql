-- ============================================================
-- Unify SDR areas with the 4 market regions
-- ============================================================
-- Before: areas.name = 'taiwan' | 'latam' | 'vietnam' | 'europe'
-- After:  areas.name = 'asia'   | 'latin_america' | 'europe' | 'usa'
--         (identical to markets.region, so the two systems finally match)
--
-- taiwan + vietnam -> asia (merged) · latam -> latin_america
-- europe stays (activated) · usa is new
--
-- The area is NOT text on user_areas — it is a uuid FK to areas(id), so the
-- merge repoints FKs to the surviving row and renames it. No per-user rewrite.
--
-- Wrapped in a transaction: if any step fails, nothing is applied.
-- Idempotent: re-running after a successful run is a no-op.

BEGIN;

-- Real UUIDs for this project
--   europe  6f61ed0c-219d-495f-931d-8a5d53866f9a
--   latam   0c77b667-e514-4613-88f9-c22cd77e7e07
--   taiwan  9a7a85aa-25a6-41c8-925f-3a1c6e771a69  <- survives, becomes 'asia'
--   vietnam 59ada6aa-7ebc-41f9-a70c-db1a752a35a9  <- merged away, deleted

-- ------------------------------------------------------------
-- 1. Repoint user_areas: vietnam -> taiwan
--    The WHERE NOT EXISTS protects UNIQUE (user_id, area_id) for any SDR
--    that already holds taiwan. (Confirmed today: no such SDR — this is
--    just belt-and-braces so the script is safe to re-run.)
-- ------------------------------------------------------------
UPDATE user_areas ua
   SET area_id = '9a7a85aa-25a6-41c8-925f-3a1c6e771a69'
 WHERE ua.area_id = '59ada6aa-7ebc-41f9-a70c-db1a752a35a9'
   AND NOT EXISTS (
     SELECT 1 FROM user_areas x
      WHERE x.user_id = ua.user_id
        AND x.area_id = '9a7a85aa-25a6-41c8-925f-3a1c6e771a69'
   );

-- Any row left pointing at vietnam was a duplicate skipped above — drop it.
DELETE FROM user_areas
 WHERE area_id = '59ada6aa-7ebc-41f9-a70c-db1a752a35a9';

-- ------------------------------------------------------------
-- 2. Repoint the SDR's primary area on the user record
-- ------------------------------------------------------------
UPDATE users
   SET area_id = '9a7a85aa-25a6-41c8-925f-3a1c6e771a69'
 WHERE area_id = '59ada6aa-7ebc-41f9-a70c-db1a752a35a9';

-- ------------------------------------------------------------
-- 2b. Repoint the OTHER foreign keys to areas(id)
--     NOT in the original step list, but prospects.area_id and
--     csv_import_sessions.area_id also reference areas(id) — without these
--     the DELETE in step 3 fails with a foreign-key violation.
-- ------------------------------------------------------------
UPDATE prospects
   SET area_id = '9a7a85aa-25a6-41c8-925f-3a1c6e771a69'
 WHERE area_id = '59ada6aa-7ebc-41f9-a70c-db1a752a35a9';

-- Guarded: this table may not exist in every environment.
DO $$
BEGIN
  IF to_regclass('public.csv_import_sessions') IS NOT NULL THEN
    UPDATE csv_import_sessions
       SET area_id = '9a7a85aa-25a6-41c8-925f-3a1c6e771a69'
     WHERE area_id = '59ada6aa-7ebc-41f9-a70c-db1a752a35a9';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Delete the now-unreferenced vietnam row
-- ------------------------------------------------------------
DELETE FROM areas
 WHERE id = '59ada6aa-7ebc-41f9-a70c-db1a752a35a9';

-- ------------------------------------------------------------
-- 4. taiwan -> asia
-- ------------------------------------------------------------
UPDATE areas
   SET name      = 'asia',
       label_en  = 'Asia',
       label_zh  = '亞洲',
       label_vi  = 'Châu Á',
       label_es  = 'Asia',
       is_active = true
 WHERE id = '9a7a85aa-25a6-41c8-925f-3a1c6e771a69';

-- ------------------------------------------------------------
-- 5. latam -> latin_america
-- ------------------------------------------------------------
UPDATE areas
   SET name      = 'latin_america',
       label_en  = 'Latin America',
       label_zh  = '拉丁美洲',
       label_vi  = 'Mỹ Latinh',
       label_es  = 'Latinoamérica',
       is_active = true
 WHERE id = '0c77b667-e514-4613-88f9-c22cd77e7e07';

-- ------------------------------------------------------------
-- 6. Activate europe
-- ------------------------------------------------------------
UPDATE areas
   SET is_active = true,
       label_en  = 'Europe'
 WHERE id = '6f61ed0c-219d-495f-931d-8a5d53866f9a';

-- ------------------------------------------------------------
-- 7. Create usa (no UUID yet — new row)
-- ------------------------------------------------------------
INSERT INTO areas (name, label_en, label_zh, label_vi, label_es, is_active)
SELECT 'usa', 'USA', '美國', 'Hoa Kỳ', 'EE. UU.', true
 WHERE NOT EXISTS (SELECT 1 FROM areas WHERE name = 'usa');

COMMIT;

-- ============================================================
-- Verification (run after COMMIT)
-- ============================================================
-- Expect exactly 4 rows: asia, europe, latin_america, usa — all is_active
-- SELECT id, name, label_en, is_active FROM areas ORDER BY name;
--
-- Expect 0 — no SDR left without an area
-- SELECT COUNT(*) FROM users WHERE role='sdr' AND is_active AND area_id IS NULL;
--
-- Expect 0 — no dangling FK anywhere
-- SELECT COUNT(*) FROM user_areas ua LEFT JOIN areas a ON a.id=ua.area_id WHERE a.id IS NULL;
-- SELECT COUNT(*) FROM prospects  p LEFT JOIN areas a ON a.id=p.area_id  WHERE p.area_id IS NOT NULL AND a.id IS NULL;
--
-- Expect the SDR counts to have moved: vietnam's 1 SDR now sits under asia
-- SELECT a.name, COUNT(DISTINCT ua.user_id) AS sdrs
--   FROM user_areas ua JOIN areas a ON a.id=ua.area_id
--   JOIN users u ON u.id=ua.user_id AND u.role='sdr' AND u.is_active
--  GROUP BY a.name ORDER BY a.name;
