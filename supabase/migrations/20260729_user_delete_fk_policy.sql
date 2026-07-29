-- ============================================================
-- Borrar un usuario: política de claves foráneas
--
-- Síntoma: DELETE FROM users →
--   update or delete on table "users" violates foreign key constraint
--   "run_sdr_assignments_sdr_id_fkey" on table "run_sdr_assignments"
--
-- Esa FK es solo la primera de OCHO que bloquean el borrado. Relevamiento
-- del estado real (28/07), 11 FKs apuntan a public.users:
--
--   tabla                  columna       not null  on delete
--   ---------------------------------------------------------
--   audit_log              actor_id      SÍ        NO ACTION   ← bloquea
--   bridge_candidates      assigned_to   no        NO ACTION   ← bloquea
--   conversations          author_id     SÍ        CASCADE     ← ver ⚠️ abajo
--   csv_import_sessions    imported_by   no        NO ACTION   ← bloquea
--   notes                  author_id     SÍ        NO ACTION   ← bloquea
--   prospects              assigned_to   no        NO ACTION   ← bloquea
--   prospects              created_by    no        NO ACTION   ← bloquea
--   run_sdr_assignments    sdr_id        SÍ        NO ACTION   ← bloquea
--   runs                   executed_by   no        NO ACTION   ← bloquea
--   sender_profiles        user_id       SÍ        CASCADE     ✓ correcto
--   user_areas             user_id       SÍ        CASCADE     ✓ correcto
--
-- ⚠️ ANTES DE CORRER ESTO, LEER: ¿de verdad querés BORRAR?
--
-- La app ya tiene un flujo de DESACTIVAR (users.is_active, el evento de
-- auditoría `sdr_deactivated`, y el botón "Unassign" en Gestión de usuarios).
-- Desactivar preserva todo el historial y saca al usuario de circulación.
-- Borrar es irreversible y, por definición, pierde la trazabilidad de quién
-- hizo qué. En un CRM donde los leads son el activo pago, casi siempre lo que
-- se quiere es desactivar.
--
-- Si igual querés poder borrar, esta migración lo habilita SIN destruir datos
-- de negocio. El criterio, explícito:
--
--   SET NULL  → el dato es de negocio y tiene que sobrevivir al usuario
--               (leads, notas, auditoría, runs). Se pierde "de quién era",
--               no "qué pasó".
--   CASCADE   → la fila es una relación o preferencia que no significa nada
--               sin el usuario (perfil de remitente, áreas asignadas).
--
-- Lo que esta migración NO hace: no borra ni toca ninguna fila. Solo cambia
-- qué pasa de acá en adelante cuando se borra un usuario.
-- ============================================================


-- ------------------------------------------------------------
-- 1) DATOS DE NEGOCIO — SET NULL (columnas ya nullable)
-- ------------------------------------------------------------

-- Los leads son lo más importante de todo: borrar un vendedor NO puede borrar
-- sus leads. Quedan sin dueño y se reasignan desde la UI.
ALTER TABLE public.prospects DROP CONSTRAINT prospects_assigned_to_fkey;
ALTER TABLE public.prospects ADD CONSTRAINT prospects_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.prospects DROP CONSTRAINT prospects_created_by_fkey;
ALTER TABLE public.prospects ADD CONSTRAINT prospects_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- El run y su historial sobreviven; se pierde quién lo ejecutó.
ALTER TABLE public.runs DROP CONSTRAINT runs_executed_by_fkey;
ALTER TABLE public.runs ADD CONSTRAINT runs_executed_by_fkey
  FOREIGN KEY (executed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.csv_import_sessions DROP CONSTRAINT csv_import_sessions_imported_by_fkey;
ALTER TABLE public.csv_import_sessions ADD CONSTRAINT csv_import_sessions_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.bridge_candidates DROP CONSTRAINT bridge_candidates_assigned_to_fkey;
ALTER TABLE public.bridge_candidates ADD CONSTRAINT bridge_candidates_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


-- ------------------------------------------------------------
-- 2) DATOS DE NEGOCIO con columna NOT NULL — hay que aflojarla primero
-- ------------------------------------------------------------

-- AUDITORÍA. Es el caso más importante de los tres: el audit log existe
-- precisamente para poder revisar qué hizo alguien, y borrar a esa persona es
-- justo cuando más falta hace. Un CASCADE acá borraría los 700+ eventos del
-- usuario borrado, o sea el historial se autodestruye en el momento exacto en
-- que lo necesitás.
--
-- La tabla ya guarda `actor_name` desnormalizado (texto), así que el rastro
-- sigue siendo legible después del SET NULL: dice quién fue por nombre, solo
-- pierde el vínculo a la fila del usuario.
ALTER TABLE public.audit_log ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_actor_id_fkey;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- NOTAS sobre un prospecto: es contenido de negocio escrito sobre un lead,
-- no una preferencia del usuario. Sobrevive.
ALTER TABLE public.notes ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public.notes DROP CONSTRAINT notes_author_id_fkey;
ALTER TABLE public.notes ADD CONSTRAINT notes_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


-- ------------------------------------------------------------
-- 3) run_sdr_assignments — LA QUE TE DIO EL ERROR. Requiere criterio.
-- ------------------------------------------------------------
--
-- Es una tabla de unión: dice a qué SDR le corresponden los leads de un run.
-- CLAUDE.md documenta que `assignRunLeads()` la lee para resolver el
-- destinatario, y que un run con CERO o VARIAS filas se saltea a propósito
-- ("skipped and reported, never guessed at") porque adivinar mal tiene costo
-- real: cupo, comisión y propiedad del lead.
--
-- Por eso NO uso CASCADE: borraría la fila y dejaría el run permanentemente
-- inasignable para el cron de reconciliación, en silencio.
--
-- SET NULL preserva la fila y el hecho de que ese run tuvo un destinatario.
-- CONTRAPARTIDA A TENER EN CUENTA: el código que busca "exactamente una fila
-- inequívoca" ahora puede encontrar una fila con sdr_id NULL. Para un run ya
-- COMPLETADO no importa (los leads ya están en prospects). Para un run
-- PENDIENTE sí: queda huérfano y hay que reasignarlo a mano.
--
-- → Antes de borrar un usuario, verificá que no tenga runs en vuelo:
--     SELECT r.id, r.status FROM runs r
--     JOIN run_sdr_assignments a ON a.run_id = r.id
--     WHERE a.sdr_id = '<uuid>'
--       AND r.status IN ('pending','running','scoring','drafting');
ALTER TABLE public.run_sdr_assignments ALTER COLUMN sdr_id DROP NOT NULL;
ALTER TABLE public.run_sdr_assignments DROP CONSTRAINT run_sdr_assignments_sdr_id_fkey;
ALTER TABLE public.run_sdr_assignments ADD CONSTRAINT run_sdr_assignments_sdr_id_fkey
  FOREIGN KEY (sdr_id) REFERENCES public.users(id) ON DELETE SET NULL;


-- ------------------------------------------------------------
-- 3b) LA CADENA DE DOS PASOS — no alcanza con arreglar users
-- ------------------------------------------------------------
--
-- Después de aplicar todo lo de arriba, el borrado seguía fallando con:
--
--   update or delete on table "sender_profiles" violates foreign key
--   constraint "run_sdr_assignments_sender_profile_id_fkey"
--
-- El motivo: borrar un usuario hace CASCADE sobre `sender_profiles` (esa FK ya
-- venía en CASCADE y está bien), pero `sender_profiles` tiene su PROPIA FK
-- entrante desde `run_sdr_assignments.sender_profile_id` en NO ACTION. O sea
-- que el borrado se corta en el segundo eslabón de la cadena.
--
-- Lección: al habilitar el borrado de una fila hay que revisar no solo las FKs
-- que apuntan a esa tabla, sino también las que apuntan a todo lo que se
-- borra en cascada desde ella. Relevamiento de las tablas que cascadean desde
-- users (sender_profiles, user_areas, conversations): solo `sender_profiles`
-- tenía una FK entrante conflictiva.
--
-- Mismo criterio que sdr_id: SET NULL, para no destruir la fila de asignación
-- del run (ver el punto 3).
ALTER TABLE public.run_sdr_assignments
  DROP CONSTRAINT run_sdr_assignments_sender_profile_id_fkey;
ALTER TABLE public.run_sdr_assignments
  ADD CONSTRAINT run_sdr_assignments_sender_profile_id_fkey
  FOREIGN KEY (sender_profile_id) REFERENCES public.sender_profiles(id) ON DELETE SET NULL;

-- Chequeo de que no quede ninguna FK bloqueando la cadena completa
-- (tiene que devolver 0 filas):
--   SELECT c.conname, c.confrelid::regclass::text
--     FROM pg_constraint c
--    WHERE c.contype = 'f'
--      AND c.confdeltype = 'a'
--      AND c.confrelid IN ('public.users'::regclass,
--                          'public.sender_profiles'::regclass);


-- ------------------------------------------------------------
-- 4) ⚠️ conversations — YA está en CASCADE, y probablemente esté mal
-- ------------------------------------------------------------
--
-- No lo cambio en esta migración porque es una decisión de producto, pero hay
-- que mirarlo: `conversations` guarda los chats subidos al cerrar un trato, y
-- son la evidencia que el CloseDealModal exige obligatoriamente. Con CASCADE,
-- borrar un vendedor **borra la prueba de todos los tratos que cerró**.
--
-- Si eso alimenta comisiones o disputas con clientes, deberías cambiarlo al
-- mismo criterio que notes/audit_log. Descomentá si estás de acuerdo:
--
-- ALTER TABLE public.conversations ALTER COLUMN author_id DROP NOT NULL;
-- ALTER TABLE public.conversations DROP CONSTRAINT conversations_author_id_fkey;
-- ALTER TABLE public.conversations ADD CONSTRAINT conversations_author_id_fkey
--   FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


-- ------------------------------------------------------------
-- 5) Verificación posterior — las 11 deberían quedar así
-- ------------------------------------------------------------
-- SELECT c.conname, c.conrelid::regclass::text AS tabla, a.attname AS col,
--        a.attnotnull AS notnull,
--        CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
--             WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' END AS on_del
--   FROM pg_constraint c
--   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
--  WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass
--  ORDER BY 2, 3;
--
-- Esperado: SET NULL en audit_log, bridge_candidates, csv_import_sessions,
-- notes, prospects (x2), run_sdr_assignments, runs. CASCADE en conversations
-- (salvo que descomentes el punto 4), sender_profiles y user_areas.


-- ------------------------------------------------------------
-- 6) OJO — esto NO cubre auth.users
-- ------------------------------------------------------------
-- public.users es el perfil; la cuenta de login vive en auth.users y se borra
-- aparte (Supabase Auth API / admin.deleteUser). Borrar solo el perfil deja la
-- cuenta de auth huérfana: la persona sigue pudiendo autenticarse pero el
-- middleware no le encuentra perfil. Si el objetivo es "que esta persona no
-- exista más", hay que borrar en los dos lados.
--
-- Ver `src/app/api/global-admin/support-users/route.ts` para el patrón que ya
-- usa el proyecto: crea en auth, inserta el perfil, y hace rollback del auth
-- user si el insert del perfil falla.
