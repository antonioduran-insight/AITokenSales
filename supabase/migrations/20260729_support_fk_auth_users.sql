-- ============================================================================
-- Borrado de usuarios, parte 2: las FKs que apuntan a auth.users
-- ============================================================================
--
-- 20260729_user_delete_fk_policy.sql arregló todas las FKs que apuntan a
-- `public.users` (y a `sender_profiles`, que cascadea desde ahí). Pero quedaron
-- tres sin tocar, y por eso borrar un usuario seguía fallando:
--
--     ERROR: 23503: update or delete on table "users" violates foreign key
--     constraint "support_tickets_created_by_fkey" on table "support_tickets"
--
-- El motivo es que estas tres NO apuntan a `public.users` sino a `auth.users`
-- DIRECTAMENTE (así las creó 20260707_support_fix.sql). Como `public.users.id`
-- es FK a `auth.users(id)` ON DELETE CASCADE, borrar el perfil intenta borrar
-- también la fila de auth, y ahí estas tres lo frenan.
--
-- Al buscar la causa conviene mirar SIEMPRE las dos tablas destino:
--
--   select (conrelid::regclass)::text, confdeltype
--     from pg_constraint
--    where contype='f'
--      and confrelid in ('public.users'::regclass, 'auth.users'::regclass);
--
-- ---------------------------------------------------------------------------
-- Por qué SET NULL y no CASCADE
-- ---------------------------------------------------------------------------
-- Un ticket de soporte es el registro de una conversación entre la org y la
-- plataforma. Borrar a quien lo abrió no debería borrar el historial: el
-- ticket y sus respuestas siguen siendo evidencia de qué se pidió y qué se
-- respondió, incluso si esa persona ya no está.
--
-- Es el mismo criterio que ya se aplicó a `audit_log.actor_id` en la migración
-- anterior (DROP NOT NULL + SET NULL): el hecho queda, el autor se vuelve
-- desconocido. CASCADE haría lo contrario — borrar un SDR desaparecería sus
-- tickets y toda la conversación asociada, en silencio.
--
-- La UI ya lo tolera: `/api/support/tickets` resuelve nombres con un lookup
-- aparte y cae en 'Unknown' / 'Support team' cuando no encuentra al autor.
-- ============================================================================

-- 1. support_tickets.assigned_to — ya era nullable, solo falta la regla
ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_assigned_to_fkey;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. support_tickets.created_by — es NOT NULL, así que hay que aflojarlo
--    primero: SET NULL sobre una columna NOT NULL falla en tiempo de borrado,
--    no al crear la constraint, así que sin este paso el bug reaparecería
--    recién la próxima vez que alguien intente borrar un usuario.
ALTER TABLE public.support_tickets
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_created_by_fkey;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. support_ticket_messages.created_by — mismo caso, MÁS una trampa:
--
--    20260707_support_fix.sql hizo `RENAME COLUMN author_id TO created_by`, y
--    Postgres NO renombra la constraint cuando se renombra la columna. O sea
--    que la FK de esta columna seguía llamándose `..._author_id_fkey`.
--
--    Consecuencia: un `DROP CONSTRAINT IF EXISTS ..._created_by_fkey` no
--    encuentra nada (silenciosamente, porque es IF EXISTS) y el ADD siguiente
--    crea una SEGUNDA FK sobre la misma columna. Postgres lo permite sin
--    quejarse, y queda la vieja en NO ACTION bloqueando igual que antes,
--    mientras la nueva en SET NULL da la falsa impresión de que se arregló.
--
--    Por eso hay que dropear las DOS por nombre. Nunca asumas que el nombre de
--    una constraint sigue a su columna: verificá con
--      select conname from pg_constraint where conrelid='tabla'::regclass;
ALTER TABLE public.support_ticket_messages
  ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.support_ticket_messages
  DROP CONSTRAINT IF EXISTS support_ticket_messages_created_by_fkey;
ALTER TABLE public.support_ticket_messages
  DROP CONSTRAINT IF EXISTS support_ticket_messages_author_id_fkey;  -- nombre heredado
ALTER TABLE public.support_ticket_messages
  ADD CONSTRAINT support_ticket_messages_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Verificación: después de correr esto no debería quedar NINGUNA fila
-- ---------------------------------------------------------------------------
-- select (c.conrelid::regclass)::text as tabla, a.attname as columna
--   from pg_constraint c
--   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
--  where c.contype = 'f'
--    and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass)
--    and c.confdeltype in ('a','r');   -- NO ACTION / RESTRICT = bloquea
