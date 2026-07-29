# Log técnico — Sesión de testing 28/07 (pasada source-level)

Prefijo de IDs: **`T28-##`** (nuevo, para no colisionar con `QA-F##`).

**Alcance de esta pasada:** verificación 100% en código fuente de ambos repos
(`AITokenSales-main` = CRM Next.js, `linkedin-scraper-main` = backend Python).
Ninguno de los dos snapshots tiene historial git, así que no hay changelog que
diffear — todo lo de abajo se leyó del código actual.

**Lo que esta pasada NO puede decidir:** nada que dependa del *estado de la base
de datos* o de *qué está desplegado*. Eso incluye el eslabón más importante del
P1 (`markets.default_language`) y qué migraciones se corrieron. Marcado
explícitamente como `REQUIERE SUPABASE` / `REQUIERE VERCEL-RAILWAY` en cada caso.

Convención de estado:
- **CONFIRMADO** — leído en el código, sin ambigüedad.
- **REQUIERE <acceso>** — la causa raíz está identificada pero el valor real no es visible desde el repo.
- **SOSPECHOSO** — hipótesis con base, no verificada.

---

## Sección 1 — P1: idioma de los mensajes generados

### Resumen de la cadena de resolución (tal como está hoy en el código)

```
CRM: SenderProfileModal → POST /api/sender-profiles → sender_profiles.language (nullable)
CRM: POST /api/runs (route.ts:126-130) → language: profile.language ?? null → backend
BE:  job_runner.py:248 → get_market_languages(run_request.markets) → dict {país: default_language}
BE:  message_generator.py:300 → _resolve_language(language, lead_market, sender_profile, market_languages)
BE:  message_generator.py:52  → _language_instruction() → texto del prompt
```

`_resolve_language()` (message_generator.py:58-89):
1. Si hay sender profile **y** `language is not None` → gana el perfil (incluido un `'en'` explícito).
2. Si no → idioma de `markets.default_language` del país del lead.
3. Si no matchea → `DEFAULT_LANGUAGE = 'en'`.

**La lógica es correcta.** El fix de código está bien hecho y bien comentado.

> # 🔄 ACTUALIZACIÓN 29/07 — dos hipótesis más caídas, y qué queda
>
> **1. El modelo NUNCA cambió.** Frank confirmó que `claude-sonnet-5` siempre estuvo
> configurado en Global Admin; el commit `bfce308` solo alineó el default del repo con
> lo que la base ya tenía. **Se cae la correlación de "el modelo cambió 54 minutos
> antes de los runs malos"** — no hubo cambio de modelo. Era un artefacto de leer el
> git en vez de la configuración real, el mismo error de método que ya me pasó dos
> veces en esta sesión.
>
> **2. No pude reproducir el bug.** Corrí 2 runs de Taiwán (`1ccf7754` y `8c6a07e2`,
> más `IT Manager/CIO`): **4 leads, los 4 en tradicional correcto, cero caracteres
> simplificados** (medido sobre el texto de los mensajes, filtrando los nombres de
> empresa para no contaminar la cuenta). No reproducido ≠ arreglado.
>
> **Limitación del experimento, importante:** la **deduplicación** impide repetir la
> misma configuración — el segundo run de Taiwán + CTO/VP Engineering devolvió **0
> leads** porque esos ya estaban vistos. Hay que variar el combo para obtener muestras
> nuevas, y eso agota los combos disponibles por mercado rápido.
>
> **Estado del descarte:** `markets` ✅ correcto · perfiles en NULL ✅ · Railway con el
> fix ✅ · prompt (para Taiwán ya era prosa completa) ✅ · **modelo sin cambios** ✅ ·
> company context en inglés ✅ · style hints en inglés ✅.
>
> **Queda una sola explicación en pie: no-determinismo del modelo o de la proxy**, sin
> ningún cambio de configuración que lo dispare. Encaja con la evidencia: dos runs de
> Taiwán minutos aparte con prompt idéntico dieron scripts distintos, y ahora 4 muestras
> seguidas salieron bien. No pasa siempre; pasa a veces.
>
> **Sin testear todavía:** el caso **USA/Canadá en español**, que era el más
> contundente (todos los leads de un SDR en español, no un caso borde). Solo re-testeé
> Taiwán. Frank lo prueba por su lado.
>
> ---

> # ⛔ VEREDICTO FINAL DEL P1 (28/07, verificado en producción con datos de hoy)
>
> **El P1 NO está resuelto, y el fix que se shipeó ataca la capa equivocada.**
> Toda la cadena de resolución de idioma funciona correctamente. El problema es que
> **el modelo no obedece la instrucción de idioma del prompt.** Ver T28-00 abajo.
> Lo que sigue en esta sección documenta cómo se llegó ahí; las hipótesis T28-01,
> T28-01c, T28-02 y T28-03 fueron todas refutadas en el camino.

### T28-00 · **P1 REAL** · El modelo ignora la instrucción de idioma — CONFIRMADO EN PRODUCCIÓN

**La prueba：dos runs de hoy, mismos dos países, orden invertido, prompt idéntico,
resultado distinto.**

| Run | markets | Resolución (según logs) | Idioma del prompt | Output real |
|---|---|---|---|---|
| `51e22fbd` 13:34 | `['Taiwan','Hong Kong']` | 9 por location, 1 fallback → `Taiwan` → `zh-TW` | *"Traditional Chinese (繁體中文), as used in Taiwan"* | **SIMPLIFICADO** ❌ (Liju: 谢方您好, 关注到您在, 连接) |
| `3fc2c8b2` 13:36 | `['Hong Kong','Taiwan']` | 4 por location, 0 fallback → `zh-TW` | *idéntico* | **TRADICIONAL** ✅ (Lauren: 你好, 來自, 謝謝通過) |
| `4ff03ca6` 13:06 | `['Canada','United States']` | 8 por location, 3 fallback → ambos `en` | `"in en"` | **ESPAÑOL** ❌ (Nicolas: *"Hola Mike, vi tu trabajo liderando…"*) |

En el caso de Taiwan la instrucción es **prosa explícita e inequívoca en inglés**, no
un código ambiguo — y aun así vuelve en el script equivocado la mitad de las veces.
Eso descarta cualquier explicación basada en el texto del prompt.

**Todo lo upstream fue verificado y está correcto:**

1. **Railway tiene el código corregido.** La línea de log
   `"Language resolution: N leads resolved by location, M used region fallback"`
   solo existe en el `apify_scraper.py` arreglado (líneas 983-985). Confirmado en los
   tres runs. *(Esto cierra la tarea de verificar el deploy del backend.)*
2. **Vercel tiene el fix del CRM.** Deploy de producción `ffdc82d`
   *"Stop coalescing sender_profiles.language to 'en' when unset (QA-P1)"*, Ready.
3. **`markets.default_language` correcto** (T28-01): Canada/US `en`, Taiwan/HK `zh-TW`.
4. **Los 4 sender profiles tienen `language = null`** → todos caen a la rama del
   mercado, que es la intención del fix. Verificado vía `GET /api/sender-profiles`.
5. **`style_hint` de los 4 en inglés**, y el de Nicolas Nicoli está **vacío**.
6. **`company_context` de la org en inglés** (416 caracteres, verificado en el DOM).
7. **La resolución devolvió `en`** para los 10 leads del run de Canada+US — los logs
   lo prueban: 8 resolvieron por location (→ `United States` → `en`) y 3 por fallback
   (→ `Canada` → `en`).

**No queda ninguna vía por la que "español" pueda entrar en ese prompt.** El prompt
pidió inglés y el modelo respondió en español.

**Sospechosos, por orden de probabilidad (ninguno verificado — requieren acceso que no
tengo):**

- **El proxy `api.aitokenking.com.tw`.** Las llamadas no van a la API de Anthropic
  directamente sino a un proxy propio (`_build_async_client`,
  `message_generator.py:211-220`, y `normalizeAnthropicBaseUrl` del lado CRM). Un
  proxy puede inyectar su propio system prompt, reescribir el request, o rutear a un
  modelo distinto del pedido. Es la explicación más económica de un comportamiento
  no-determinista que ignora una instrucción explícita.
- **El cambio de modelo.** El deploy `bfce308` *"Bump default anthropic_model to
  claude-sonnet-5"* entró **hace 54 minutos**, o sea inmediatamente antes de los runs
  de 13:06-13:36 que produjeron estos resultados. Correlación temporal directa.
- **El prompt pasa un código ISO crudo, no un nombre de idioma**
  (`message_generator.py:156`): `f"Write two LinkedIn outreach messages in {language_instruction}"`
  con `language_instruction = 'en'` → el prompt dice literalmente **"in en"**.
  `_language_instruction()` (línea 51-52) solo expande las variantes de chino; `en`,
  `es`, `vi`, `pt` pasan crudos. Esto **no explica el caso Taiwan** (donde la
  instrucción sí es prosa completa), así que no puede ser la causa raíz — pero es una
  debilidad real e independiente que conviene cerrar de todos modos.

**Cómo aislarlo definitivamente** (en orden, cada paso descarta un sospechoso):

1. Llamar al proxy a mano con el prompt exacto de `_build_prompt` y `"in en"`, y
   comparar contra la misma llamada a `api.anthropic.com` directo. Si el proxy
   devuelve español y Anthropic inglés, es el proxy y termina ahí.
2. Repetir el run de Taiwan 3 veces sin cambiar nada. Si el script varía entre
   corridas con prompt idéntico, es no-determinismo del modelo/proxy, no del código.
3. Recién si los dos anteriores salen limpios, mirar el prompt: reemplazar el código
   ISO por el nombre completo del idioma y volver a medir.

**Impacto para el onboarding:** esto bloquea el uso del scraper con el equipo, igual
que decía `testing_28_07.md`. Pero el motivo es distinto del que se creía, así que
**los fixes ya aplicados no lo van a resolver** — no sirve re-testear esperando que
mejore.

---

> **Nota histórica — el análisis previo, ya superado:**
> Las dos hipótesis que había derivado del código (T28-01: `markets.default_language`
> mal; T28-03: perfiles viejos con `'en'` sin backfill) **fueron ambas refutadas por
> query**. En producción: `markets` está correcto para todos los países relevantes, y
> los 13 SDRs tienen `language = NULL` (7 con perfil, 6 sin ninguno). Con ese estado,
> los 13 caen a la rama del mercado y resuelven bien.
>
> **Queda un solo eslabón sin verificar, y es el único que puede invalidarlo:**
> que Railway esté corriendo el `message_generator.py` con `_resolve_language()` y
> `_CHINESE_VARIANT_INSTRUCTIONS`. Si el backend desplegado es anterior, recibe
> `language: null` del CRM y no tiene la rama que lo maneja. **Verificar el commit de
> Railway antes de declarar el P1 cerrado**, y después confirmarlo con un run de 10
> leads a Taiwan (esperado: 繁體).
>
> **T28-02 sigue siendo fix obligatorio**, pero cambia de categoría: de causa activa a
> **bug latente**. Hoy ningún perfil usa el dropdown, así que no produce el síntoma.
> Pero configurar sender profiles es parte del onboarding de SDRs, y el primero que
> elija "Chinese (繁體)" para Taiwan reintroduce el bug — escribiendo `'zh'`, que el
> backend resuelve a **simplificado**.

---

### ~~T28-01~~ · **HIPÓTESIS DESCARTADA** — `markets.default_language` está correcto

**Estado: REFUTADO en producción el 28/07.** Se corrió
`SELECT name, region, geo_code, default_language FROM markets ORDER BY region, name`
(53 filas). Los valores relevantes están **bien**:

| País | region | default_language | Veredicto |
|---|---|---|---|
| Canada | usa | `en` | ✅ correcto |
| United States | usa | `en` | ✅ correcto |
| Taiwan | asia | `zh-TW` | ✅ correcto y explícito (no ambiguo) |
| Hong Kong | asia | `zh-TW` | ⚠️ ver T28-01b |
| China | asia | `zh-CN` | ✅ correcto |
| Spain | europe | `es` | ✅ |
| South Africa | europe | `en` | ✅ (el grouping bajo europe es intencional) |

La tabla en general está bien poblada y es coherente: `ja`, `ko`, `th`, `vi`, `id`,
`ar`, `de`, `fr`, `it`, `nl`, `pl`, `pt` donde corresponde.

**Se deja registrada la hipótesis refutada a propósito**, porque su descarte es lo
que fuerza la conclusión correcta: si el mercado dice `en` para Canadá/USA, el
español **no puede** venir del mercado → tiene que venir del `sender_profile`
(ver T28-01c). Y si el mercado dice `zh-TW` (inequívoco) para Taiwan, la
inconsistencia entre corridas **no puede** venir del mercado → tiene que venir de
un perfil con `'zh'` a secas, que es exactamente lo que el dropdown del CRM escribe
(T28-02, que pasa de "bug de etiqueta" a **causa raíz confirmada por eliminación**).

**Lo único que sigue en pie de la observación original:** no hay ninguna migración
que siembre esa columna. Verificado: `grep -rl default_language supabase/migrations/`
→ **0 archivos**; el repo del scraper tampoco tiene carpeta de migraciones, y
`HANDOFF.md:107` la documenta como existente sin incluir el seed. **El contenido de
`markets` no está versionado en ningún repo.** Hoy está bien, pero nadie tiene un
registro de por qué ni cómo volver si alguien lo edita a mano. Recomendación: dump
de la tabla a una migración de referencia, con el mismo criterio que QA-F34.

### T28-01b · P2 · Hong Kong usa `zh-TW` en vez de `zh-HK` — CONFIRMADO

El backend **distingue los dos** (`message_generator.py:40-41`):
```python
"zh-tw": "Traditional Chinese (繁體中文), as used in Taiwan",
"zh-hk": "Traditional Chinese (繁體中文), as used in Hong Kong",
```
Con `markets.default_language = 'zh-TW'` para Hong Kong, los mensajes a HK se
generan con instrucción de **registro taiwanés**. Ambos son tradicional, así que no
es el desastre del P1, pero el chino escrito de HK tiene léxico y giros propios y en
outreach se nota. Fix de un `UPDATE`:
```sql
UPDATE markets SET default_language = 'zh-HK' WHERE name = 'Hong Kong';
```

### ~~T28-01c~~ · **HIPÓTESIS TAMBIÉN DESCARTADA** — los 13 perfiles tienen `language = NULL`

**Estado: REFUTADO en producción el 28/07.** Se corrió la query de abajo. Resultado:
**13 usuarios `sdr`, 7 con sender profile, 6 sin ninguno, y los 7 con perfil tienen
`language = NULL` y `is_default = true`.** Cero perfiles con `'es'`, cero con `'zh'`.

Perfiles existentes: Antonio Duran (22/07), Antonio (17/07), Lauren (28/07),
Liju (28/07), Nicolas Nicoli (08/07), Nicolás Nicoli (23/07), Yulanda Kao (22/07).
Sin perfil: Evelyn, Penny, Serena, yulanda@aitokensales.com, y dos cuentas de
testing (`sdr@testing.com`, `small@testing.com`).

**Consecuencia para el P1: la cadena entera resuelve correctamente hoy.** Con
`language = NULL` en los 7, y `sender_profile is None` en los 6, **todos** caen a la
rama del mercado de `_resolve_language()` (`message_generator.py:82-89`), y el
mercado ya está verificado correcto (T28-01):

| Run | Resuelve a | Esperado |
|---|---|---|
| Canada / United States | `en` | inglés ✅ |
| Taiwan | `zh-TW` | tradicional ✅ |
| Hong Kong | `zh-TW` | tradicional, registro TW ⚠️ T28-01b |
| China | `zh-CN` | simplificado ✅ |

Los síntomas reportados en `testing_28_07.md:9-14` son **de antes de los fixes**. El
estado de datos actual es consistente con el P1 resuelto.

### ~~T28-03~~ · **HIPÓTESIS DESCARTADA** — el backfill sí se hizo

Retiro T28-03. La conclusión "los perfiles viejos siguen con `'en'` explícito" era
correcta *sobre el archivo de migración* (que efectivamente tiene 0 sentencias
`UPDATE`) pero **falsa sobre producción**: hay perfiles creados el **08/07 y 17/07**
—o sea, semanas antes de `20260728_sender_profile_language_nullable.sql`— con
`language = NULL`. Bajo `text NOT NULL DEFAULT 'en'` eso es imposible.

Por lo tanto, una de estas dos: (a) la migración se corrió **y** alguien ejecutó el
backfill a mano fuera del archivo, o (b) el `NOT NULL DEFAULT 'en'` nunca estuvo
realmente aplicado en producción. En ambos casos **no hay perfiles contaminados y no
hace falta acción.**

*Lección de método, vale dejarla escrita:* leer el archivo de migración fue
suficiente para generar la hipótesis pero **no** para confirmarla — el archivo
describe una intención, no el estado de la base. Dos hipótesis derivadas de código
(T28-01 y T28-03) cayeron con una sola query cada una. No reportar como confirmado
nada que dependa del estado de la DB sin haberla consultado.

**Lo único que queda accionable de este hilo:** el archivo de migración sigue sin el
`UPDATE`, así que si alguien reconstruye la base desde `supabase/migrations/` en
orden, **el bug vuelve**. Agregar el backfill al archivo, aunque en la base actual
sea un no-op:
```sql
UPDATE sender_profiles SET language = NULL WHERE language = 'en';
```

### ~~T28-01c (query original, ya ejecutada)~~ · El "Canadá/USA en español" venía del sender profile — REFUTADO

**Por eliminación, con `markets` ya descartado:** `_resolve_language()`
(`message_generator.py:79-89`) tiene exactamente tres salidas — el `language` del
perfil, el `default_language` del mercado, o `DEFAULT_LANGUAGE = 'en'`. El prompt no
infiere idioma del país por ningún otro lado. Si el mercado dice `en` y el default
es `en`, **el español solo puede venir de `sender_profiles.language = 'es'`.**

**Query para cerrarlo:**
```sql
SELECT u.email, sp.display_name, sp.language, sp.is_default, sp.is_active, sp.created_at
FROM users u
LEFT JOIN sender_profiles sp ON sp.user_id = u.id
WHERE u.role = 'sdr'
ORDER BY u.email;
```

**Si aparecen perfiles con `'es'`, el bug cambia de naturaleza:** el comportamiento
sería *técnicamente correcto* según la lógica nueva (un idioma explícito del perfil
gana sobre el mercado, `message_generator.py:79-80`, decisión deliberada y
documentada en el docstring). El problema pasa a ser **de producto**: SDRs de LATAM
con perfil en español corriendo campañas a USA/Canadá, y la expectativa del negocio
es que mande el mercado.

Las dos salidas posibles, y hay que elegir una explícitamente:
- **(a)** Poner esos perfiles en `Automatic` (`language = NULL`). Barato, pero
  cualquier perfil futuro puede reintroducirlo, y pierde la capacidad de forzar
  idioma cuando de verdad se quiere.
- **(b)** Invertir la precedencia en `_resolve_language()`: el mercado gana, y el
  perfil solo actúa como fallback. Es un cambio de semántica que contradice el
  docstring actual — no hacerlo sin decidirlo a nivel producto, porque el comentario
  de las líneas 70-73 documenta que la precedencia actual fue *el fix* de un bug
  anterior (un `'en'` explícito quedaba pisado por el mercado).

---

### T28-02 · P2 · No hay forma de pedir chino tradicional desde el CRM — CONFIRMADO EN PRODUCCIÓN (reescrito)

> **CORRECCIÓN 28/07.** La primera versión de este hallazgo decía que el CRM ofrece
> una opción etiquetada **"Chinese (繁體)"** que el backend resuelve a simplificado —
> una contradicción de etiqueta. **Eso era un falso positivo.** Ese array vive en
> `src/components/scraper/SenderProfileModal.tsx:16-23`, y ese componente es **código
> muerto**: `grep -rn "SenderProfileModal" src/` devuelve **una sola línea, su propio
> `export function`**. Nunca se importa, nunca se renderiza.
>
> El formulario que producción realmente usa es **inline dentro de Settings**
> (`src/app/[locale]/settings/page.tsx:590-597`), no un modal. Verificado en vivo
> leyendo el `<select>` del DOM en `ai-token-sales.vercel.app/zh/settings?tab=scraper`.

**Opciones reales del dropdown vivo** (`settings/page.tsx:591-596`, confirmadas en el
DOM de producción):

| value | label | Resuelve a (backend) |
|---|---|---|
| `''` | Automatic (match market) | el `default_language` del mercado ✅ |
| `en` | English | inglés ✅ |
| `zh` | **中文** | **Simplificado** (`message_generator.py:47`) |
| `es` | Español | español ✅ |
| `vi` | Tiếng Việt | vietnamita ✅ |

**Lo que sí sigue en pie del hallazgo original:**

1. **No existe opción `zh-TW` ni `zh-HK`.** El backend sabe traducir ambos códigos
   (`_CHINESE_VARIANT_INSTRUCTIONS`, `message_generator.py:39-48`) pero el CRM no los
   ofrece. Un admin que le setea idioma explícito a un SDR de Taiwan o Hong Kong
   eligiendo 中文 obtiene **simplificado**. La única forma de conseguir tradicional es
   dejarlo en `Automatic` y confiar en `markets.default_language` (que hoy está bien,
   T28-01).
2. **La etiqueta 中文 no miente, pero tampoco informa.** A diferencia de
   "Chinese (繁體)", 中文 es genuinamente ambiguo, así que no hay afirmación falsa —
   pero el admin no tiene manera de saber que resuelve a simplificado. Baja de P1 a
   **P2**: ya no es un bug de datos incorrectos con la UI mintiendo, es una opción
   faltante.

**Hallazgo nuevo, del mismo `<select>`: no hay opción de portugués.** El dropdown
vivo tiene 5 opciones y ninguna es `pt`, pero `markets.default_language` es `pt` para
**Brazil y Portugal**. Para esos dos mercados, un idioma explícito de portugués es
**imposible de setear** desde el CRM — solo funciona vía `Automatic`. (El `pt` que
había reportado antes existe únicamente en el componente muerto.)

**Fix mínimo:** en `settings/page.tsx:591-596`, reemplazar `<option value="zh">中文`
por `zh-TW` (繁體中文) y `zh-CN` (简体中文), y agregar `<option value="pt">Português`.
Los tres códigos ya están soportados en el backend, no requiere tocar Python.

### T28-02b · P3 · `SenderProfileModal.tsx` es código muerto (231 líneas) — CONFIRMADO

Nunca importado. Es una versión anterior del mismo formulario, con una lista de
idiomas **divergente** de la que está viva (incluye `pt` que la real no tiene, y la
etiqueta "Chinese (繁體)" que la real ya no usa). Es una trampa activa para cualquiera
que audite este código: yo mismo caí en ella y reporté un P1 falso.

**Borrarlo.** Y ojo con el efecto colateral en la Sección 6: sus **18 strings
hardcodeados están contados en la auditoría de i18n**, así que el total de 338 está
inflado en 18 y el archivo aparece indebidamente en el puesto #8 de peores casos. Los
tres primeros (`settings/page.tsx` 48, `support/page.tsx` 34, `BridgeClient.tsx` 30)
sí están vivos y verificados.

**Lección de método, la segunda de la sesión:** grepear un string y encontrarlo no
prueba que se renderice. Antes de reportar un hallazgo de UI derivado de código, hay
que confirmar que el componente esté efectivamente importado en el árbol — o mejor,
verlo en el DOM de producción, que es lo que finalmente destrabó esto.

---

### T28-03 · P1 · La migración del P1 no hace backfill: los perfiles viejos siguen con `'en'` explícito — CONFIRMADO

`supabase/migrations/20260728_sender_profile_language_nullable.sql` contiene
exactamente dos sentencias:
```sql
ALTER TABLE sender_profiles ALTER COLUMN language DROP NOT NULL;
ALTER TABLE sender_profiles ALTER COLUMN language DROP DEFAULT;
```
Verificado: **0 sentencias `UPDATE`** en el archivo.

**El problema:** la columna era `text NOT NULL DEFAULT 'en'`. Todo perfil creado
antes de esta migración tiene `language = 'en'` almacenado, sin importar si un
admin eligió inglés o no tocó nunca el selector. Con la lógica *nueva*, un
`'en'` no-nulo es "una elección explícita del SDR que debe ganar sobre el
mercado" (`message_generator.py:79-80`).

**Resultado:** después de correr la migración, un SDR de Taiwan con un perfil
preexistente **sigue recibiendo mensajes en inglés**, y ahora por diseño. La
migración quita el síntoma para perfiles nuevos y lo cementa para los viejos.

**Fix:** agregar el backfill. Ojo, no se puede distinguir a posteriori quién
eligió inglés de verdad — hay que decidir explícitamente. La opción conservadora
y la que se corresponde con la intención del fix:
```sql
UPDATE sender_profiles SET language = NULL WHERE language = 'en';
```
y avisar a los SDRs que sí querían inglés que lo vuelvan a elegir.

**Nota de interacción con QA-F24** (6 de 8 SDRs sin sender profile): esos 6 son
los únicos que hoy caen correctamente al idioma del mercado — es decir, **el P1
de idioma les pega *menos* que a los 2 que sí tienen perfil.** Contraintuitivo,
pero es lo que dice el código. No "arreglar" QA-F24 creando perfiles antes de
resolver T28-02 y T28-03, porque cada perfil nuevo creado con el dropdown actual
introduce el bug de T28-02.

---

## Sección 2 — Seguridad y aislamiento multi-tenant

### T28-04 · P1 · `PUT /api/import` acepta cualquier columna y cualquier `assigned_to`, con service-role — CONFIRMADO

`src/app/api/import/route.ts:150`
```ts
const batch = records.slice(i, i + BATCH_SIZE).map(r => ({ ...r, organization_id: orgId }))
```

El único campo que el servidor sobrescribe es `organization_id`. El spread `{...r}`
pasa **cualquier columna de `prospects`** que venga del cliente, y la ruta escribe
con el **admin client (service-role, líneas 133-136), que bypasea RLS por completo**.

Vectores confirmados:
1. **No hay check de rol** — el único gate es `caller.organization_id` no nulo
   (líneas 119-121). Cualquier `sdr` autenticado puede hacer el PUT.
2. **`assigned_to`, `area_id`, `created_by` llegan del cliente sin validar.**
   Un `assigned_to` de otra org produce filas con `organization_id: A` +
   `assigned_to: usuario-de-B`. Por la RLS de `prospects`
   (`20260727_document_prospects_rls.sql:61-68`, exige
   `assigned_to = auth.uid() AND organization_id = my_org_id()`) **ningún SDR las
   ve nunca**. Leads pagados que desaparecen del pipeline y solo aparecen en
   vistas de admin.
3. **Sin allowlist de campos** → se puede setear `outreach_status: 'closed'`
   directamente, **saltándose el gate obligatorio de `CloseDealModal`** que
   `CLAUDE.md` describe como requisito de negocio. También `icp_score`,
   `custom1/2`, `flag_tomorrow`.
4. **Sin validación de cupo** (`getLeadQuota()` / `max_leads_per_month`). El
   contador se incrementa *después* (línea 182) y con `.catch(() => {})` que
   ignora el fallo del RPC (37-39). 500 filas pueden pasarse del plan sin bloqueo.

**Fix:** allowlist explícita de columnas + validar que `assigned_to` sea un usuario
`is_active` de `orgId` + derivar `area_id` server-side de ese usuario + `created_by`
= sesión + gate de rol coherente con lo que la UI ya asume (el picker de SDR es
admin-only en el cliente y no en el servidor).

---

### T28-05 · P1 · El Prospect Drawer escribe en el Audit Log y dice "Saved" aunque el UPDATE haya fallado — CONFIRMADO

`src/components/prospects/ProspectDrawer.tsx`, `saveEditableField()` líneas 189-219:
```ts
await updateField(field, value, { silent: true, extraDb, extraLocal })   // 211
await logAuditEvent({ ... metadata: { field, from, to } })               // 212-217
showToast(t('common.saved'))                                            // 218
```
`updateField()` (167-184) es `if (!error) { ...setProspect... }` **sin rama `else`
y sin valor de retorno** — se come el error en silencio.

**Consecuencia:** si el UPDATE falla (RLS, red, constraint), el usuario ve el toast
verde, la DB no cambió, y **el Audit Log registra un cambio que nunca ocurrió**.
Aplica a los 4 campos nuevos (Company, Job Title, Market, Search Combo).

Esto es peor que un bug de UI: contamina el registro de auditoría, que es
justamente lo que se consulta cuando algo no cuadra.

**Fix:** `updateField` devuelve `boolean`; `saveEditableField` corta antes de
loguear y muestra error.

**Nota de alcance:** los otros campos del drawer (`lead_temperature`:381,
`icp_score`:399, `flag_tomorrow`:291, `custom1/2` vía `saveEditMessage`:231-236)
**no loguean nada al Audit Log**. Solo status, reasignación y estos 4. Si se
esperaba cobertura completa del drawer, no la hay.

---

### T28-06 · P1 · `run_sdr_assignments`: política de INSERT abierta a cualquier autenticado — CONFIRMADO EN SQL

`supabase/migrations/20260706_scraper_v2.sql:208-209`
```sql
CREATE POLICY "service role inserts run assignments" ON run_sdr_assignments
  FOR INSERT WITH CHECK (true);
```

El nombre dice "service role", pero **el service role bypasea RLS de todos modos**
— esta política no existe para él. Lo que hace en la práctica es permitir que
**cualquier usuario autenticado** (un `sdr`, un `support`, un admin de otra org)
inserte filas para **cualquier `run_id`**.

**Por qué importa:** `CLAUDE.md` documenta que la asignación automática de leads
resuelve el destinatario leyendo `run_sdr_assignments[0].sdr_id`, y que un run con
**cero o múltiples** filas de asignación se salta deliberadamente ("never guessed
at"). Insertar una fila espuria permite entonces (a) desviar los leads de un run a
otro SDR, o (b) dejar el run permanentemente sin asignar volviéndolo ambiguo.
Impacto de negocio directo: cupo, comisión y propiedad del lead.

**Fix:** `WITH CHECK (false)` (el service role no la necesita) o acotar a
`admin` de la org dueña del run.

---

### T28-07 · P2 · Bucket `logos`: escritura cross-tenant — CONFIRMADO EN SQL

`20260720_logos_bucket.sql:14-20` — INSERT/UPDATE sobre `storage.objects` con la
única condición `auth.role() = 'authenticated'`, sin filtro por org ni por path.
Un admin de la org A puede sobrescribir el logo de la org B.

### T28-08 · P2 · Un `sdr` puede leer **todos** los `scraper_leads` de su org — CONFIRMADO EN SQL

`20260708_scraper_leads.sql:29-32`, política `"admin reads own org scraper leads"`:
el nombre dice admin pero la condición **solo chequea pertenencia a la org, no el
rol**. Mismo patrón en `"admin reads own org runs"` (`20260706_scraper_v2.sql:31-34`),
`"admin reads own org combos"` (:121-124) y `"admin reads own org addons"`
(`20260702_settings.sql:53-56`).

No es fuga cross-tenant (el filtro por org sí funciona) pero sí **intra-tenant**:
un SDR ve por RLS la PII de leads asignados a otros SDRs, y los runs/config del
scraper del que se supone que está excluido. Contrasta con `prospects`, donde el
SDR sí está limitado a `assigned_to = auth.uid()`.

### T28-09 · P2 · 5 políticas RLS duplicadas de Support siguen vivas en producción — CONFIRMADO

`20260702_settings.sql` creó políticas de support que `20260707_support_fix.sql`
reemplazó **con nombres distintos**, así que su `DROP POLICY IF EXISTS` no las
alcanzó. Postgres evalúa políticas del mismo comando con **OR**, así que
convivieron sin romper nada pero ampliando el acceso más allá de lo que dice cada
nombre.

| Tabla | Política huérfana | Cmd | Origen |
|---|---|---|---|
| `support_tickets` | `"admin creates own org tickets"` | INSERT | `20260702_settings.sql:82-87` |
| `support_tickets` | `"admin reads own org tickets"` | SELECT | `:89-93` |
| `support_tickets` | `"admin_global full access on support_tickets"` | ALL | `:95-99` |
| `support_ticket_messages` | `"ticket participants can read messages"` | SELECT | `:123-132` |
| `support_ticket_messages` | `"ticket participants can insert messages"` | INSERT | `:134-146` |

`20260728_cleanup_duplicate_support_rls.sql:30-35` dropea exactamente esas 5,
**pero `testing_28_07.md:20` dice que esa migración no se corrió** → hoy siguen vivas.

**Antes de correrla, ojo:** esa migración no solo deduplica, **relaja** dos cosas
(documentado en el propio archivo, líneas 17-21): (a) crear tickets deja de exigir
`role = 'admin'` a nivel RLS, y (b) el rol `support` gana el mismo acceso cross-org
que `admin_global`. Si (b) es lo que se quiere (un agente de soporte atiende todas
las orgs), está bien — pero es una decisión de producto, no un cleanup. Vale
confirmarla antes de correr.

### T28-10 · P2 · El gate del rol `support` es fail-open y no tiene segunda capa — CONFIRMADO

`src/middleware.ts:120-128` — allowlist de exactamente una ruta: si
`role === 'support'` y la ruta no es `/support`, redirect. Verificado que cubre
`/kanban`, `/leads`, `/admin/users`, `/audit`, `/global-admin/*`, `/settings` por
URL directa (el check es `!==` sobre la ruta completa).

Dos huecos:
1. **Fail-open por timeout** (líneas 91-99): el perfil se lee con `Promise.race`
   contra 900 ms. Si Supabase tarda más, `userData` queda `null` y **todo el
   bloque 101-132 se saltea, incluido el gate de Support**. El comentario de las
   líneas 84-90 documenta el trade-off para `is_active` pero **no menciona que el
   gate de rol cae en el mismo agujero**. En la práctica vería páginas vacías
   (RLS con `organization_id = null` no matchea nada), pero es una capa que se
   cree sólida y no lo es.
2. **No existe `blockSupportAccess()`.** `src/lib/utils/route-guard.ts:13-17`
   solo bloquea `'sdr'`. Esto contradice el patrón que el propio `CLAUDE.md`
   establece para páginas admin-only ("`AppShell` does not gate itself").
3. El matcher del middleware **excluye `/api`** (línea 137). Las rutas que revisé
   se defienden solas, pero no hay gate central para un `support` autenticado.

**Dato de diseño relevante:** el aislamiento de `support` respecto al CRM no viene
de un chequeo de rol sino de que se crean con `organization_id: null`
(`api/global-admin/support-users/route.ts:81-83`), lo que hace que toda política
`organization_id = (...)` evalúe a NULL → deniega. **Nada en el schema impide
asignarle una org después** (la columna es nullable, no hay CHECK). Si eso pasa,
pasa a leer `runs`, `scraper_leads`, `org_combos`, `pipeline_stages` y
`organization_addons` de esa org automáticamente.

### T28-11 · P2 · Blacklist de dominios (QA-F21): solo cliente, fail-open, y sin punto de refuerzo server-side — CONFIRMADO

Estado: **PARCIAL**, y no es arreglable sin crear una ruta nueva.

- El chequeo manual existe: `ProspectForm.tsx:138-165`, compara dominio de email,
  hostname de LinkedIn y `company`.
- **Pero el insert manual no pasa por ninguna API**: va directo con el cliente
  browser, `supabase.from('prospects').insert(payload)` (`ProspectForm.tsx:197`).
  **No existe `POST /api/prospects`** (ese archivo solo tiene PATCH:34 y
  DELETE:106). No hay ningún punto servidor donde la blacklist se pueda hacer
  cumplir para creación manual — es puramente UX.
- **Fail-open explícito**: `catch { /* don't block creation on a network blip */ }`
  (línea 165). Si `/api/import` falla, se crea el prospecto sin chequear.
- El camino CSV tiene la misma debilidad: el filtro está en el cliente
  (`CSVImportWizard.tsx:258-272`) y `PUT /api/import` **no re-verifica la
  blacklist** (sí re-verifica org y `MAX_IMPORT_ROWS`).

---

## Sección 3 — Fixes reclamados: verificación

| ID | Hallazgo | Estado real | Evidencia |
|---|---|---|---|
| **QA-F35** | `GET /api/runs` rechaza SDRs | ✅ **IMPLEMENTADO** | `api/runs/route.ts:266-268`, rol leído de `public.users` vía sesión, **no** de cookie. Idem POST:29-31, DELETE:232-234. Barrido completo: `/api/runs/[id]`:32-34, `/assign`:27-29, `/logs`:28-30, `/quota`:29-31, `/scraper/to-crm`:28, `/api/bridge/*`:25-27+36-46 — todos bloquean `sdr`. |
| **QA-F27** | Bridge "Confirm & Send Messages" | ⚠️ **PARCIAL** | ver T28-12 |
| **QA-F26** | Bridge "Unknown company" | ❌ **NO ARREGLADO** | ver T28-13 |
| **QA-F23** | Scrollbar de tabs en Settings | ✅ **IMPLEMENTADO** | `settings/page.tsx:732-762`. El `borderBottom` está en el div externo (741) y el `overflowX:'auto'` en el interno (742) — dos cajas distintas, la scrollbar tiene su propio espacio. |
| **QA-F30** | Aviso al desactivar un mercado | ✅ **IMPLEMENTADO** | `OrgMarketsSettings.tsx:149-160` gatekeeper + `fetchDeactivationImpact()`:18-30 (cuenta prospects, SDRs afectados y runs activos por mercado) + modal:238-283. La advertencia es solo UI (`PUT /api/organizations/[id]/markets:124-131` borra sin verificar) pero es informativa por diseño, no un bloqueo. |
| **Revenue** | `$-0` y desfase de $1 | ✅ **IMPLEMENTADO** | `revenue/reports/page.tsx:27` `(Math.round(n) \|\| 0)` normaliza el `-0` (es falsy); `:33` `fmtNeg` evita `-$0`; `:41-47` carga el delta de redondeo en el último share para que las partes sumen el neto exacto. `quarter.ts` no tiene ningún `Math.round`/`toFixed` — aritmética entera de meses, no puede originar desfases. |
| **QA-F28** | Vendor como dropdown | ⚠️ **PARCIAL** | Es `<select>` desde `vendors` en ambos formularios (`new/page.tsx:63`+303-309, `[id]/page.tsx:86`+360-366). **Pero incluye `Other (type below)` → input de texto libre** (`new:308-319`, `[id]:365-376`), y `vendor` sigue siendo texto libre en DB sin validación server (whitelist de PATCH: `global-admin/organizations/[id]/route.ts:88`, sin cruce contra `vendors`). **El riesgo original — duplicados por typo `testvendor` vs `TestVendor` partiendo el reporte de revenue — sigue alcanzable.** |
| **QA-F29** | Dos botones Save en Edit Org | ⚠️ **CONFIRMADO, y son tres** | ver T28-14 |
| **QA-F31** | Editar Market recalcula el Área | ⚠️ **PARCIAL** | ver T28-15 |
| **QA-F34** | Migración de documentación de RLS | ✅ **inocua** | `20260727_document_prospects_rls.sql` (73 líneas) es **puramente documental**: transcribe verbatim políticas que se habían hecho a mano en el dashboard y nunca estuvieron en el repo. Cada `DROP IF EXISTS` + `CREATE` recrea la política idéntica. No cambia comportamiento. Deja registrado (sin corregir) que `"Global admin full access on prospects"` chequeaba `my_role()='admin' AND my_org_id() IS NULL`, condición **que ningún usuario real puede satisfacer** — corregido un archivo después en `20260727_fix_prospects_admin_global_rls.sql:12-15`. |

### T28-12 · P2 · QA-F27: el botón reporta éxito con el número equivocado — CONFIRMADO

Cadena: `BridgeClient.tsx:613-621` → `confirmBatch()`:261-277 → `bridgeApi.confirmBatch()`
(`bridge-api.ts:143-147`) → `POST /api/bridge/candidates/confirm-batch` → proxy
(`bridge/[...path]/route.ts:176-222`) → backend.

El proxy hace bien su parte (inyecta `anthropic_key`/`base_url`/`model`/`bridge_context`
179-192, valida que el `sdr_id` sea de la org y esté activo 199-208, resuelve el
sender profile por defecto 211-221). Los fallos están en el cliente:

| # | Fallo | Línea |
|---|---|---|
| a | **Se ignora el body de la respuesta.** El tipo declara `{ confirmed?: number }` pero el cliente solo mira que no lance (HTTP 2xx) y muestra `"${ids.length} candidates confirmed"` usando la longitud **del pedido**. Un `200 {confirmed: 0}` se reporta como éxito total. | `BridgeClient.tsx:266-268` |
| b | Si el SDR no tiene sender profile por defecto, el proxy manda `sender_profile_id: null` **sin avisar** — sin error, sin warning; el mensaje sale sin identidad de remitente. Interactúa directo con QA-F24 (6 de 8 SDRs sin perfil). | `bridge/[...path]/route.ts:220` |
| c | Solo se renderizan los **3 primeros** contactos por compañía (`group.items.slice(0,3)`) y los checkboxes son por contacto — los contactos 4+ existen en `candidates` pero son inseleccionables, sin que nada lo indique. | `BridgeClient.tsx:664` |
| d | El CRM **nunca escribe en `prospects`** en ninguna rama de `/api/bridge/*` (verificado: cero `from('prospects')` en el archivo). El "Send Messages" es enteramente responsabilidad del backend, y la UI no verifica que los candidatos lleguen al Kanban. | — |

**SOSPECHOSO / no verificable desde el repo:** si el backend efectivamente escribe
en `prospects` y si respeta `candidate_ids` parcialmente. Requiere el run end-to-end.

### T28-13 · P2 · QA-F26: el fallback "Unknown company" sigue vivo — CONFIRMADO NO ARREGLADO

`BridgeClient.tsx:310` — única ocurrencia en todo Bridge:
```ts
group = { key, company: c.company || 'Unknown company', ... }
```
El nombre llega tal cual del backend (`bridge-api.ts:52`, campo opcional); el proxy
no normaliza ni enriquece nada de compañía. El agrupado usa
`c.company_id || c.company || '—'` (línea 307), así que **todos** los candidatos sin
ninguno de los dos caen en un mismo grupo `'—'` etiquetado "Unknown company".

No hay lookup desde `company_id`, ni desde `seed_lists.company_names`, ni fallback
al nombre de la seed list. Lo único que cambió respecto al bug original es el
agrupado por `company_id` (comentario 298-302), que reduce la fragmentación pero
no toca el texto. **No hay ningún comentario `QA-F26` en el repo** — el fix
probablemente nunca se escribió.

### T28-14 · P3 · QA-F29: son tres mecanismos de guardado, y dos ignoran el status HTTP — CONFIRMADO

`global-admin/organizations/[id]/page.tsx`, los tres contra el mismo `PATCH`:

| Control | Handler | Guarda | Maneja error |
|---|---|---|---|
| "Save Organization Info" (botón:417) | `saveInfo()` 163-185 | name, slug, vendor, billing_day, logo_url, plan, max_seats, max_leads_per_month, admin_email, admin_password | ✅ chequea `res.ok`, muestra error (179, 412-413) |
| "Save API Keys" (botón:454) | `saveApiKeys()` 187-198 | apify_token, anthropic_key, anthropic_base_url, anthropic_model | ❌ `catch {}` vacío (197) — **muestra "✓ Saved" con 4xx/5xx** |
| Textarea de notas (`onBlur`:468) | `saveNotes()` 200-208 | internal_notes | ❌ `catch {}` vacío (207) |

El problema real no es que haya dos botones, es que **el de las API keys miente**.
Una `anthropic_key` mal pegada se reporta como guardada y el siguiente run falla
sin causa aparente.

### T28-15 · P2 · QA-F31: implementado, con dos fallas silenciosas — CONFIRMADO

`ProspectDrawer.tsx:197-209` — al cambiar `market`, `inferAreaFromCountry()` +
lookup en `areas`, y el `area_id` se persiste en el mismo UPDATE (vía `extraDb`:175)
con refresco del `AreaBadge` sin refetch (`extraLocal`). **Está.**

1. **Falla silenciosa doble:** si `inferAreaFromCountry` devuelve `null` (market
   desconocido, o `marketAreaMap` todavía cargando — viene de un hook async,
   línea 84) o si no hay fila en `areas`, **el `market` se guarda igual y el
   `area_id` queda con el valor viejo, sin aviso**. Queda exactamente el estado
   inconsistente que QA-F31 buscaba eliminar. Editar Market rápido después de
   abrir el drawer puede pegarle a un mapa vacío.
2. **No re-evalúa `assigned_to`.** El effect de las líneas 115-125 recarga
   `sdrsForArea` filtrando por el área **nueva**, así que el SDR actualmente
   asignado (de la área vieja) ya no está entre los `<option>` (500). El select
   "Assigned to" queda con un `value` que no matchea ninguna opción y **el
   navegador muestra "Unassigned"** aunque el prospecto siga asignado. Si el admin
   toca el select en ese momento, reasigna sin querer. El SDR no pierde acceso
   (la RLS va por `assigned_to`), es un problema de UI con consecuencia real.
3. Los 4 campos nuevos **no tienen gating por rol**: un `sdr` puede editar
   Company/Title/Market/Search Combo de sus leads (solo `isImpersonating` bloquea).
   La RLS lo permite. Si la intención era admin-only, falta el check.

---

## Sección 4 — CSV Import con mensajes pre-generados

Además de T28-04 (el hallazgo grave de esta área):

### T28-16 · P2 · El campo `search_combo` del CSV está efectivamente roto — CONFIRMADO

`CSVImportWizard.tsx:341` valida contra `SEARCH_COMBOS`, que en `types.ts:153` es
`['A','B','C','D','E','F']`. Pero los valores canónicos son los `code` de
`scraper_combos_master` — `combo_A`…`combo_F` (`20260706_scraper_v2.sql:59-97`),
que es lo que `useComboLabels()` espera (y lo que `CLAUDE.md` documenta
explícitamente: "never the human-readable name").

Resultado: un CSV con `combo_D` **se nulea en silencio**; un CSV con `D` guarda
`"D"`, que el dropdown del drawer no resuelve (cae al fallback de código crudo,
`ProspectDrawer.tsx:473-475`).

### T28-17 · P2 · Si el dedup falla, el import sigue a ciegas sin avisar — CONFIRMADO

`CSVImportWizard.tsx:239-241`: `catch {}` vacío con comentario "proceed without
dedup". Un 500 transitorio en `POST /api/import` convierte un import normal en un
import ciego, y el usuario no ve nada.

### T28-18 · P2 · Dedup: sin normalización de URL y sin chequeo de email en `scraper_leads` — CONFIRMADO

`api/import/route.ts:66-82`. La parte buena: es **org-wide** y chequea las dos
tablas, con `orgId` de la sesión (56), match case-insensitive (75-76, 87, 91).

Lo que falla:
- **`scraper_leads` solo se chequea por `linkedin_url`, no por email** (no
  selecciona la columna). Un lead scrapeado sin LinkedIn URL pero con email no se
  detecta.
- **Sin normalización de URL:** `https://www.linkedin.com/in/juan/` vs
  `https://linkedin.com/in/juan` vs con `?trk=...` son strings distintos → falsos
  negativos. `isValidLinkedinUrl` (46-48) es deliberadamente laxo (`/linkedin\.com\//i`),
  lo que amplifica el problema.
- El `SELECT` de dedup **no tiene `limit`** (66-70) y el `POST` no limita el
  tamaño de `emails`/`linkedins` (el cap de 500 solo está en el `PUT`, 129-131).
  Un array grande fuerza a cargar `prospects` + `scraper_leads` completos de la
  org en memoria de la función serverless.

### Lo que sí está bien en esta área (verificado, no tocar)

- **Cap de 500 filas: doble capa.** `MAX_IMPORT_ROWS` en `types.ts:361`, cliente en
  `CSVImportWizard.tsx:171-174` (antes del mapeo), servidor en
  `api/import/route.ts:129-131`. ✅ (QA confirmado por el smoke test de hoy.)
- **Tolerancia a `23505` fila por fila.** `route.ts:148-179`: batches de 25; si el
  batch falla con `23505`, reintenta cada fila **en paralelo** (`Promise.all`
  161-163); `imported++` / `skippedConstraint++` / `errors[]`. Solo devuelve 400 si
  `errors.length > 0 && imported === 0 && skippedConstraint === 0`. El comentario
  144-147 documenta el incidente real (fallback secuencial → timeout → "Unexpected
  end of JSON input") y el cliente tiene pantalla dedicada para ese caso
  (`importUnknown`, 376-385 + 799-810). Bien resuelto.
  - *Residual:* un error **no**-`23505` a nivel batch (173-174) descarta los 25 sin
    fallback fila-por-fila. Y `scrape_date` se inserta como string sin parsear
    (342) → un formato raro revienta el batch entero por esa vía.
- **Banner de aviso** correcto: solo aparece si hay columna de mensajes mapeada
  (610-617), no en un import plano. *Residual:* exige `selectedSdrId`, que solo se
  setea en el paso 2 (admin) → **un SDR importando su propio CSV con mensajes nunca
  ve el banner**. Defendible (él es el remitente) pero no documentado.

### T28-19 · P3 · El wizard queda trabado para un SDR sin `area_id` — CONFIRMADO

`CSVImportWizard.tsx:183-195`: `parseCSV` exige `user?.area_id` para saltear al
paso 3. Si es null, se queda en el paso 2, que **nunca renderiza nada útil para
no-admin** (el effect que puebla `sdrs` hace `if (!isAdmin) return`, línea 118).
Pantalla en blanco sin mensaje de error.

---

## Sección 5 — Rol Support

### Lo que está bien (verificado)

- **Creación**: `global-admin/support/page.tsx` (modal 163-210) →
  `api/global-admin/support-users/route.ts`. `verifyGlobalAdmin()` (6-28) valida
  `admin_global` leyendo de DB. `POST` (53-92) crea auth user con
  `email_confirm: true`, inserta con `role:'support'`, `organization_id: null`, y
  hace **rollback (`deleteUser`) si falla el insert del perfil** (86-89). Bien hecho.
  `PATCH` (95-117) tiene `.eq('role','support')` — no puede tocar otros roles. ✅
- **Tickets — validación server-side correcta en las 4 operaciones:**

| Operación | Ruta | Gate |
|---|---|---|
| Listar | `GET /api/support/tickets:30-82` | `isCrossOrg = support \|\| admin_global` (39) sin filtro de org; `admin` → filtro org; `sdr` → org + `created_by` propio (50-51) ✅ |
| Crear | `POST :84-116` | bloquea `orgId` null (87-89) → Support no crea tickets; la UI también oculta el botón (`page.tsx:413`). Doble check ✅ |
| Responder | `POST /[id]:29-71` | verifica existencia, org match salvo cross-org (55-57), `canReply` (58-61) ✅ |
| Cambiar estado | `PATCH /[id]:74-98` | `canChangeStatus = admin \|\| isCrossOrg` (80) ✅ |

- **RLS + Realtime coherentes:** las 3 políticas de `20260707_support_fix.sql:51-83`
  incluyen `role IN ('admin_global','support')`, así que un Support **sí** recibe
  eventos de todas las orgs. El comentario de `20260728_cleanup...:23-27` documenta
  correctamente que la RLS acá solo afecta a Realtime, porque las lecturas/escrituras
  van por service-role.

### T28-20 · P2 · El Realtime de tickets depende de dos migraciones manuales — si faltan, muere en silencio

Suscripciones: mensajes del ticket expandido `support/page.tsx:109-131`
(canal `ticket-messages-${expandedId}`, INSERT filtrado por `ticket_id`, solo si el
ticket no está `closed`); lista de tickets `:193-206` (canal `support-tickets-list`,
INSERT + UPDATE, refetch silencioso + sonido si es cross-org).

Habilitación:
- `20260707_support_fix.sql:86` → `ALTER PUBLICATION supabase_realtime ADD TABLE support_ticket_messages;` **sin guarda de idempotencia** (re-correr esa migración falla con "table already member of publication").
- `20260727_support_tickets_realtime.sql:12-14` → agrega `support_tickets`, esta sí con guarda `pg_publication_tables`.

**Este es el modo de falla más probable al estrenar la feature:** si esas
migraciones no se corrieron a mano, el Realtime **no funciona sin ningún error,
sin log, sin síntoma** más que "los tickets no se actualizan solos". Verificar
*antes* de testear la feature, o se va a diagnosticar como un bug de React.

### T28-21 · P3 · Bug de re-suscripción en el canal de mensajes — CONFIRMADO

`support/page.tsx:109-131`: el effect **depende de `tickets`** (línea 131) y el
propio handler llama `setTickets`. Cada mensaje que llega destruye y recrea el
canal → ventana de pérdida de eventos durante `removeChannel`/`subscribe` + churn
de websocket. El `ticketsRef` de las líneas 91-92 se creó justo para evitar esto
pero **no se usa dentro de este effect** (línea 111 lee `tickets` directo).

### T28-22 · P3 · Huecos funcionales de la cola de tickets — CONFIRMADO

- **`PATCH` no valida el valor de `status`** (`[id]/route.ts:84`, va directo al
  `update`). La única protección es el CHECK de la DB → un valor inválido devuelve
  400 con mensaje crudo de Postgres.
- **El estado `'resolved'` es inalcanzable desde la UI**: está en el CHECK
  (`20260707_support_fix.sql:18-19`) y en `STATUS_COLORS` (`page.tsx:34`) pero no en
  el dropdown (`:376`) ni en el filtro (`:424-430`). Un ticket que llegue a
  `resolved` por vía DB **aparece en la sección "Open"** porque el split es
  `status !== 'closed'` (`:281`).
- **`assigned_to` existe en la tabla (`20260707_support_fix.sql:20`) y nada lo usa.**
  No hay ownership de tickets: con más de un agente Support activo se van a pisar.
- **No hay DELETE de usuarios Support** — solo desactivar; la fila queda para siempre.
- **Sin validación de password** (fuerza/longitud) en la creación → Supabase Auth
  rechaza <6 chars con un error crudo en el banner.
- INSERTs de `support_ticket_messages` **no disparan refetch de la lista**, así que
  el contador "N messages" de una fila colapsada (`:308`) queda stale.

---

## Sección 6 — i18n

### T28-23 · P2 · 25 archivos / 338 strings de UI hardcodeados

**Lo bueno:** los 4 archivos de `src/messages/` tienen **exactamente las mismas 351
claves hoja**, sin ninguna faltante. La sincronización de claves está sana.

**Lo malo:** de 74 archivos `.tsx` bajo `src/app/[locale]/` + `src/components/`,
solo **25 usan `useTranslations`/`getTranslations`**. Reparto: 17 archivos / 224
strings en el sistema `next-intl`, + 8 archivos / 114 strings en Global Admin
(que tiene su propio `t()` de `GlobalAdminThemeContext`, solo zh/en).

Peores casos, **con cero i18n** (no importan `next-intl` en absoluto):

| Strings | Archivo |
|---|---|
| 48 | `src/app/[locale]/settings/page.tsx` |
| 34 | `src/app/[locale]/support/page.tsx` |
| 30 | `src/app/[locale]/bridge/BridgeClient.tsx` |
| 18 | `src/components/scraper/SenderProfileModal.tsx` |
| 8 | `src/components/conversations/ConversationsPage.tsx` |
| 17 | `src/app/[locale]/global-admin/revenue/reports/page.tsx` (0 llamadas a `t()`) |

Con i18n parcial (mezclan `t()` y hardcode): `UsersManagement.tsx` (21),
`RunClient.tsx` (13), `ProspectsTable.tsx` (11), `HistoryClient.tsx` (8),
`AuditLogTable.tsx` (7), `CSVImportWizard.tsx` (15 — importa `useTranslations`
pero la mayor parte del wizard está hardcodeada).

**Valores sin traducir dentro de los JSON:** `es.json` tiene 39 valores idénticos
al inglés (la mayoría siglas/nombres propios aceptables, pero traducibles reales:
`outreachStatus.nurture`, `prospect.searchCombo`, `prospect.custom1/2`,
`audit.timestamp`, `stats.conversionSection`, `export.tableTemp`). `zh.json` tiene
6 sin ningún carácter chino, de los cuales **`stats.conversionSection` =
`"Conversion Rate"` (línea 225) es un string de UI real sin traducir**. `vi.json`,
20 idénticos con 4 traducibles reales.

### QA-F22 — resuelto parcialmente, y el español que queda está en otro lado

El label "Assigned To" **ya está traducido**: `ProspectsTable.tsx:472`,
`ProspectDrawer.tsx:490` y `:509`, `ProspectForm.tsx:347` usan
`{t('prospect.assignedTo')}`, y la clave existe en los 4 idiomas
(`en:97` "Assigned To", `es:97` "Asignado a", `zh:97` "負責人", `vi:97` "Người Phụ Trách").

**El único español hardcodeado que queda en la UI** está en
`ConversationsPage.tsx:155` `title="Desde"` y `:162` `title="Hasta"` — tooltips de
los dos inputs de fecha, en la misma barra de filtros que el `All SDRs` hardcodeado
(línea 144), en un archivo sin ningún `useTranslations`. Es el candidato más
plausible a lo que describía QA-F22.

**Adicional (server-side, se renderiza en pantalla):**
`api/conversations/route.ts:63` → `author_name: authorMap[c.author_id] ?? 'Usuario'`
— fallback en español que se muestra como nombre de autor.

**"Assigned to" aún hardcodeado en inglés** (no es QA-F22 pero está):
`HistoryClient.tsx:287` y `:348`, `RunClient.tsx:699`, `BridgeClient.tsx:749`.

---

## Sección 7b — Hallazgos de la pasada en browser (producción, 28/07)

Verificados navegando `ai-token-sales.vercel.app` como org admin y como `admin_global`.

### T28-26 · P1 · Impersonación: el filtro de SDRs muestra los SDRs de TODAS las orgs — CONFIRMADO

**Descubierto de casualidad:** el botón **"View"** de la lista de Organizations no abre
el detalle de la org, abre **impersonación** (`/zh/kanban?impersonate_org_id=…`).

Impersonando `testorg` — una org **Basic con 0/3 seats, o sea sin ningún SDR** — el
dropdown de SDRs del Kanban lista **12 personas con sus UUIDs**: Antonio, Antonio
Duran, Evelyn, Lauren, Liju, Nicolas Nicoli, Nicolás Nicoli, Penny, Serena, small,
Yulanda, Yulanda Kao. Son los SDRs de **AITokenSales + Insight Software**. Ninguno
pertenece a `testorg`.

**Causa raíz** (`src/components/kanban/KanbanBoard.tsx:89`):
```ts
supabase.from('users').select('id, full_name').eq('role', 'sdr').eq('is_active', true).order('full_name')
```
Sin filtro de `organization_id` **y sin ruteo por impersonación**. La query de
`prospects` sí pasa por `/api/crm/[table]` cuando impersona (líneas 117 y 153), pero
la de SDRs va directo a Supabase con el browser client bajo la RLS del *global admin*,
que ve todo.

**Severidad:** solo `admin_global` puede impersonar, y está legitimado a ver todas las
orgs, así que **no es escalación de privilegios**. Pero (a) es un bug de correctitud —
ofrece filtrar por SDRs que no pueden poseer ningún lead en esa org — y (b) es la
**misma query sin filtro de org** que usan `CSVImportWizard.tsx:119-124`,
`BridgeClient.tsx:129-136` y `ProspectsTable.tsx`. Esto convierte esos tres, que tenía
como "SOSPECHOSO", en un patrón defectuoso **confirmado**: dependen enteramente de la
RLS de `users` para el aislamiento.

### ✅ Verificación positiva · La RLS de `users` sí scopea a un admin normal — CONFIRMADO

Cierra parcialmente T28-25. Como **org admin** de AITokenSales, `/zh/prospects` lista
**9** SDRs. Impersonando como `admin_global`, la misma clase de query lista **12**. La
diferencia es exactamente la RLS haciendo su trabajo: un admin de org **no** ve
usuarios de otra org, aunque la query no lleve filtro. El riesgo de los pickers de
CSV/Bridge queda mitigado en la práctica — pero sigue apoyado en una política que **no
está versionada en ninguna migración del repo**.

### T28-34 · **P1** · CSV import: el formato de `search_combo` está invertido y revienta el import completo — REPRODUCIDO

Test con un CSV de 4 filas (`test_import_combo_28_07.csv`, en la raíz del repo), con
`search_combo` = `combo_D` / `D` / vacío / `NOT_A_COMBO`.

**Resultado: `0 已匯入` de 4 filas**, con este error en pantalla:
```
Error: new row for relation "prospects" violates check constraint "prospects_search_combo_check"
```

**El formato está invertido entre las dos capas:**

| Capa | Formato que usa | Evidencia |
|---|---|---|
| Cliente (`CSVImportWizard.tsx:341` + `types.ts:153`) | letras `'A'`…`'F'` | El label del dropdown de mapeo dice literalmente **"Search Combo (A-F)"** |
| Base de datos (`prospects_search_combo_check`) | `combo_A`…`combo_F` | Rechaza `"D"`; y un lead del scraper tiene `search_combo = combo_B` (visto en el drawer) |

Con lo cual el validador del cliente **nulea justamente los valores válidos**
(`combo_D` → null porque no está en `['A'..'F']`) y **deja pasar el único inválido**
(`D` → se guarda como `"D"` → la DB lo rechaza). El campo no es que esté "roto en
silencio" como había estimado leyendo el código: **tumba el import entero**.

Consistente con lo que `CLAUDE.md` documenta como valor canónico: *"never the
human-readable name"* — pero el cliente nunca se actualizó a `combo_X`.

### T28-35 · **P1** · Una sola fila inválida mata el batch completo, sin fallback fila por fila — REPRODUCIDO

Segundo test, mismo CSV pero con `search_combo` **sin mapear**. Nuevo error:
```
Error: new row for relation "prospects" violates check constraint "prospects_icp_score_check"
```
**`0 已匯入` de 4 filas otra vez.** Solo **una** fila tenía `icp_score = 150` (fuera de
rango, puesto a propósito). Las otras tres tenían 80, 70 y 60 — **perfectamente
válidas, y se perdieron las tres.**

Confirma dos cosas del análisis de código:
1. **El cliente no valida el rango de `icp_score`** (`CSVImportWizard.tsx:339`,
   `parseFloat` sin cota). La DB tiene `prospects_icp_score_check` (presumiblemente
   0-100) y es la única defensa.
2. **El fallback fila-por-fila solo existe para `23505`** (`api/import/route.ts:153`).
   Un `23514` a nivel batch descarta el lote entero (`:173-174`) sin reintentar
   individualmente. Con `BATCH_SIZE = 25`, **una fila con un typo puede costar 24 filas
   buenas**.

### T28-36 · **P1** · Los fallos de constraint se le reportan al usuario como "Duplicates skipped" — REPRODUCIDO

En **los dos** tests anteriores, la pantalla final mostró:
```
4 rows in the CSV
0   已匯入
4   Duplicates skipped
```
**No había ni un duplicado.** Eran 4 leads nuevos con LinkedIn URLs únicas que nunca
habían existido; fallaron por CHECK constraint. El contador que la UI etiqueta
*"Duplicates skipped"* está contando cualquier fila no importada.

Impacto práctico: un admin ve "duplicados omitidos", concluye razonablemente que los
leads ya estaban en el sistema, y **nunca se entera de que su import falló**. El
mensaje de error sí aparece arriba, pero contradice al contador que está justo debajo,
y es un **error crudo de Postgres** (`violates check constraint
"prospects_search_combo_check"`) que no le dice nada a un usuario no técnico.

### T28-37 · **P1** · Un import exitoso se reporta como "Import status unknown" — REPRODUCIDO

Tercer test, CSV limpio de 2 filas (`test_import_limpio_28_07.csv`: sin combo, icp 80 y
70). Pantalla final:

> **Import status unknown** — *"The request reached the server but the response didn't
> come back properly, so we can't confirm whether these 2 rows were saved — please check
> Leads before re-uploading this CSV."*

**Pero las 2 filas se guardaron perfectamente.** Verificado: el total de leads pasó de
**1258 → 1260**, y ambos aparecen en `/zh/prospects` con SDR Lauren, área 亞洲,
`icp_score` 80/70 y sus `custom1`/`custom2` intactos.

Esa pantalla (`importUnknown`, `CSVImportWizard.tsx:376-385` + `:799-810`) se construyó
para el caso de timeout de la función serverless con lotes grandes. **Se está disparando
con 2 filas**, o sea que el parseo de la respuesta falla en el caso normal, no solo en el
degradado. Riesgo directo: el usuario, siguiendo la instrucción de la propia pantalla,
puede re-subir el CSV y duplicar (o chocar con la unique key).

### ✅ Lo que SÍ funciona bien en el CSV import (verificado en producción)

- **Auto-detección de columnas: 9/9 correctas**, incluidos `custom1`/`custom2` →
  `Custom 1 (msg1)` / `Custom 2 (msg2)`.
- **El banner de mensajes pregenerados aparece y nombra al SDR:** *"These leads already
  have messages generated for **Lauren** — make sure this matches the SDR you're
  assigning to. The message content was written with a specific sender in mind and won't
  be regenerated."* ✓ (en inglés — i18n)
- **Paso 2 es "elegir SDR", no "elegir área"** ✓, y el área se deriva correctamente
  (cabecera: *"2 rows · 8 columns · Area: Asia · SDR: Lauren"*).
- **Frank (`admin`) no aparece en la lista de SDRs** — solo los 9 `sdr` ✓.
- Cap de 5MB y "solo CSV" visibles en el paso 1 ✓.
- Los `custom1`/`custom2` del CSV llegan intactos al lead ✓.
- El paso 4 (重複確認) se saltea solo cuando no hay duplicados — razonable.

### T28-38 · **P1** · Toda la página de Stats está calculada sobre 1000 leads de 1258 — CONFIRMADO

`/zh/stats` dice **`1000 總潛在客戶`**. `/zh/prospects` dice **`1258 個線索`**. Y **todos**
los desglose de Stats suman exactamente 1000:

| Desglose | Suma |
|---|---|
| Funnel (721+181+29+19+6+13+31) | **1000** |
| Por área (423+561+2+14) | **1000** |
| Por temperatura (451+9+9+531) | **1000** |
| Conversion rate | reza literalmente *"13 成交 / 1000 total"* |

**Causa raíz** (`src/components/stats/StatsDashboard.tsx:103-105`):
```ts
let query = supabase.from('prospects').select(STATS_SELECT)
if (!userIsAdmin && user?.area_id) query = query.eq('area_id', user.area_id)
const { data } = await query
```
**Sin `.range()`, sin `.limit()`, sin paginación.** PostgREST aplica su `max-rows` por
defecto (1000 en Supabase) y trunca el resultado **en silencio**; después todas las
métricas se calculan en el cliente sobre ese array truncado (`prospects.filter(...)`).

**Consecuencias:**
- Hoy la página refleja el **79%** de los leads. Con 10.000 leads reflejaría el 10%.
- La tabla **"SDR 業績"** (rendimiento por SDR: asignados / respondidos / cerrados / tasa
  de cierre) sale de los mismos datos truncados. Es la pantalla con la que se juzga el
  desempeño del equipo, y probablemente comisiones.
- El error tampoco se chequea (`const { data } = await query`, sin `error`), así que un
  fallo mostraría un dashboard vacío en lugar de un aviso.

Nota aparte: la suma de "已分配" por SDR da **990**, no 1000 — 10 leads sin dueño dentro
de la ventana truncada.

### T28-39 · P2 · `Frank` (rol `admin`) tiene áreas asignadas y aparece como SDR en Stats — CONFIRMADO

En `/zh/admin/users`, Frank figura como **ADMIN** pero con áreas **亞洲 + 美國**. Y en la
tabla "SDR 業績" de Stats aparece como una fila más, con **10 leads asignados, 1
respondido, 1 cerrado (10.0%)** — y es el "mejor SDR" del ranking por tasa de cierre.

Encaja con el comportamiento viejo del CSV import que `CLAUDE.md` describe como
eliminado (*"the lead self-assigns to whichever admin runs the import"*): quedaron 10
leads históricos auto-asignados al admin. El flujo nuevo ya no lo permite (verificado:
Frank no aparece en el picker de SDR del wizard), pero **los datos viejos siguen ahí y
contaminan el ranking de SDRs**.

### T28-40 · P2 · Bridge: `company_headcounts` y `geo_codes` de la seed list quedan vacíos — CONFIRMADO

`GET /api/bridge/seed-lists` sobre la seed list real (`test reseller list`, creada 27/07):
```json
{ "company_names": ["Acme Corp","Initech","Globex"],   ← ✅ el fix del payload funciona
  "company_headcounts": [],                            ← ❌ vacío
  "geo_codes": [],                                     ← ❌ vacío
  "industry_codes": [] }                                ← ⚠️ hueco documentado
```
El rename `companies` → `company_names` **sí** quedó bien. Pero de los otros tres, solo
`industry_codes` estaba documentado como gap conocido (no existe mapeo nombre→código de
industria). `company_headcounts` y `geo_codes` **deberían resolverse** (el proxy renombra
`criteria.headcounts` y resuelve `criteria.market` contra la tabla `markets`) y están
vacíos. Falta determinar si el formulario no los envía o si la transformación no corre.

Síntoma visible en la UI: la fila de la seed list muestra **"—"** donde iría el resumen
de criterios.

### T28-41 · P2 · Bridge: el matching de compañías es por substring, sin verificación — CONFIRMADO

La seed list pidió `["Acme Corp", "Initech", "Globex"]`. Los 9 candidatos del run
`a59c0b80` pertenecen a: `iniTECH, Inc.`, `MAS ACME USA`, `Acme Machell`,
`Globex Outreach`, `ACME ONE`, `ACME Greentech Ventures Americas`, `ACME Group` (×2),
`ACME Garments Unit`.

Son empresas **sin relación entre sí** que solo comparten el substring. `ACME Greentech
Ventures` es hidrógeno verde y `ACME Garments Unit` es textil en Bangladesh. *(Atenuante
honesto: los nombres de la seed list son inventados, así que cualquier match es
espurio por definición — el test no distingue "matching malo" de "input de test". Pero
sí prueba que **no hay verificación de exactitud ni de identidad de compañía**, lo que
con un nombre real y corto —"Apple", "Delta"— daría el mismo ruido.)*

2 de los 9 candidatos tienen `company_id: ""` y `company_linkedin_url: null`, o sea que
ni siquiera se resolvieron a una página de compañía de LinkedIn.

### T28-42 · P2 · Bridge: QA-F26 no es reproducible con los datos actuales

El fallback `'Unknown company'` (`BridgeClient.tsx:310`) **sigue en el código**, pero
**no se dispara** con la data real: los 9 candidatos tienen `company` poblado. Además el
backend devuelve `company` **y** `company_name` con el mismo valor (campos duplicados),
así que el `c.company || 'Unknown company'` prácticamente nunca cae al fallback.

**Veredicto honesto: no reproducible hoy, código todavía vulnerable.** No lo cuento como
arreglado (nunca se escribió un fix) ni como bug activo (no se manifiesta).

### T28-46 · **P1** · Bridge confirma, genera mensajes, asigna… y los candidatos NUNCA llegan a `prospects` — EJECUTADO DE PUNTA A PUNTA

**Test ejecutado con autorización explícita.** Seleccioné los 9 candidatos del run
`a59c0b80`, los asigné a **Antonio** y apreté **"Confirm & Send Messages"**.

**Lo que funcionó (QA-F27 ✅):**
- `POST /api/bridge/candidates/confirm-batch` → **200**
- Los 9 pasaron de `Pending (9)` a **`Confirmed (9)`**; los contadores de las pestañas se
  actualizaron bien.
- Mensaje de éxito: *"✅ 9 candidates confirmed and assigned to Antonio."*
- Cada candidato ganó un link **"View message"**.
- En `bridge_candidates`: los 9 con `verification_status: "confirmed"`,
  `assigned_to: bf9797d3…` (Antonio) y `custom1`/`custom2` **generados y correctos** —
  personalizados por persona y compañía, con la identidad real de su sender profile
  (*"I'm Antonio from Insight Software"*, *"Antonio, Marketing Specialist at Insight
  Software"*).

**Lo que NO funcionó:** el total de leads en `/zh/prospects` quedó en **1260 — idéntico
al de antes de confirmar**. Cero filas nuevas. Búsqueda por `ACME|iniTECH|Globex|Machell`
en la grilla: **0 resultados**.

> **Los 9 candidatos existen, están confirmados, tienen mensajes escritos y tienen dueño
> asignado — y Antonio no los ve en ningún lado.** El pipeline muere en
> `bridge_candidates`; nada cruza a `prospects`.

Esto **confirma conductualmente** lo que había marcado como "SOSPECHOSO / no verificable"
al leer el código: no hay ni un `from('prospects')` en todo `/api/bridge/[...path]`, y la
UI nunca verifica que los candidatos aterricen. El paso de `bridge_candidates` →
`prospects` **no existe en ninguna de las dos capas** que puedo inspeccionar.

**Impacto:** Bridge es inútil de punta a punta. Todo el flujo reporta éxito en cada paso
—seed list, run, candidatos, confirmación, mensajes— y el resultado no llega al SDR. Un
admin no tiene ninguna forma de detectarlo salvo ir a preguntarle al SDR si vio algo.

**Falta determinar** si el paso que falta es responsabilidad del backend (que debería
escribir en `prospects` y no lo hace) o del CRM (que debería hacerlo tras el 200 del
confirm-batch y nunca se implementó). Desde el CRM se ve que **nadie lo hace**.

### ⚠️ T28-00 — CORRECCIÓN IMPORTANTE tras el test de Bridge: la hipótesis de la proxy se debilita

El test de Bridge es la mejor evidencia que conseguí sobre el P1, y **va en contra de mi
propia conclusión anterior**.

Los 9 mensajes de Bridge salieron en **inglés correcto**, con:
- la **misma proxy** (`api.aitokenking.com.tw`),
- el **mismo modelo** (`claude-sonnet-5`),
- un sender profile con **`language = null`**, igual que en los runs del scraper.

**Si la proxy o el modelo estuvieran ignorando la instrucción de idioma de forma
sistemática, estos mensajes también tendrían que haber salido mal.** No fue así.

**Ranking de hipótesis revisado:**

1. **El código ISO crudo en el prompt del scraper** sube a primer sospechoso para el caso
   Canadá/USA. `message_generator.py:156` produce literalmente *"Write two LinkedIn
   outreach messages in **en** for this prospect"*. Bridge **no** pasa por
   `_language_instruction()` (tiene su propio generador en el backend, con
   `bridge_context`) y salió bien. La diferencia entre los dos caminos es justamente esa
   instrucción degenerada.
2. **La inconsistencia Taiwan sigue sin explicación.** Ahí la instrucción **sí** es prosa
   completa e inequívoca (*"Traditional Chinese (繁體中文), as used in Taiwan"*), y aun así
   `51e22fbd` volvió en simplificado y `3fc2c8b2` en tradicional. La teoría del código ISO
   **no cubre este caso**.
3. **La proxy/modelo queda como sospechoso solo del no-determinismo** (el caso Taiwan), no
   de un incumplimiento sistemático.

**Plan de aislamiento actualizado** (reemplaza el anterior, reordenado por valor
informativo):

1. **Repetir el mismo run de Taiwan 2-3 veces sin cambiar nada.** Si el script varía entre
   corridas con prompt idéntico, hay no-determinismo real y el sospechoso es
   modelo/proxy. Es el único test que ataca el caso que ninguna otra hipótesis explica.
2. **Llamar a la proxy a mano con el prompt exacto de `_build_prompt` y `"in en"`**, y
   comparar contra el mismo prompt con `"English"`. Si "in en" devuelve español y
   "English" no, el caso Canadá/USA queda cerrado y el fix es de una línea.
3. Comparar el prompt del generador de Bridge contra el del scraper para ver qué más
   difiere además de la instrucción de idioma.

### T28-43 · ~~P2~~ · Bridge: el run existente quedó a medias — **RESUELTO, ver T28-46**

Los 9 candidatos del único run de Bridge están en:
```
verification_status: "pending"   ·   custom1: null   ·   custom2: null   ·   assigned_to: null
```
O sea que **"Confirm & Send Messages" nunca se completó** sobre este run, consistente con
lo que `testing_28_07.md:26` marcaba como pendiente. **No lo ejecuté a propósito:** genera
mensajes vía la proxy de Anthropic (que es el sospechoso principal de T28-00) y el botón
dice "Send Messages" sobre un backend que no puedo inspeccionar. Requiere OK explícito.

### T28-44 · P3 · Dashboard y History muestran números distintos para los mismos runs — CONFIRMADO

`/zh/dashboard` → 近期任務 muestra **"10 個線索"** para los cinco runs recientes.
`/zh/history` muestra para esos mismos runs: **4, 10, 4, 8 y 6** leads.

Probablemente uno muestra lo *pedido* y el otro lo *entregado* (el bloque 最新任務 sí
aclara **已請求** 10 個線索), pero 近期任務 no lo aclara y queda como si todos los runs
hubieran traído 10. Totales del dashboard: 50 runs, 3930 leads pedidos.

### T28-45 · P3 · Convertidos: 12 de 13 deals cerrados no tienen conversación — CONFIRMADO

`/zh/convertidos` muestra **`12 無對話` / `1 有對話`** sobre 13 deals cerrados. La feature
del `CloseDealModal` (que exige subir el chat al cerrar) es nueva, así que estos 12 son
históricos anteriores al gate. Confirma que el badge de "Missing conversation" tiene sobre
qué disparar, y que **hay 12 deals cerrados sin evidencia de la conversación** — relevante
si eso alimenta comisiones.

### T28-32 · **P1** · El Audit Log de los 4 campos editables NUNCA registró nada: falta `'prospect_updated'` en el CHECK constraint — CONFIRMADO CON PRUEBA CONTROLADA

**El hallazgo más concreto de la pasada en browser.** La feature de auditoría de los
campos editables del Prospect Drawer está **100% muerta en producción**, en silencio.

**Evidencia 1 — nunca registró un solo evento.** En `/zh/audit`, filtrando por
`更新潛在客戶` (`prospect_updated`) + **All time** + **All events** + All Actors:
**`0 個事件` / "未找到事件"**. Sobre un total de **711 eventos** en el historial. Todos
los otros tipos sí aparecen (`prospect_created`, `status_changed`,
`prospect_reassigned`, `note_added`, `sdr_created`, `sdr_deactivated`, `csv_import`).

**Evidencia 2 — la request falla con 400.** Editando el Job Title de un lead real y
capturando la red:
```
POST https://<proyecto>.supabase.co/rest/v1/audit_log → 400
```

**Evidencia 3 — comparación controlada, tres inserts idénticos variando solo `event_type`:**

| `event_type` enviado | Status | Error |
|---|---|---|
| `prospect_updated` | **400** | `23514` — *violates check constraint `audit_log_event_type_check`* |
| `status_changed` | 409 | `23503` — FK de `actor_id` (mi UUID de prueba). **Pasó el CHECK.** |
| `zzz_definitely_invalid` | **400** | `23514` — **error idéntico al de `prospect_updated`** |

`'prospect_updated'` se comporta exactamente como un valor inventado. **No está en la
lista permitida del CHECK.** *(Ninguno de los tres inserts creó filas — todos
fallaron.)*

**Causa raíz, dos capas:**

1. **La migración que amplía el CHECK nunca se escribió.** Es literalmente el patrón
   que `CLAUDE.md` documenta como trampa conocida para `addon_type` — *"Adding a new
   one requires both an `ADDON_LIST` entry **and** a migration widening the CHECK
   constraint"* — repetido en otra tabla. Agravante: **no existe ninguna migración de
   `audit_log` en el repo** (`grep -rln audit_log supabase/migrations/` → 0), así que
   la lista de valores permitidos no es consultable desde el código. Nadie podía
   detectarlo leyendo el repo.
2. **`logAuditEvent()` nunca chequea el error** (`src/lib/utils/audit.ts`):
   ```ts
   await supabase.from('audit_log').insert({ ...event })   // sin capturar { error }
   ```
   Sin `const { error } = await …`, sin rama de fallo, sin log a consola. Un 400 es
   indistinguible de un éxito para todo el resto de la app.

**Por qué importa más de lo que parece:** el Audit Log es la herramienta que se consulta
justamente cuando un dato no cuadra. Un admin que edite Company, Job Title, Market o
Search Combo ve el toast verde 已儲存, el cambio se persiste de verdad en `prospects`,
y **no queda ningún rastro de quién lo cambió ni de cuál era el valor anterior**. Para
`market` es especialmente grave porque ese cambio arrastra el `area_id` (T28-33), o sea
reasigna el lead de área sin registro.

**Corrección a T28-05:** había reportado que el drawer escribe una *entrada fantasma* al
Audit Log cuando el UPDATE falla. **Eso no puede pasar** — el insert de auditoría falla
siempre, con o sin éxito del UPDATE. El problema real es el inverso y peor: **no hay
auditoría en absoluto**. Lo que sí sigue en pie de T28-05 es el toast verde mentiroso
(`updateField` sin rama `else`): ahora sabemos que **los dos** fallos posibles se comen
en silencio.

### T28-33 · P2 · QA-F31 anda, pero deja el lead asignado a un SDR de otra área y el drawer dice "未分配" — REPRODUCIDO EN VIVO

Test ejecutado sobre un lead real (org de prueba, autorizado): **Jean-Maxime Fangous**,
que estaba `market = "Asia"`, `área = 亞洲`, `負責人 = Lauren`.

**Acción:** cambiar Market a **Argentina** (otra región) desde el drawer.

**La mitad que funciona (QA-F31 ✅):** el badge de área cambió a **拉丁美洲**
inmediatamente, sin refrescar, y salió el toast **已儲存**. Verificado persistido en la
grilla tras recargar: `area = 拉丁美洲`, `market = Argentina`.

**La mitad que falla (T28-15, reproducido exacto):** en el mismo instante, el select
**"Assigned to" pasó a mostrar `未分配` (Unassigned) con `value = ""`**, y sus opciones
se redujeron a `未分配, Antonio, Nicolas Nicoli` — los SDRs de `latin_america`. **Lauren
desapareció de la lista.**

**Pero en la base sigue asignada a Lauren.** Confirmado recargando la grilla: la fila
muestra `拉丁美洲 | Lauren | Argentina`. O sea que quedó:

> un lead de **latin_america**, propiedad de una SDR de **asia**, que el drawer reporta
> como **sin asignar**.

**Mecanismo, confirmado sin escribir antes de hacer el test:** el select de "Assigned
to" está filtrado por el área del prospecto. Con el lead en `asia` ofrecía **6** SDRs
(Evelyn, Lauren, Liju, Penny, Serena, Yulanda) contra los **9** del filtro de la página
— faltaban Antonio, small y Nicolas Nicoli. Al cambiar de área, `sdrsForArea` recarga
(`ProspectDrawer.tsx:115-125`), el dueño actual ya no está entre los `<option>`
(`:493-501`), y el navegador cae a la primera opción.

**Los dos riesgos concretos:**
1. **Reasignación accidental:** el select dice "sin asignar" y su `value` es `""`. Un
   admin que quiera "arreglar" eso toca el dropdown y reasigna un lead que ya tenía
   dueño, creyendo que estaba huérfano.
2. **Nadie se entera nunca:** por T28-32 este cambio de mercado **no dejó ninguna
   entrada en el Audit Log**. Cambió el área de un lead, quedó inconsistente con su
   dueño, y no hay registro de que haya pasado.

*Estado dejado en la org de prueba (a propósito, para que se pueda inspeccionar): el
lead Jean-Maxime Fangous quedó con `market = Argentina`, `area = latin_america`,
`assigned_to = Lauren`, y su Job Title con el sufijo " TEST" del segundo test.*

### T28-29 · P1 · `admin_global` puede editar leads de cualquier org sin impersonar, salteando el read-only — CONFIRMADO

`CLAUDE.md` describe el diseño: Global Admin ve el CRM de una org **como read-only**
vía `?impersonate_org_id=…`, y "all write operations short-circuit when
`isImpersonating` is true".

**El agujero: `admin_global` puede navegar a las páginas del CRM directamente, sin el
query param.** Nada lo redirige — el middleware solo tiene un gate para `sdr`
(`route-guard.ts:13-17`) y para `support` (`middleware.ts:120-128`). Con la URL pelada
`/zh/prospects`, `isImpersonating` es **`false`**, así que **ningún short-circuit de
escritura se activa**.

Verificado en el DOM del Prospect Drawer, logueado como `admin_global` en
`/zh/prospects` sin impersonar — todos los campos vienen habilitados:

```
INPUT text  "Hex Trust"          disabled:false readOnly:false   ← Company
INPUT text  "Head of Marketing"  disabled:false readOnly:false   ← Job Title
INPUT number "40"                disabled:false readOnly:false   ← ICP Score
SELECT      "Asia"               disabled:false                  ← Market
SELECT      "combo_B"            disabled:false                  ← Search Combo
SELECT      "new"                disabled:false                  ← Outreach Status
SELECT      "Cold"               disabled:false                  ← Temperature
```

Y la lista muestra **1671 leads** — la unión de las 4 orgs (como org admin de
AITokenSales eran 1258), habilitado por la política
`"admin_global reads all prospects"`. **Sin ninguna columna de organización**, así que
los leads de las 4 orgs son indistinguibles entre sí en la grilla.

**Combinación de riesgo concreta:** un `admin_global` que quiere "mirar" el CRM y entra
por la URL directa (el camino natural desde el sidebar, que sigue mostrando los links
del CRM) obtiene una grilla mezclada de 4 orgs, sin saber de quién es cada lead, con
todos los campos editables y el `CloseDealModal`/audit trail comportándose como si
fuera su propia org. Un click accidental en el dropdown de estado escribe en la org de
un cliente.

**Nota:** no es escalación de privilegios (`admin_global` tiene la potestad), es un
**guardarraíl ausente**: el modo read-only existe pero es opt-in por query param en
lugar de ser el default para este rol.

### T28-30 · P2 · Para `admin_global`, el select de Market queda con una sola opción real — CONFIRMADO

En el mismo drawer, el `<select>` de Market tiene exactamente **dos** opciones:
`""` y `"Asia"` (el valor actual, vía el fallback de `ProspectDrawer.tsx:454-456`).
Causa: `useOrgMarkets()` no devuelve nada porque `admin_global` tiene
`organization_id = null`, así que no hay catálogo de mercados de org que ofrecer.

**Dos consecuencias:**
1. **QA-F31 no se puede testear desde esta vista** — no hay ningún país al que cambiar.
   Requiere sesión de **org admin**.
2. **La única edición posible es poner Market en blanco**, y eso dispara exactamente la
   falla silenciosa de T28-15: `inferAreaFromCountry('')` → `null` → el `market` se
   guarda vacío y el **`area_id` queda con el valor viejo, sin aviso**. Queda un lead
   sin mercado pero con área, que es el estado inconsistente que QA-F31 buscaba
   eliminar. Y por T28-29 el campo está habilitado, así que es alcanzable con dos
   clicks.

### ✅ Confirmado · Search Combo resuelve código → label en producción

Mismo drawer: el `<select>` tiene `value = "combo_B"` y muestra **"Marketing
Director"**. `useComboLabels()` funciona como documenta `CLAUDE.md`. ✓

### ✅ Confirmado · `prospects.market` guarda el label de región en runs multi-país

El lead abierto tiene `market = "Asia"`, no un país. Coincide con
`HANDOFF.md:127-131` y con `apify_scraper.py:797` (`market_label = region_label(...)`
cuando hay más de un país). **Consecuencia práctica no documentada:** ese valor **no
existe en la tabla `markets`**, así que cualquier UI que ofrezca cambiar el Market de
ese lead no puede re-seleccionar su valor actual desde el catálogo — solo vía el
fallback. Y `inferAreaFromCountry("Asia")` devuelve `null`.

### T28-27 · P2 · `anthropic_base_url` guardado en 3 formatos distintos; 2 de 4 orgs apuntan a un endpoint incompleto — CONFIRMADO

Leído vía `GET /api/global-admin/organizations`:

| Org | Valor guardado | Endpoint efectivo | |
|---|---|---|---|
| AITokenSales | `https://api.aitokenking.com.tw/api/v1` | `/api/v1` | ✅ por carambola |
| Insight Software | `https://api.aitokenking.com.tw/api` | `/api/v1` | ✅ |
| testorg | `https://api.aitokenking.com.tw` | **`/v1`** | ❌ falta `/api` |
| testdos | `https://api.aitokenking.com.tw` | **`/v1`** | ❌ falta `/api` |

Dos problemas distintos:

1. **AITokenSales tiene un valor que termina en `/v1`, que es exactamente lo que
   `normalizeAnthropicBaseUrl()` existe para impedir.** El normalizador
   (`src/lib/utils/anthropic.ts`) sí strippea el `/v1` final y sí se invoca en las tres
   rutas de escritura (`api/settings/organization/route.ts:53`,
   `api/global-admin/organizations/[id]/route.ts:95`, `api/global-admin/create-org/route.ts:75`).
   Así que **o es una fila anterior a que existiera el normalizador, o hay un camino de
   escritura que lo saltea**. La invariante que el código promete no se cumple en los
   datos. Se salva únicamente porque `_build_async_client`
   (`message_generator.py:217-219`) hace el mismo strip del lado backend — defensa en
   profundidad tapando el agujero.
2. **El normalizador solo se ocupa del sufijo `/v1`, no valida el prefijo.** Un host
   pelado se acepta tal cual y produce `/v1` sin el segmento `/api`. Las dos orgs de
   test están así: sus runs pegarían a un endpoint que no es el de la proxy.

### ✅ QA-F28 — confirmado en producción (parcial, como decía el análisis de código)

`/zh/global-admin/organizations/{id}` → el campo Vendor **es** un `<select>` poblado
desde `vendors`, con opciones `direct|Direct (no vendor)`,
`testvendor|testvendor (30%)` y **`other|Other (type below)`**. El escape de texto
libre está intacto, así que el riesgo original (duplicados por typo partiendo el
reporte de Revenue) **sigue alcanzable**.

### ✅ QA-F29 — confirmado en producción: son tres mecanismos

Botones **"Save Organization Info"** y **"Save API Keys"**, más el textarea de Internal
Notes con el cartel literal *"Auto-saves on blur"*. Coincide exactamente con el
análisis de código (T28-14), incluido que el de API Keys es el que ignora el status
HTTP.

### T28-31 · P3 · La página de Vendors tiene un botón que dice "Deactivate Organization" — CONFIRMADO

En `/zh/global-admin/vendors`, las acciones de una fila de **vendor** son
`Edit` · **`Deactivate Organization`** · `Delete`. Un vendor no es una organización.

**Causa raíz:** `src/contexts/GlobalAdminThemeContext.tsx:70` define la clave
compartida con un valor demasiado específico:
```ts
deactivate: 'Deactivate Organization', changeStatus: 'Change Status',
```
`vendors/page.tsx:213` llama `t('deactivate')` **correctamente** — el bug está en el
valor de la clave, no en el uso. Como la clave es compartida entre la pantalla de orgs
y la de vendors, cualquier fix tiene que separarla en dos claves (`deactivateOrg` /
`deactivateVendor`) o dejarla genérica (`Deactivate`) y que cada pantalla agregue su
sustantivo.

### ✅ Confirmado · Usuarios Support: solo desactivar, nunca borrar

`/zh/global-admin/support` ya tiene un usuario creado
(`Support@insight-software.com`, Active), y la única acción de la fila es
**`Deactivate`**. Confirma el análisis de código: la API
(`api/global-admin/support-users/route.ts`) no expone `DELETE`, así que la fila queda
para siempre. Contrasta con Vendors, que **sí** tiene `Delete`.
*(Útil para más adelante: existe una cuenta Support real, así que el bloque de testing
del rol Support es ejecutable sin crear nada nuevo.)*

### ✅ Revenue Q1 — aritmética verificada a mano, cierra exacta

| Concepto | Valor | Verificación |
|---|---|---|
| MRR total | $550/mo → $1,650 Q | 550 × 3 ✓ |
| Setup fees Q1 | $2,000 | 2 orgs × $1,000 ✓ |
| Gross revenue | $3,650 | 1650 + 2000 ✓ |
| Costos | −$1,245 | 415 × 3 ✓ (infra 20+25+20=65, API 200+150=350) |
| Comisión vendor | −$795 | 30% de 2650 (1650 MRR + 1000 setup de testorg) ✓ |
| **Net to distribute** | **$1,610** | 3650 − 1245 − 795 ✓ |
| Profit sharing | $805 + $805 | = 1610 exacto, **sin desfase de $1** ✓ |

`testdos` está `Inactive` y sin vendor, así que correctamente **no** entra en el Q REV
del vendor aunque su setup fee sí cuente en el gross. ACTIVE CLIENTS = 1 ✓.

**Falso positivo que descarté:** `get_page_text` mostraba los inputs de costos vacíos
("Vercel $ /mo"), pero leyendo el DOM tienen valores (20, 25, 20, 200, 150). Era una
limitación de la extracción de texto, no un bug de la app — las herramientas de
extracción de texto no leen `input.value`.

### T28-28 · P3 · Global Admin renderiza en inglés con la app en 繁中 — CONFIRMADO

La barra de Global Admin tiene su propio toggle **中文 / EN**, independiente del locale
de la URL (`/zh/…`). Toda la pantalla de detalle de org está en inglés: "Organization
Info", "Billing Day", "Danger Zone", "Deactivate Organization", los 6 add-ons. Coincide
con los 114 strings de Global Admin de la Sección 6.

### ✅ Confirmaciones menores de producción

- **Settings tiene 3 tabs** (Organization, Plan & Usage, Scraper) y **ninguno es
  Pipeline** → el editor de pipeline efectivamente se eliminó, y el Kanban sigue
  renderizando sus 7 columnas con labels traducidos (新線索, 已發送連結請求, 已連結,
  已回覆, 已排定演示, 已成交, 培育中). Consistente con lo que documenta `CLAUDE.md`.
- **Search Combos muestran labels legibles**, no códigos: "IT Manager / CIO",
  "CTO / VP Engineering", "Digital Transform / CDO", etc. 9 activos.
- **`testorg` es la org de cupo chico** de la metodología: Usage muestra
  `SDRS 0 / 3` y `LEADS THIS MONTH 0 / 5`.
- **Sidebar del CRM sí está traducido** (看板, 潛在客戶, 匯入 CSV, 已成交, 支援,
  審計日誌, 統計數據, 用戶管理, 設定, 儀表板, 新抓取任務, 歷史記錄, 合作夥伴). El
  problema de i18n es de páginas, no del shell.
- **1258 leads en la org** AITokenSales, 51 páginas — hay volumen real para testear.
- Copy desactualizado: la sección Search Combos dice *"Enable the search combos your
  team will use in **New Pipeline**"*, pero la feature se llama **New Run**
  (`/zh/run`, "新抓取任務").

---

## Sección 7c — Rol SDR (sesión de Antonio, multi-región: latin_america + asia + europe)

### ✅ QA-F35 y el gating de API — CONFIRMADO EN PRODUCCIÓN, sólido

Barrido de endpoints con sesión real de `sdr`:

| Endpoint | Status | Respuesta |
|---|---|---|
| `GET /api/runs` | **403** | `{"error":"Forbidden"}` ✅ **QA-F35 cerrado** |
| `GET /api/runs/quota` | **403** | `{"error":"Forbidden"}` ✅ |
| `GET /api/bridge/seed-lists` | **403** | `{"error":"Only the organization admin can use Bridge"}` ✅ |
| `GET /api/bridge/runs` | **403** | ídem ✅ |
| `GET /api/global-admin/organizations` | **401** | `{"error":"Unauthorized"}` ✅ |
| `GET /api/scraper-combos` | 200 | catálogo completo — **intencional y necesario**: el Kanban del SDR muestra los labels de combo en cada tarjeta |
| `GET /api/sender-profiles` | 200 | **solo el perfil propio** (`user_id` = Antonio) — correctamente scopeado ✅ |
| `GET /api/settings/addons` | 200 | `{"addons":["bridge"]}` — un SDR puede leer qué add-ons tiene la org. Info menor, sin riesgo real (la API de Bridge lo bloquea igual). |

### ✅ Sidebar y bloqueo por URL directa — CONFIRMADO

Sidebar del SDR: exactamente **5 links** (`/kanban`, `/prospects`, `/import`,
`/convertidos`, `/support`). Sin scraper, sin Bridge, sin audit/stats/users/settings ✓.

Bloqueo por URL directa (medido con `fetch(path, {redirect:'manual'})`):

| Ruta | Resultado |
|---|---|
| `/zh/run`, `/zh/history`, `/zh/dashboard`, `/zh/bridge`, `/zh/audit`, `/zh/admin/users`, `/zh/export`, `/zh/global-admin/organizations` | **`opaqueredirect`** → redirigido ✅ (8 de 10) |
| `/zh/settings` | **200** ⚠️ ver T28-47 |
| `/zh/stats` | **200** 🔴 ver T28-47 |

### T28-47 · P2 · `/zh/stats` y `/zh/settings` no tienen guard SSR para SDR — CONFIRMADO

Ninguna de las dos está en la lista de páginas con `blockSdrAccess()` que documenta
`CLAUDE.md` (`/admin/users`, `/audit`, `/history`, `/bridge`, `(scraper)/dashboard`,
`(scraper)/run`, `(scraper)/export`).

- **`/zh/settings`** → devuelve 200 y renderiza el guard de cliente:
  *"Settings are only accessible to organization admins."* (`settings/page.tsx:719`).
  **No filtra datos**, pero es exactamente la fragilidad que `CLAUDE.md` describe como
  FUNC-F12: la página monta para un rol que no debería estar ahí, así que cualquier
  componente futuro que haga un fetch en el mount filtraría sin que nadie lo note.
- **`/zh/stats`** → devuelve 200 y **renderiza el dashboard completo**, scopeado a los
  leads del propio SDR. **Inconsistencia de producto a resolver:** el sidebar se lo
  esconde (no hay link a 統計數據 para `sdr`) pero la página funciona por URL directa. O
  el sidebar debería mostrarlo, o la página debería tener el guard — hoy son dos
  decisiones contradictorias.

### T28-48 · **P1** · Stats de un SDR multi-región solo cuenta su área primaria — CONFIRMADO CON ARITMÉTICA

Antonio tiene **3 áreas** (`latin_america`, `asia`, `europe`, verificado en
`/zh/admin/users`). Su `/zh/stats`:

- `222 總潛在客戶`
- 按地區: **solo `Latin America` 2/222**. Ni Asia ni Europe aparecen.

**Pero su propio Kanban suma 224** (NEW 217 + Connection Sent 2 + Replied 2 + Demo 1 +
Closed 2), y **muestra 2 tarjetas con badge 歐洲** (`imposter` y `acme master`).

**222 vs 224, y los 2 que faltan son exactamente los dos europeos.**

**Causa raíz** (`StatsDashboard.tsx:104`):
```ts
if (!userIsAdmin && user?.area_id) query = query.eq('area_id', user.area_id)
```
Filtra por **`users.area_id`** — el campo estático de área *primaria* — en lugar de por
las áreas reales del SDR en **`user_areas`**. Es la misma clase de error que QA-F25
(usar el área estática del SDR en vez de la real), en otro archivo y sin arreglar.

Un SDR multi-región ve un dashboard que le esconde silenciosamente los leads de todas
sus regiones menos una. Con 2 leads es anecdótico; con un SDR que trabaje mitad Asia y
mitad LATAM, le esconde la mitad de su desempeño.

*(Nota: esto es independiente del truncado a 1000 filas de T28-38, que afecta la vista
de admin. Acá el problema es el filtro de área, no el límite.)*

### T28-49 · **P1** · ~217 leads en el board de Antonio tienen el área equivocada — datos legacy de QA-F25, sin backfill — CONFIRMADO

Casi todas las tarjetas del Kanban de Antonio llevan badge **拉丁美洲 (Latin America)**,
incluidas compañías inequívocamente no-latinoamericanas:

| Lead | Compañía | Badge |
|---|---|---|
| 黃上銘 | 薈智創新科技股份有限公司 IIoTFab Inc. (Taiwán) | 拉丁美洲 ❌ |
| Chan Liang Wu | MICROIP (Taiwán) | 拉丁美洲 ❌ |
| YT kang | 金寶集團 KINPO GROUP (Taiwán) | 拉丁美洲 ❌ |
| Danny Lin | CloudMosa — *"General Manager, Taiwan Branch"* | 拉丁美洲 ❌ |
| Edith H. | Audi **Taiwan** | 拉丁美洲 ❌ |
| Kelly Y.J. Chen | Influenxio 圈圈科技 (Taiwán) | 拉丁美洲 ❌ |
| Peng-Yu Chen | Commonwealth Magazine (Taiwán) | 拉丁美洲 ❌ |
| Naida Spiodic | City Administration of Kirchheim unter Teck (**Alemania**) | 拉丁美洲 ❌ |
| Al Kingsley MBE | NetSupport Software Limited (**UK**) | 拉丁美洲 ❌ |

Solo 2 de ~224 tarjetas muestran 歐洲, y ninguna 亞洲 — aunque hay decenas de leads
taiwaneses en el board.

**Es la firma exacta del root cause de QA-F25**: `assignRunLeads()` seteaba `area_id`
desde el campo estático del SDR en lugar del mercado real del run. El smoke test de hoy
confirmó que **el fix funciona para runs nuevos**, pero:

> **nadie corrigió los datos históricos.** Los ~217 leads asignados antes del fix
> siguen con el área equivocada, y el fix no es retroactivo.

**Consecuencias inmediatas:** el filtro por área de Antonio es inservible (filtrar por
Asia no le muestra ni uno de sus leads taiwaneses), su badge de área miente en cada
tarjeta, y por T28-48 su Stats cuenta 222 de 224. Requiere una migración de backfill que
recalcule `area_id` desde `prospects.market` — que es justo lo que
`inferAreaFromCountry()` ya sabe hacer.

### ✅ Confirmado desde la vista del SDR · Los candidatos de Bridge no llegaron

El Kanban de Antonio **no contiene ninguno** de los 9 candidatos que le asigné vía Bridge
(ni `iniTECH`, ni `Globex Outreach`, ni `ACME Group`, ni ninguno). Confirma T28-46 desde
el otro lado del flujo: el admin ve "9 candidates confirmed and assigned to Antonio" y
**Antonio no tiene nada**.

### ✅ Support desde la vista del SDR — CONFIRMADO CORRECTO

`/zh/support` como `sdr`: título *"Submit and track your support requests"*, y la lista
arranca en **"No tickets yet. Everything is good! 🎉"** — correctamente scopeada a sus
propios tickets (`created_by = él`), no a los de la org. **Y puede crear** ("New Ticket"
presente) ✓, coincidiendo con el análisis de código.

Creación verificada de punta a punta: ticket **"TEST Realtime 28/07"**, prioridad HIGH
(el selector ofrece Low/Medium/High/Urgent, default Medium), quedó `OPEN` con
`created_by = bf9797d3` (Antonio) y `organization_id = b02f95b2` correctos. Al expandirlo
aparece badge **"LIVE"**, la sección ORIGINAL REQUEST y la caja de respuesta. Respuesta
enviada OK (contador → "1 message", atribuida a "You" con timestamp).

### ✅ T28-20 — REFUTADO: el Realtime de tickets SÍ funciona en producción

Había marcado como *"el modo de falla más probable al estrenar la feature"* que las dos
migraciones de Realtime no estuvieran corridas, en cuyo caso la feature moriría **sin dar
ningún error**.

**Verificado y funciona.** El ticket creado por Antonio apareció en la ventana de Support
(sesión separada, incógnito) **sola, sin refrescar**. Consistente con la consulta SQL
previa, que ya confirmaba `support_tickets` y `support_ticket_messages` en la publicación
`supabase_realtime`. Riesgo cerrado.

### T28-51 · P2 · El sonido de aviso de ticket nuevo no suena en el escenario para el que existe — CONFIRMADO

En la misma prueba: el ticket llegó en vivo pero **no sonó ningún aviso**, con la sesión
de Support (que es `isCrossOrgViewer`, o sea la única que debería escucharlo,
`support/page.tsx:199`).

**Causa raíz** (`support/page.tsx:152-176`): `playNotificationSound()` empieza con
```ts
const ctx = audioCtxRef.current
if (!ctx) return
```
y ese `AudioContext` **solo se crea dentro de un handler de `pointerdown`/`keydown`
registrado con `{ once: true }`** (líneas 164-165). El comentario del código reconoce el
problema de autoplay de los navegadores y lo resuelve a medias:

1. **Si el agente abre la pestaña y no clickea dentro**, `audioCtxRef.current` queda
   `null` y la función retorna en silencio. Es exactamente lo que pasó en el test: la
   ventana de Support estaba abierta, mirando, sin interacción. **Y es exactamente el
   flujo de trabajo de un agente de soporte esperando tickets.**
2. **La rama de recuperación es inalcanzable.** El `else if (ctx.state === 'suspended')
   ctx.resume()` (líneas 160-162) vive dentro del mismo handler `once`, que ya se
   desregistró tras el primer disparo. Chrome **suspende el AudioContext cuando la
   pestaña pasa a segundo plano** — que es donde va a estar esa pestaña — y no queda
   ningún camino para reactivarlo.

O sea: el sonido funciona sólo si el agente clickeó en la página y la mantuvo en primer
plano. En cualquier otro caso —los dos escenarios reales— es silencioso. El propio código
lo cataloga como *"sound is a nicety, not critical"*, así que la severidad depende de si
el negocio cuenta con el aviso para tiempos de respuesta.

**Nota:** un `sdr` correctamente **no** escucha el sonido (`isCrossOrgViewer` es false), y
eso está bien.

### ✅ Convertidos desde la vista del SDR — CONFIRMADO CORRECTO

`/zh/convertidos` como Antonio: **`2 total`** (sus dos deals cerrados: John Carter y
Federico Repond), no los 13 de la org. Correctamente scopeado ✓. Muestra el desglose
`1 無對話 / 1 有對話` y el copy obligatorio traducido: *"如果您成交了，請上傳對話記錄。這是必須的。"*
El badge de conversación faltante tiene sobre qué disparar también en la vista del SDR.

### T28-50 · P3 · `cleanScrapedName()` no se aplicó a datos existentes — CONFIRMADO

En el Kanban de Antonio hay un lead llamado literalmente
**`Jassen Castillo - Software Engineer`** — nombre con el cargo pegado, que es el caso
exacto que `cleanScrapedName()` (`src/lib/utils/clean-name.ts`) existe para limpiar, y el
ejemplo textual que usa `CLAUDE.md` para documentarlo.

O el lead es anterior al fix (más probable), o la limpieza no se está aplicando. En
cualquier caso: **sin backfill**, igual que T28-49. Cosmético, pero se le muestra al
prospecto en el saludo del mensaje si el nombre se interpola.

---

## Sección 7d — Verificación directa en Supabase (SQL, cierre de inferencias)

Con acceso al SQL editor pude convertir varias inferencias en hechos. Todo lo de abajo
sale de `pg_constraint` / `pg_policies` en **producción**.

### ✅ T28-32 PROBADO EN LA FUENTE — `prospect_updated` no está en el CHECK

```sql
SELECT pg_get_constraintdef(oid) LIKE '%prospect_updated%' FROM pg_constraint
WHERE conname='audit_log_event_type_check';
→ false          (longitud del CHECK: 226 caracteres)
```
Ya no es inferencia desde un insert de prueba: **el valor no existe en la lista
permitida**. Todo `logAuditEvent({event_type:'prospect_updated'})` falla con `23514`, y
`audit.ts` no lee el error.

### ✅ T28-34 y T28-35 PROBADOS — los constraints exactos

| Constraint | Definición real | Confirma |
|---|---|---|
| `prospects_search_combo_check` | `CHECK (search_combo = ANY (ARRAY['combo_A','combo_B',…]))` | La DB exige **`combo_X`**, el cliente manda letras `A`-`F`. Formato invertido ✓ |
| `prospects_icp_score_check` | `CHECK (icp_score >= 0 AND icp_score <= 100)` | Rango 0-100; mi fila de prueba con **150** estaba correctamente rechazada ✓ |

### ✅ T28-09 PROBADO — el cleanup de RLS de Support NO se corrió

```sql
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('support_tickets','support_ticket_messages');
→ 8 filas
```
**8 políticas vivas** (deberían ser 3 si el cleanup se hubiera corrido). Confirmadas las
viejas que la migración dropea:
- `support_ticket_messages`: **`ticket participants can read messages`** (SELECT) y
  **`ticket participants can insert messages`** (INSERT) — las dos duplicadas
- `support_tickets`: **`admin creates own org tickets`** (INSERT),
  **`admin reads own org tickets`** (SELECT)

Más las nuevas (`org members can read/insert ticket messages`,
`org members can manage their tickets`). Postgres las evalúa con OR, así que no deniegan
nada — pero **duplican el trabajo de evaluación de RLS en cada evento de Realtime** sobre
esas tablas, y la de mensajes es la doblemente anidada. Es un contribuyente plausible a la
latencia de T28-52, además de ser un pendiente ya identificado.

### ⚠️ CORRECCIÓN · El STEP 2 de `pipeline_stages` SÍ está aplicado — `CLAUDE.md` tiene razón

Había marcado como contradicción a resolver que `CLAUDE.md` afirmara que la unicidad está
*"enforced by `UNIQUE (organization_id, outreach_status)`"* mientras el STEP 2 de
`20260726_pipeline_stage_status_mapping.sql` está **comentado** en el archivo.

**Verificado: ambos constraints existen en producción.**
```
pipeline_stages_org_status_unique   UNIQUE (organization_id, outreach_status)
pipeline_stages_status_check        CHECK (outreach_status = ANY (ARRAY['new','connection_sent',…]))
```
O sea que el STEP 2 se corrió **a mano, fuera del archivo**. `CLAUDE.md` es exacto; lo que
está desincronizado es la migración. **Retiro la duda** — pero queda el riesgo real: si
alguien reconstruye la base desde `supabase/migrations/` en orden, esos dos constraints
**no se crean**. Vale descomentar el STEP 2 (es idempotente si ya existen, con
`IF NOT EXISTS`).

### T28-52 · P2 · El Realtime de mensajes llega con demora para Support (no está muerto) — CORRECCIÓN

**Corrijo mi primera lectura de esto.** El comportamiento observado en la prueba en vivo
con dos sesiones simultáneas (Antonio SDR en una ventana, Support en incógnito):

| Evento | Antonio (SDR, miembro de la org) | Support (`organization_id = NULL`) |
|---|---|---|
| `support_tickets` INSERT (ticket nuevo) | — | **✓ inmediato, sin refrescar** |
| `support_ticket_messages` INSERT | **✓ inmediato** (`Support · 5:58:10 PM` apareció solo, bien atribuido, contador 1→2) | **⚠️ con demora** — no apareció al principio (ni colapsado ni expandido), terminó apareciendo |

Primero lo anoté como "nunca llega". **No es así: llega tarde.** Menos grave, pero sigue
siendo un problema para un agente de soporte que necesita responder rápido, y explica por
qué al principio pareció roto.

**Explicación más probable**, con la evidencia que tengo:
- La política de `support_tickets` es **plana** (`organization_id = (…) OR EXISTS (… role IN
  ('admin_global','support'))`). Para Support la primera rama es NULL y la segunda TRUE →
  resuelve rápido. Llega inmediato ✓
- La de `support_ticket_messages` está **doblemente anidada**: un `EXISTS` sobre
  `support_tickets` que adentro tiene *otro* `EXISTS` sobre `users`
  (`20260707_support_fix.sql:59-69`). Para Antonio resuelve por la rama directa
  (`t.organization_id = su org`); **para Support tiene que resolver la rama por rol dentro
  de una subconsulta a otra tabla.**
- Y hay **2 políticas SELECT duplicadas** sobre esa tabla (T28-09 arriba), así que
  Postgres evalúa las dos por cada evento.

**Cómo cerrarlo:** correr el cleanup pendiente (elimina la mitad del trabajo) y, si la
demora persiste, aplanar la política de mensajes — desnormalizar `organization_id` a
`support_ticket_messages` para evitar el join, que es lo que Supabase recomienda para
políticas usadas por Realtime.

**No verificado:** si Support puede *leer* los mensajes por API sin demora (o sea si el
problema es solo de Realtime y no de RLS en general). Ese test necesita la consola de la
sesión de Support.

---

## Sección 7 — Estado de las migraciones

25 archivos, **todas de julio 2026**. Bloque reciente (20-28/07): 15 archivos.

### Pendientes de correr — CONFIRMADO

| Migración | Estado | Consecuencia de no correrla |
|---|---|---|
| `20260728_sender_profile_language_nullable.sql` | pendiente (el P1 sigue "en investigación") | el P1 de idioma no se arregla para perfiles nuevos |
| `20260728_cleanup_duplicate_support_rls.sql` | pendiente (`testing_28_07.md:20`) | las 5 políticas duplicadas siguen vivas (T28-09) — **y ojo, correrla también relaja permisos, ver T28-09** |
| `20260726_pipeline_stage_status_mapping.sql` **STEP 2** | **comentado dentro del archivo** (líneas 67-74) | ver abajo |
| `SELECT cron.schedule('delete-old-leads', ...)` | comentado, `20260702_multi_market.sql:117` | requiere habilitar pg_cron primero |

**Contradicción a resolver — `pipeline_stages`:** `CLAUDE.md` afirma que la
relación 1:1 está *"enforced by `UNIQUE (organization_id, outreach_status)`"*, pero
el `ALTER COLUMN ... SET NOT NULL` + el CHECK + ese UNIQUE **están comentados en el
archivo y el SQL del repo nunca los ejecuta**. O se corrieron a mano fuera del
archivo, o la afirmación de `CLAUDE.md` es incorrecta y la unicidad no está
garantizada. **Verificar en la base** — si no está, dos filas con el mismo
`outreach_status` harían que `stageMap.get(status)` del Kanban devuelva una
arbitraria.

Marcadas "run by hand" en el README sin estado conocido:
`20260720_logos_bucket.sql` (README:287),
`20260727_prospects_assigned_to_index.sql` (README:117),
`20260720_prospects_linkedin_per_sdr.sql:7`.

### T28-24 · P3 · Migraciones no idempotentes — CONFIRMADO

Relevante porque el README:283 dice "correr todo en orden". Estas fallan con
`42710` si se re-corren:
- `20260705_vendors.sql:16` — `create policy` sin `DROP POLICY IF EXISTS`
- `20260706_scraper_v2.sql` — **13** `CREATE POLICY` sin DROP (líneas 31, 36, 101, 104, 121, 126, 132, 164, 167, 173, 194, 203, 208)
- `20260708_scraper_leads.sql:29,34` — ídem
- `20260707_support_fix.sql:86` — `ALTER PUBLICATION ... ADD TABLE` sin guarda
  (`20260727_support_tickets_realtime.sql` sí lo hace bien, con `DO $$ IF NOT EXISTS`)

### T28-25 · Tablas cuya RLS no es verificable desde el repo — SOSPECHOSO

11 tablas en uso **no tienen ninguna migración** en `supabase/migrations/`:
`users`, `organizations`, `areas`, `prospects` (solo documentada, QA-F34),
`audit_log`, `conversations`, `notes`, `markets`, `organization_markets`,
`bridge_runs`, `run_logs`.

De esas, **`conversations`, `notes` y `bridge_runs` contienen datos de tenant y no
hay ninguna evidencia en el repo de qué políticas tienen.** También `users`, del
que dependen implícitamente dos cosas ya listadas: el picker de SDR del CSV wizard
(`CSVImportWizard.tsx:119-124`, `.eq('role','sdr')` **sin filtro de org**) y el de
Bridge (`BridgeClient.tsx:129-136`, ídem). Si la RLS de `users` fuera más laxa de
lo asumido, **esos pickers listarían SDRs de otras orgs directamente en la UI**.

Recomendación: documentar esas 11 con el mismo enfoque de QA-F34, empezando por
`users`, `conversations` y `bridge_runs`.
