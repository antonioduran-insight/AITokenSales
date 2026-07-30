-- ============================================================================
-- prospects.source: permitir 'bridge'
-- ============================================================================
--
-- Hoy los leads que llegan por Bridge se guardan con source='scraper'. No fue
-- un descuido: `bridge-assign.ts` lo documenta explícitamente — no se pudo
-- confirmar desde el repo si `prospects.source` tenía CHECK constraint, y un
-- valor rechazado habría hecho fallar todo el handoff. Se eligió el valor
-- seguro.
--
-- Verificado contra producción el 30/07/2026: el CHECK existe y es
--   source = ANY (ARRAY['manual','csv_import','scraper'])
-- así que insertar 'bridge' hubiera fallado. La cautela estaba bien fundada.
--
-- ---------------------------------------------------------------------------
-- Por qué importa distinguirlos
-- ---------------------------------------------------------------------------
-- 1. Son leads de naturaleza distinta. Un lead del scraper es un prospecto ICP
--    al que se le hace outreach en frío. Un candidato de Bridge es un contacto
--    de partnership. El SDR necesita saber cuál está mirando antes de escribir.
--
-- 2. Hay un bug latente hoy: `assignRunLeads()` en modo manual ("Send to
--    another SDR") borra prospects por (organization_id, source='scraper',
--    linkedin_url). Un prospecto de Bridge que comparta linkedin_url con un
--    lead del scraper del mismo run entra en esa barrida y se borra sin que
--    nadie lo note. Improbable — contactos de partnership contra leads ICP —
--    pero deja de ser posible una vez que los valores son distintos.
--
-- Después de correr esto hay que actualizar `bridge-assign.ts` para que use
-- 'bridge', y `Prospect['source']` en types.ts, que hoy declara solo
-- 'manual' | 'csv_import' y ya estaba desactualizado antes de este cambio.
-- ============================================================================

ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_source_check;

ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_source_check
  CHECK (source = ANY (ARRAY[
    'manual'::text,
    'csv_import'::text,
    'scraper'::text,
    'bridge'::text        -- nuevo
  ]));

-- NO se reclasifican los prospectos de Bridge ya existentes. Son
-- indistinguibles de los del scraper por definición — es precisamente el
-- problema que esta migración resuelve hacia adelante — y adivinar cuáles
-- eran de Bridge en base a heurísticas (market null, temperatura Cold)
-- reetiquetaría leads legítimos del scraper. Los históricos quedan como
-- 'scraper'; los nuevos entran correctos.

-- Verificación:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'prospects_source_check';
