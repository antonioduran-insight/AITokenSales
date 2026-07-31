-- ============================================================================
-- demo_requests — contactos que llegan desde la landing pública
-- ============================================================================
--
-- La landing existe para captar demos. Sin una tabla donde caigan, el
-- formulario sería decorativo — el mismo problema que tenía el campo de
-- industria de Bridge: acepta datos y no hace nada con ellos.
--
-- Se guarda en base y NO se manda por email: un correo depende de un proveedor
-- configurado, y si falla el contacto se pierde sin rastro. La fila queda
-- siempre; avisar por email puede sumarse después encima de esto.
--
-- NO tiene organization_id: es un prospecto, todavía no pertenece a ninguna
-- organización. Por eso vive fuera del modelo multi-tenant y solo lo puede
-- leer admin_global.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.demo_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lo que pide el formulario. Solo nombre y email son obligatorios: cada
  -- campo extra que se exige es gente que abandona.
  full_name      text NOT NULL,
  email          text NOT NULL,
  company        text,
  phone          text,
  team_size      text,
  message        text,

  -- Contexto de dónde vino, para saber qué mercado convierte.
  locale         text,          -- zh | en | es | vi
  source_path    text,          -- por si mañana hay más de una landing

  -- Seguimiento comercial.
  status         text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'discarded')),
  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_requests_created_idx ON public.demo_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS demo_requests_status_idx  ON public.demo_requests (status);

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Sin policy de INSERT a propósito: el formulario es público y anónimo, así
-- que la inserción va por una API route con el service-role key, que valida
-- y limita antes de escribir. Abrir un INSERT a `anon` acá convertiría la
-- tabla en un buzón de spam sin ninguna defensa.
DROP POLICY IF EXISTS "admin_global reads demo requests" ON public.demo_requests;
CREATE POLICY "admin_global reads demo requests" ON public.demo_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin_global')
  );

DROP POLICY IF EXISTS "admin_global updates demo requests" ON public.demo_requests;
CREATE POLICY "admin_global updates demo requests" ON public.demo_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin_global')
  );
