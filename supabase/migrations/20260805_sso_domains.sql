-- Los dominios de email que enrutan al IdP de cada organización.
--
-- POR QUÉ HACE FALTA DUPLICAR ESTE DATO
-- ------------------------------------
-- El mapeo dominio → conexión SAML lo administra Supabase (`supabase sso add
-- --domains cliente.com`), y el SDK del cliente no expone ninguna forma de
-- consultarlo. Pero la pantalla de login necesita decidir, en el momento en que
-- la persona termina de escribir su email, si le pide una contraseña o la manda
-- al IdP de su empresa.
--
-- Las alternativas eran peores:
--   * Llamar a `signInWithSSO()` y usar el error como respuesta. Eso convierte
--     "este dominio no usa SSO" en un viaje al servidor que falla, y deja la
--     pantalla mostrando un error donde debería mostrar un campo de contraseña.
--   * Deducirlo de los emails del padrón. Frágil: una org puede tener varios
--     dominios, y una entrada del padrón puede usar un email que no coincide
--     con ninguno.
--
-- Así que se guarda acá también. Es un dato duplicado y hay que decirlo: si
-- alguien corre `supabase sso add` con un dominio y no lo carga en Global
-- Admin, el login no va a ofrecer SSO para ese dominio aunque la conexión
-- exista. La pantalla de Global Admin de la fase 4 los pide juntos por eso.
--
-- CORRER A MANO en el editor SQL de Supabase.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sso_domains text[] NOT NULL DEFAULT '{}';

-- Búsqueda invertida: "¿qué organización reclama acme.com?". Un índice GIN
-- sobre el array responde eso sin recorrer la tabla, que es lo que hace el
-- login en cada intento.
CREATE INDEX IF NOT EXISTS organizations_sso_domains_idx
  ON public.organizations USING gin (sso_domains);

-- Dos organizaciones no pueden reclamar el mismo dominio: el login resolvería
-- una de las dos arbitrariamente y esa persona entraría al CRM del cliente
-- equivocado.
--
-- Un UNIQUE normal no sirve sobre un array (compara el array entero, no sus
-- elementos), así que la garantía va como trigger.
CREATE OR REPLACE FUNCTION public.check_sso_domains_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflicting text;
BEGIN
  SELECT o.name INTO conflicting
  FROM public.organizations o
  WHERE o.id <> NEW.id
    AND o.sso_domains && NEW.sso_domains   -- && = los arrays se solapan
  LIMIT 1;

  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION 'One of those SSO domains is already claimed by %', conflicting
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_sso_domains_unique ON public.organizations;
CREATE TRIGGER organizations_sso_domains_unique
  BEFORE INSERT OR UPDATE OF sso_domains ON public.organizations
  FOR EACH ROW
  -- Solo cuando hay algo que chequear: el `{}` por defecto de cada org
  -- existente se solaparía con nada, pero saltar el trigger entero es más
  -- barato que ejecutarlo en cada UPDATE de la tabla.
  WHEN (array_length(NEW.sso_domains, 1) > 0)
  EXECUTE FUNCTION public.check_sso_domains_unique();

-- Verificar — el segundo tiene que fallar con unique_violation:
--
--   UPDATE organizations SET sso_domains = ARRAY['test-a.com'] WHERE name = 'AITokenSales';
--   UPDATE organizations SET sso_domains = ARRAY['test-a.com'] WHERE name = 'Insight Software';
--
-- Y después limpiar:
--   UPDATE organizations SET sso_domains = '{}' WHERE sso_domains && ARRAY['test-a.com'];
