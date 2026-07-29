-- ============================================================
-- BACKFILL — recalcular prospects.area_id desde prospects.market
--
-- ⚠️  NO CORRER A CIEGAS. Este archivo reescribe datos reales.
--     Corré primero el PASO 1 (solo lectura) y mirá el resultado.
--
-- QUÉ ARREGLA
-- QA-F25 (leads asignados al área equivocada) ya está corregido en
-- el código: assignRunLeads() ahora deriva el área del mercado real
-- del run en vez del campo estático del SDR. Pero el fix NO es
-- retroactivo y nadie corrigió los datos viejos.
--
-- Medido en producción (28/07), en el tablero de un SDR con 3 áreas:
-- ~217 leads marcados 'latin_america' que claramente no lo son —
-- 薈智創新科技 IIoTFab (Taiwán), MICROIP (Taiwán), 金寶集團 KINPO
-- GROUP (Taiwán), Audi Taiwan, CloudMosa "Taiwan Branch",
-- City Administration of Kirchheim unter Teck (Alemania),
-- NetSupport Software Limited (UK). Solo 2 de ~224 tarjetas
-- mostraban Europa y ninguna Asia.
--
-- Consecuencia: el filtro por área del SDR es inservible (filtrar
-- por Asia no devuelve ninguno de sus leads taiwaneses) y el badge
-- de área miente en cada tarjeta.
--
-- CÓMO RESUELVE EL ÁREA
-- Dos vías, en orden:
--   1) prospects.market coincide con markets.name (un país real)
--      -> se usa markets.region
--   2) prospects.market es un NOMBRE DE REGIÓN ('Asia', 'USA',
--      'Latin America', 'Europe') -> se usa directo
--
-- La vía 2 es necesaria porque los runs multi-país NO guardan el
-- país: guardan el label de la región (apify_scraper.py:797,
-- region_label(resolved_markets[0]["region"])), porque el actor no
-- dice de qué país vino cada lead. Verificado: hay leads con
-- market='Asia' y market='USA', valores que NO existen en `markets`.
--
-- LO QUE NO TOCA (a propósito)
--   - Leads con market NULL o vacío: no hay nada de dónde inferir.
--   - Leads cuyo market no resuelve por ninguna de las dos vías.
--   - Leads cuyo área ya es la correcta.
--   - assigned_to: NO se reasigna a nadie. Un lead puede quedar en
--     un área que su dueño actual no cubre; eso es deliberado —
--     mover leads entre vendedores es una decisión de negocio, no
--     de una migración. El drawer ahora avisa de esa inconsistencia
--     en vez de esconderla (antes mostraba "sin asignar", falso).
-- ============================================================


-- ------------------------------------------------------------
-- PASO 1 — PREVIEW (solo lectura). Corré esto primero.
-- Te dice cuántas filas se van a tocar y de qué área a qué área.
-- ------------------------------------------------------------
WITH resolved AS (
  SELECT p.id,
         p.market,
         p.area_id                AS area_actual,
         a_old.name               AS area_actual_nombre,
         COALESCE(m.region, r.name) AS region_derivada,
         a_new.id                 AS area_nueva
    FROM public.prospects p
    LEFT JOIN public.areas  a_old ON a_old.id = p.area_id
    LEFT JOIN public.markets m    ON lower(m.name) = lower(p.market)
    LEFT JOIN public.areas  r     ON lower(replace(r.name, '_', ' ')) = lower(p.market)
    LEFT JOIN public.areas  a_new ON a_new.name = COALESCE(m.region, r.name)
   WHERE p.market IS NOT NULL
     AND p.market <> ''
)
SELECT area_actual_nombre AS de,
       region_derivada    AS a,
       count(*)           AS filas,
       min(market)        AS ejemplo_market
  FROM resolved
 WHERE area_nueva IS NOT NULL
   AND area_nueva <> area_actual
 GROUP BY 1, 2
 ORDER BY filas DESC;


-- ------------------------------------------------------------
-- PASO 2 — el UPDATE. Corré esto SOLO si el preview tiene sentido.
-- ------------------------------------------------------------
-- UPDATE public.prospects p
--    SET area_id = sub.area_nueva
--   FROM (
--     SELECT p2.id,
--            a_new.id AS area_nueva
--       FROM public.prospects p2
--       LEFT JOIN public.markets m   ON lower(m.name) = lower(p2.market)
--       LEFT JOIN public.areas   r   ON lower(replace(r.name, '_', ' ')) = lower(p2.market)
--       LEFT JOIN public.areas  a_new ON a_new.name = COALESCE(m.region, r.name)
--      WHERE p2.market IS NOT NULL
--        AND p2.market <> ''
--        AND a_new.id IS NOT NULL
--        AND a_new.id <> p2.area_id
--   ) AS sub
--  WHERE p.id = sub.id;


-- ------------------------------------------------------------
-- PASO 3 — verificación posterior. Cuántos quedan sin resolver
-- y por qué (para decidir si vale un segundo pase manual).
-- ------------------------------------------------------------
-- SELECT COALESCE(NULLIF(p.market, ''), '(vacío/null)') AS market_sin_resolver,
--        count(*) AS filas
--   FROM public.prospects p
--   LEFT JOIN public.markets m ON lower(m.name) = lower(p.market)
--   LEFT JOIN public.areas   r ON lower(replace(r.name, '_', ' ')) = lower(p.market)
--  WHERE COALESCE(m.region, r.name) IS NULL
--  GROUP BY 1
--  ORDER BY filas DESC;
