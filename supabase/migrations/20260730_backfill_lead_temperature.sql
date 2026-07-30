-- ============================================================================
-- Reparar la temperatura de los leads históricos
-- ============================================================================
--
-- CAUSA
-- `api/job_runner.py` calculaba el tier del scorer (`icp_tier` = HOT/WARM/COLD),
-- lo contaba para la línea de log "Scored: N HOT, N WARM, N COLD"... y no lo
-- escribía en el insert a `scraper_leads`. La columna `temperature` existe
-- desde 20260708_scraper_leads.sql, pero siempre quedó NULL.
--
-- Después, al pasar leads a prospects, el CRM hace:
--     lead_temperature: tempMap[lead.temperature?.toUpperCase() ?? ''] ?? 'Cold'
-- y NULL no matchea ninguna clave, así que TODOS los leads entraron como
-- 'Cold' sin importar cómo hubieran puntuado. Nada falló y el resumen del run
-- mostraba el reparto correcto, que es por qué parecía un problema de la
-- pantalla y no de datos que nunca se guardaron.
--
-- POR QUÉ SE PUEDE REPARAR
-- `icp_score` sí se guardó siempre, en las dos tablas. El tier es una función
-- pura del score, así que se recalcula exactamente igual que en el backend.
-- Umbrales de scraper/icp_scorer.py:
--     HOT_THRESHOLD  = 70   -> score >= 70
--     WARM_THRESHOLD = 50   -> score >= 50
--     resto                 -> COLD
--
-- Un lead sin `icp_score` queda como está: no hay forma de derivar su tier y
-- adivinarlo sería inventar datos.
-- ============================================================================

-- 1. scraper_leads: rellenar la columna que nunca se escribió.
UPDATE public.scraper_leads
   SET temperature = CASE
         WHEN icp_score >= 70 THEN 'HOT'
         WHEN icp_score >= 50 THEN 'WARM'
         ELSE 'COLD'
       END
 WHERE temperature IS NULL
   AND icp_score IS NOT NULL;

-- 2. prospects: corregir los que quedaron 'Cold' por el NULL de arriba.
--
--    Sólo se tocan los de origen 'scraper' — un lead manual o de CSV import
--    puede estar en Cold porque alguien lo puso así a mano, y eso es un dato
--    legítimo que no hay que pisar.
--
--    Se limita a los que HOY dicen 'Cold': si alguien ya corrigió un lead a
--    mano a Hot/Warm, esa decisión humana gana sobre el score.
UPDATE public.prospects
   SET lead_temperature = CASE
         WHEN icp_score >= 70 THEN 'Hot'
         WHEN icp_score >= 50 THEN 'Warm'
         ELSE 'Cold'
       END
 WHERE source = 'scraper'
   AND icp_score IS NOT NULL
   AND lead_temperature = 'Cold';

-- Verificación — el reparto debería dejar de ser 100% Cold:
--   select lead_temperature, count(*) from public.prospects
--    where source = 'scraper' group by 1 order by 2 desc;
