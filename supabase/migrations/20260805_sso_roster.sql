-- SSO (SAML): la conexión por organización, y el padrón de autorizados.
--
-- POR QUÉ EXISTE UN PADRÓN
-- ------------------------
-- Supabase Auth no enlaza identidades: alguien que ya tiene cuenta con
-- contraseña y entra por SSO llega como un `auth.users` NUEVO. Y acá
-- `public.users.id` ES el id de auth, así que esa persona llegaría sin perfil,
-- sin área y sin sus leads.
--
-- La decisión fue ofrecer SSO solo a clientes nuevos (ver docs/PLAN-SSO.md).
-- Eso descarta invitar por email: una invitación crea justamente la identidad
-- con contraseña que después no se enlaza.
--
-- Quedaban dos caminos y uno era malo: aprovisionar a cualquiera que exista en
-- el IdP del cliente — la auto-unión por dominio que ya se había descartado, y
-- que además dejaría que 200 personas en un Okta consuman 200 asientos.
--
-- El padrón es el tercero: el admin declara quién puede entrar y con qué rol,
-- área y sede. El IdP prueba que la persona es quien dice; el padrón decide si
-- tiene permiso de estar acá. Son dos preguntas distintas y las responde quien
-- corresponde.
--
-- CORRER A MANO en el editor SQL de Supabase: las migraciones de este repo no
-- se aplican solas.

-- ---------------------------------------------------------------------------
-- 1. La conexión SAML de cada organización
-- ---------------------------------------------------------------------------
-- El UUID que devuelve `supabase sso add`. El JWT del usuario trae ese mismo
-- valor en `amr[0].provider`, así que resolvemos a qué organización pertenece
-- alguien sin preguntarle nada — es el patrón que la documentación de Supabase
-- recomienda para multi-tenant.
--
-- UNIQUE porque una conexión SAML pertenece a una sola organización. Sin esto,
-- dos orgs podrían reclamar el mismo IdP y el aprovisionamiento elegiría una
-- de las dos arbitrariamente: gente de un cliente entrando al CRM de otro.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sso_provider_id uuid;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_sso_provider_id_unique;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_sso_provider_id_unique UNIQUE (sso_provider_id);

-- ---------------------------------------------------------------------------
-- 2. El padrón
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sso_roster (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Guardado en minúsculas por el CHECK de abajo, no por convención: la
  -- búsqueda al momento del login compara contra el email que manda el IdP, y
  -- un `Maria@acme.com` en el padrón contra un `maria@acme.com` en la aserción
  -- dejaría afuera a alguien autorizado sin ninguna señal de por qué.
  email           text NOT NULL CHECK (email = lower(email)),

  -- Los atributos que tendrá el perfil cuando la persona entre por primera vez.
  -- Vienen del admin, JAMÁS del IdP: que el Okta del cliente diga quién es
  -- alguien no dice qué puede hacer dentro del CRM.
  role            text NOT NULL DEFAULT 'sdr' CHECK (role IN ('admin', 'sdr')),

  -- NOT NULL a propósito. Un SDR sin área no ve absolutamente nada y entra a un
  -- CRM vacío que parece roto; obligar al admin a elegirla acá es más barato
  -- que diagnosticar eso después.
  area_id         uuid NOT NULL REFERENCES public.areas(id),

  -- Sede: NULL = toda la organización, igual que en `users.workspace_id`.
  workspace_id    uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,

  -- Quién autorizó a esta persona. SET NULL para que borrar a un admin no
  -- bloquee ni borre el padrón que dejó armado.
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Una persona una sola vez por organización. Dos filas para el mismo email
  -- harían que el aprovisionamiento eligiera rol y área arbitrariamente.
  CONSTRAINT sso_roster_org_email_unique UNIQUE (organization_id, email)
);

-- La única consulta que esta tabla existe para responder, en el camino crítico
-- del login: "¿está este email autorizado en esta organización?".
CREATE INDEX IF NOT EXISTS sso_roster_org_email_idx
  ON public.sso_roster (organization_id, email);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.sso_roster ENABLE ROW LEVEL SECURITY;

-- Los admin de la org ven y administran su propio padrón. Los SDR no: es una
-- lista de quién puede entrar a la empresa, no información de trabajo diario.
DROP POLICY IF EXISTS sso_roster_admin_all ON public.sso_roster;
CREATE POLICY sso_roster_admin_all ON public.sso_roster
  FOR ALL USING (
    (SELECT my_role()) = 'admin_global'
    OR ((SELECT my_role()) = 'admin' AND organization_id = (SELECT my_org_id()))
  );

-- Ojo: el aprovisionamiento NO puede pasar por esta política. Quien acaba de
-- entrar por SSO todavía no tiene fila en `public.users`, así que `my_role()` y
-- `my_org_id()` devuelven null y no vería nada. Esa lectura va con el cliente
-- de service-role desde una API route, que es la única forma de resolver el
-- arranque en frío.

-- ---------------------------------------------------------------------------
-- Verificar
-- ---------------------------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'organizations'
--     AND column_name = 'sso_provider_id';
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.sso_roster'::regclass;
--
-- Esperado: 3 columnas con CHECK/UNIQUE (email en minúsculas, role, y la
-- unicidad de organization_id+email) más las FK.
