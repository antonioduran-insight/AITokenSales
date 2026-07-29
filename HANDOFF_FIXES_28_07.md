# Fixes del 28/07 — qué tenés que hacer

---

# ✅ LO QUE TENÉS QUE HACER VOS

Son 2 cosas. El resto lo hago yo.

### 1. Logueate en `localhost:3000` como admin

El dev server ya está corriendo. Entrá a http://localhost:3000 y logueate con la cuenta de
**admin de AITokenSales**.

Lo necesito porque `localhost` tiene cookies separadas de `vercel.app`, así que ahí no tengo
sesión — y yo no puedo tipear contraseñas. **Una vez que estés adentro, dejá la ventana
abierta y avisame: las pruebas las hago yo.**

### 2. Cuando te avise que las pruebas pasaron, commiteá

Los comandos están en la sección "Comandos de commit" más abajo. Copiás y pegás.

**No pusheé nada** — push a `main` dispara build de producción, así que eso lo decidís vos.

---

# ✔️ LO QUE YA ESTÁ HECHO (no toques nada de esto)

### Base de datos — aplicado y verificado por mí

| Qué | Resultado |
|---|---|
| El permiso que faltaba en el historial de cambios | ✅ Ahora acepta `prospect_updated` y `conversation_added` |
| Limpieza de permisos duplicados de Support | ✅ De 8 políticas a 3 |
| Hong Kong en chino de Hong Kong | ✅ `zh-HK` |
| Corrección masiva de regiones mal asignadas | ✅ **173 leads corregidos**, 0 quedan mal |

**Todo esto ya corrió. No hay ningún SQL pendiente.** Los archivos `.sql` en
`supabase/migrations/` quedan solo como registro, para que si alguna vez se reconstruye la
base desde cero se reproduzca el mismo estado.

**El de las regiones es reversible.** Guardé los valores viejos antes de tocar nada, porque
40 de esos 173 leads eran de Insight Software (cliente real) y no de la org de prueba:

```sql
-- Si algo no cuadra, revertir:
UPDATE prospects p SET area_id = b.area_id_viejo
  FROM _backup_prospect_area_28_07 b WHERE p.id = b.id;

-- Cuando estés conforme, limpiar el respaldo:
DROP TABLE _backup_prospect_area_28_07;
```

### Código — 21 archivos, compila en verde

`npm run build` pasó: TypeScript sin errores, 28/28 páginas. Lo que se arregló:

- **Historial de cambios** — antes decía "Guardado" y no registraba nada. En 711 eventos de
  historia no había ni uno de edición de campos. Ahora registra, y si falla avisa.
- **Import de CSV** — 4 bugs: el formato de combos estaba invertido contra la base, una fila
  mala mataba las otras 24, los errores se reportaban como "duplicados", y un import
  exitoso decía "estado desconocido".
- **Estadísticas** — estaban calculadas sobre 1000 leads de 1258. Y a un vendedor con
  varias regiones le escondían todas menos una.
- **Permisos** — el Global Admin podía editar leads de cualquier cliente sin querer; ahora
  entra en modo solo lectura y el middleware lo manda a su panel.
- **Drawer de leads** — el toast mentía cuando el guardado fallaba, y al cambiar el mercado
  el dueño desaparecía del selector aunque siguiera asignado.
- **Idioma** — el prompt mandaba códigos (`"in en"`) en vez de nombres de idioma, y no había
  forma de pedir chino tradicional ni portugués.

---

# ⏸️ LO QUE ESPERA UNA DECISIÓN TUYA

No es trabajo pendiente mío — necesito que elijas.

### Bridge no entrega los contactos al vendedor

Investigué los dos repos: **el paso nunca se diseñó**. El backend lo declina explícitamente
y documenta al CRM como responsable; el CRM lo implementó solo para el scraper.

El obstáculo real es que `prospects` exige una región (`area_id`) y los candidatos de Bridge
no tienen país. Tres opciones:

1. **Usar la región del vendedor asignado** ← recomendada, es lo que ya hace el import de CSV
2. Derivarla de la seed list (las viejas tienen ese dato vacío, así que no siempre funciona)
3. Adivinarla del texto de ubicación (el backend ya descartó esta vía)

**Decime cuál y lo implemento.**

### El bug de idioma sigue sin causa confirmada

Lo que hice mejora el prompt, pero **no es la causa raíz**. La evidencia no cierra:

- Canadá/USA en español **encaja** con el código crudo que arreglé.
- Taiwán **no**: ahí la instrucción ya era explícita y aun así un run salió en simplificado
  y otro en tradicional, con minutos de diferencia.

Tres pruebas para aislarlo, en orden:

1. **Repetir el mismo run de Taiwán 2-3 veces sin cambiar nada.** Si el resultado varía con
   el mismo pedido, el problema es el modelo o la proxy. Es la única que ataca el caso que
   ninguna hipótesis explica.
2. Llamar a la proxy a mano con `"in en"` contra `"English"` y comparar.
3. Comparar el prompt de Bridge (que sale bien) contra el del scraper.

**La 1 la podés correr vos desde New Run, o la corro yo si me das el OK** (gasta cupo real
de Apify).

---

# 📋 Comandos de commit

Copiá y pegá cuando te avise que las pruebas pasaron.

```bash
cd ~/AITokenSales/AITokenSales

git add src/lib/utils/audit.ts supabase/migrations/20260728_audit_log_add_missing_event_types.sql
git commit -m "Fix silent audit log: widen event_type CHECK, surface insert errors"

git add src/components/prospects/ProspectDrawer.tsx
git commit -m "Prospect drawer: stop reporting success on failed saves"

git add src/lib/types.ts src/components/import/CSVImportWizard.tsx \
        src/app/api/import/route.ts src/components/prospects/ProspectForm.tsx
git commit -m "Fix CSV import: combo_X format, icp range, per-row fallback, field allowlist"

git add src/components/stats/StatsDashboard.tsx
git commit -m "Fix stats computed over 1000 of N leads and single-area SDR filter"

git add src/lib/hooks/useOrgId.ts src/middleware.ts src/components/layout/Sidebar.tsx \
        src/components/kanban/KanbanBoard.tsx src/components/prospects/ProspectsTable.tsx
git commit -m "Scope SDR lists by org; make read-only the default for admin_global"

git add src/messages/en.json src/messages/zh.json src/messages/es.json src/messages/vi.json
git commit -m "Translate the new prospect drawer feedback messages"

git add src/app/[locale]/settings/page.tsx
git commit -m "Add Traditional/Simplified Chinese and Portuguese sender-profile options"

git add src/app/[locale]/global-admin/organizations/[id]/page.tsx \
        src/app/[locale]/support/page.tsx src/app/api/runs/route.ts \
        src/contexts/GlobalAdminThemeContext.tsx
git commit -m "Fix silent API-key save, model default drift, vendor label, ticket sound"

git add supabase/migrations/20260728_hong_kong_traditional_chinese.sql \
        supabase/migrations/20260728_backfill_prospect_area_from_market.sql \
        HANDOFF_FIXES_28_07.md
git commit -m "Add HK zh-HK migration, area backfill record and fix handoff"
```

Y en el otro repo:

```bash
cd ~/linkedin-scraper
git add api/message_generator.py
git commit -m "Send language names, not raw ISO codes, in the generation prompt"
```

> ⚠️ Antes de commitear, confirmá que `.env.local` esté en el `.gitignore`. Tiene la clave
> de service role, que saltea todos los permisos de la base.

---

# 🔧 Follow-ups técnicos (para más adelante, no urgentes)

Están detallados con archivo y línea en `testing_28_07_LOG_TECNICO.md`. Resumen:

- **Auditoría de i18n**: 25 archivos con textos en inglés. Peores: Settings (48), Support
  (34), Bridge (30).
- **Borrar `src/components/scraper/SenderProfileModal.tsx`** — 231 líneas de código muerto
  que nunca se importa, con una lista de idiomas divergente de la real. Es `git rm`, no lo
  puedo hacer yo.
- **Guard de servidor en `/zh/settings` y `/zh/stats`** para vendedores. Hoy no filtran
  datos, pero les falta la protección del lado del servidor.
- **`/zh/stats` para vendedores**: decisión de producto pendiente — el menú se lo esconde
  pero la página funciona por URL directa.
- **El truncado de 1000 filas probablemente afecta también al Kanban.**
- **Dumpear la tabla `markets` a una migración** — su contenido no está versionado en ningún
  repo.
- **Aplanar la política de permisos de los mensajes de Support** — está doblemente anidada y
  es la explicación más probable de la demora de los mensajes en vivo.
- **Migrar `middleware.ts` a `proxy.ts`** — Next.js lo marca como deprecado en cada build.

---

# 🧪 Datos de prueba que quedaron en la org

- 2 leads "TEST Limpio Uno/Dos" asignados a Lauren
- El lead **Jean-Maxime Fangous** con mercado Argentina y " TEST" en el cargo
- 1 ticket "TEST Realtime 28/07" con 3 mensajes
- 9 candidatos de Bridge confirmados y asignados a Antonio (siguen sin llegar al CRM)
- `test_import_combo_28_07.csv` y `test_import_limpio_28_07.csv` en la raíz del repo —
  **los uso para probar el import, no los borres todavía**
