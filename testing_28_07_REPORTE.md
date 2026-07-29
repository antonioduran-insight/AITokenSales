# AITokenSales — Reporte de testing del 28/07

Sin jerga técnica, ordenado por urgencia. El detalle técnico, con referencias de código y
causas raíz, está en `testing_28_07_LOG_TECNICO.md`.

**Qué se hizo:** revisión completa del código de los dos repositorios, más pruebas reales
en la aplicación en producción con cuatro roles distintos (admin de organización, global
admin, vendedor y soporte), más verificación directa en la base de datos.

**Cómo leer esto:** cada punto dice qué se esperaba, qué pasó de verdad, y qué significa
para el negocio. Todo lo listado fue **reproducido**, no deducido.

---

## 🔴 Bloqueantes — resolver antes de poner al equipo a usar el sistema

### 1. Los mensajes salen en el idioma equivocado (el bloqueante que ya conocían)

**Sigue pasando, con datos de hoy.** Los leads de Estados Unidos y Canadá salieron **en
español**. Y en dos búsquedas de Taiwán hechas con dos minutos de diferencia y la misma
configuración exacta, una salió en chino tradicional y la otra en chino simplificado.

**La buena noticia:** todo lo que se había arreglado está bien puesto y funcionando. La
configuración de países es correcta, los perfiles de los vendedores están bien, y las dos
partes del sistema están actualizadas. **El arreglo que se hizo apuntaba a la capa
equivocada.**

**Dónde está el problema real:** en la instrucción que se le da a la inteligencia
artificial al pedirle el mensaje. Y hay un dato nuevo importante: los mensajes de
Partnerships (Bridge) sí salieron en inglés perfecto usando exactamente la misma
inteligencia artificial y el mismo proveedor. Eso descarta que el proveedor sea el
culpable y apunta a cómo se le escribe el pedido en el módulo del buscador de leads.

**Impacto:** no se puede usar el buscador de leads con el equipo. Un mensaje en el idioma
equivocado al primer contacto quema el lead.

**Lo importante:** los arreglos ya aplicados **no van a resolver esto**. No conviene volver
a probar esperando que mejore. En el log técnico quedaron tres pruebas concretas, ordenadas,
para aislar la causa en una sola sesión.

---

### 2. Partnerships (Bridge) no entrega nada al vendedor

Se probó el flujo completo por primera vez. **Todos los pasos reportan éxito**: se
encuentran los contactos, se confirman, se escriben los mensajes (correctos y bien
personalizados), y el sistema dice *"9 contactos confirmados y asignados a Antonio"*.

**Antonio no los ve en ningún lado.** Ni en su tablero, ni en su lista de leads. Se verificó
desde las dos puntas: el total de leads no cambió, y entrando con la cuenta de Antonio no
aparece ninguno.

**Impacto:** el módulo es inútil de punta a punta hoy. Y lo peor es que **no hay ninguna
forma de darse cuenta** — todo dice que salió bien. Si se le vende esta función a un
cliente, la va a usar y va a pensar que no encontró nada.

---

### 3. La importación de CSV falla de cuatro maneras distintas

Se probó con tres archivos. Ninguno funcionó bien.

- **Cualquier archivo que incluya la columna de "combo de búsqueda" falla completo.** El
  formato que espera la base de datos y el que manda la aplicación no coinciden. Se
  importaron **0 de 4 filas**.
- **Una sola fila con un error arruina todo el lote.** Se puso un valor inválido en una
  fila de cuatro; las otras tres eran perfectas y se perdieron igual. Como los lotes son de
  25, **un error de tipeo puede costar 24 filas buenas**.
- **Cuando falla, dice "4 duplicados omitidos".** No había ningún duplicado: eran cuatro
  leads nuevos. Quien importe va a concluir que ya estaban cargados y **nunca se va a
  enterar de que falló**.
- **Y cuando funciona, dice que no sabe si funcionó.** Un archivo limpio de 2 filas se
  importó perfecto, pero la pantalla mostró *"estado de importación desconocido, verificá
  antes de volver a subir"*. Si alguien hace lo que le dice la pantalla y vuelve a subir,
  duplica.

**Impacto:** cargar leads desde un archivo es una de las cosas más básicas del sistema y
hoy no es confiable en ningún escenario.

---

### 4. El historial de cambios no registra nada (y nadie puede notarlo)

Cuando alguien edita la empresa, el cargo, el mercado o el combo de un lead, la pantalla
dice "Guardado", el cambio **sí se guarda**… y **no queda ningún registro de quién lo hizo
ni de qué valor tenía antes**.

Se verificó en la base de datos: de los 711 eventos del historial completo, **nunca se
registró ni uno** de este tipo. Falta un permiso en la base de datos, y el código no revisa
si el registro falló, así que el error es invisible.

**Impacto:** el historial de cambios es justamente lo que se consulta cuando un dato no
cuadra. Para el campo de mercado es peor, porque cambiarlo mueve el lead de región — o sea
que se puede reasignar un lead de zona sin que quede rastro.

---

### 5. Las estadísticas están calculadas sobre el 79% de los datos

La página de estadísticas dice **1000 leads**. Hay **1258**. Todos los desgloses suman
exactamente 1000, que es un límite técnico por defecto que nadie levantó.

**Impacto:** la tabla de rendimiento por vendedor —asignados, respondidos, cerrados, tasa de
cierre— está mal. Si esos números se usan para evaluar al equipo o calcular comisiones, hoy
están mal. **Y empeora a medida que crece la base:** con 10.000 leads reflejaría el 10%.

**Aparte, para vendedores con más de una región** las estadísticas solo cuentan una. Antonio
trabaja tres regiones y su panel le muestra 222 de sus 224 leads, escondiéndole las otras.

---

### 6. Casi todos los leads de un vendedor tienen la región equivocada

En el tablero de Antonio hay unos **217 leads marcados como "Latinoamérica"** que claramente
no lo son: empresas de Taiwán (`Audi Taiwan`, `KINPO GROUP`, `MICROIP`), de Alemania y del
Reino Unido.

Esto es el bug que ya se había arreglado. **El arreglo funciona para los leads nuevos, pero
nadie corrigió los que ya estaban.**

**Impacto:** el filtro por región no le sirve para nada (filtrar por Asia no le muestra
ninguno de sus leads taiwaneses) y la etiqueta de región miente en cada tarjeta. Se
soluciona con una corrección masiva de datos, una sola vez.

---

### 7. Dos agujeros de permisos

- **Un vendedor puede cargar leads asignándolos a cualquier persona y con cualquier dato**,
  usando la herramienta de importación por una vía que no valida nada. Incluso puede marcar
  un lead como "cerrado" salteándose el requisito de subir la conversación.
- **El global admin puede editar los leads de cualquier cliente sin darse cuenta.** El modo
  "solo lectura" existe, pero solo se activa si entra por el camino correcto. Entrando por
  la dirección directa ve **los leads de las cuatro organizaciones mezclados, sin ninguna
  columna que indique de quién es cada uno**, y todos los campos editables. Un click
  distraído escribe en los datos de un cliente.

---

## 🟡 Importantes — no bloquean pero conviene resolver pronto

| Qué | Detalle |
|---|---|
| **El aviso sonoro de soporte no suena** | Falla justo en el caso para el que existe: el agente deja la pestaña abierta esperando, y sin haber hecho un click dentro de esa página el navegador nunca habilita el sonido. |
| **Los mensajes de soporte llegan con demora** | Los tickets nuevos aparecen al instante, pero los mensajes dentro de un ticket tardan. Es un problema de configuración de permisos que además tiene una limpieza pendiente de aplicar. |
| **No se puede pedir chino tradicional** | El menú de idiomas no ofrece la opción, ni tampoco portugués — aunque Brasil y Portugal están configurados en portugués. |
| **No se puede ver ni editar el perfil de un vendedor** | Solo se puede crear uno nuevo al lado, sin ver qué tenía configurado antes. |
| **El proveedor de IA está configurado de tres formas distintas** | Dos de las cuatro organizaciones apuntan a una dirección incompleta. |
| **El campo "Vendor" sigue permitiendo texto libre** | Se convirtió en lista desplegable, pero quedó una opción "Otro" que escribe texto libre — así que el riesgo original (que un error de tipeo parta el reporte de ingresos en dos) sigue vivo. |
| **"Guardar claves de API" miente** | Muestra "Guardado" incluso cuando falla. Una clave mal pegada se reporta como guardada y las búsquedas fallan después sin causa aparente. |
| **La lista negra de dominios es decorativa** | Se puede saltear sin esfuerzo; no hay validación del lado del servidor. |
| **La aplicación está mayormente en inglés** | Con el idioma en chino, la pantalla de Configuración muestra 48 textos en inglés, Soporte 34 y Partnerships 30. Los textos que sí están traducidos están completos y correctos en los cuatro idiomas. |
| **12 de 13 negocios cerrados no tienen la conversación subida** | Son anteriores al nuevo requisito, pero si eso alimenta comisiones conviene completarlos. |

---

## 🟢 Confirmado que funciona bien

Esto se verificó y **no hace falta volver a probarlo**:

- **Los permisos de los vendedores son sólidos.** Se probaron 10 direcciones y 9 accesos
  directos al sistema: todo lo que debía estar bloqueado, está bloqueado de verdad. Un
  vendedor no puede acceder al buscador de leads ni a Partnerships por ninguna vía.
- **Los avisos en vivo de soporte funcionan.** Era el riesgo más silencioso de esa función y
  quedó descartado.
- **El reporte de ingresos cierra exacto.** Se verificó la aritmética completa a mano,
  incluidos los centavos y el reparto entre socios.
- **La detección automática de columnas al importar** acertó 9 de 9.
- **El aviso de "estos leads ya tienen mensajes escritos"** aparece cuando corresponde y no
  cuando no.
- **El recálculo de región al cambiar el mercado de un lead** funciona.
- **Los combos de búsqueda se muestran con nombres legibles** en todas las pantallas.
- **Cada vendedor ve solo lo suyo** en soporte, en negocios cerrados y en su tablero.
- Los arreglos cosméticos del reporte de ingresos y de la barra de Configuración están
  aplicados.

---

## Nota sobre el método

Durante esta revisión **cinco sospechas propias resultaron falsas** y quedaron descartadas
antes de reportarlas: la configuración de países estaba bien, la corrección de perfiles sí
se había hecho, una etiqueta de idioma engañosa vivía en código que nunca se ejecuta, los
campos de costos que parecían vacíos no lo estaban, y una supuesta contradicción en la
documentación resultó ser correcta.

Se menciona porque cada una de esas cinco, reportada sin verificar, habría mandado a alguien
a buscar un problema que no existe. Todo lo que quedó en este reporte se reprodujo en la
aplicación real o se leyó directamente de la base de datos.

**Lo que quedó sin verificar**, dicho explícitamente: si el proveedor de IA es responsable
de la inconsistencia de idioma en Taiwán (necesita repetir la misma búsqueda dos o tres
veces), y si el retraso de los mensajes de soporte es solo de los avisos en vivo o también
de la lectura normal.

---

## Datos de prueba que quedaron en el sistema

En la organización de pruebas, para que se puedan inspeccionar o limpiar:

- 2 leads llamados "TEST Limpio Uno/Dos", asignados a Lauren
- El lead **Jean-Maxime Fangous** con mercado cambiado a Argentina y " TEST" agregado al
  cargo (quedó a propósito: es el que demuestra el problema de región)
- 1 ticket de soporte "TEST Realtime 28/07" con 3 mensajes
- Los 9 contactos de Partnerships confirmados y asignados a Antonio
- Dos archivos de prueba en la carpeta del proyecto: `test_import_combo_28_07.csv` y
  `test_import_limpio_28_07.csv`
