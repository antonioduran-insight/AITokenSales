import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * ¿El dominio de este email entra por SSO?
 *
 * La pantalla de login la consulta cuando la persona termina de escribir su
 * email, para decidir si muestra el campo de contraseña o la manda al IdP de su
 * empresa.
 *
 * QUÉ DEVUELVE, Y QUÉ NO
 * ----------------------
 * Solo `{ sso: boolean, domain? }`. Nunca el nombre de la organización, ni si
 * el email tiene cuenta, ni nada del padrón. Este endpoint es público por
 * necesidad — se consulta antes de que exista sesión — así que responde la
 * única pregunta que la pantalla necesita.
 *
 * Que un dominio use SSO no es un secreto: se descubre igual escribiendo
 * cualquier email de ese dominio en el login. Lo que sí sería una filtración es
 * confirmar qué personas existen, y eso no pasa por acá — de eso se encarga
 * /api/auth/forgot-password, que además está limitado por IP.
 */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  // El dominio es lo que hay después de la última @: un email puede tener
  // varias en teoría, y la que manda es la última.
  const at = email.lastIndexOf('@')
  const domain = at > 0 ? email.slice(at + 1) : ''

  if (!domain) return NextResponse.json({ sso: false })

  const admin = createAdminClient()

  // `contains` sobre el array, resuelto por el índice GIN. Exige además que
  // `sso_provider_id` esté cargado: un dominio anotado sin conexión SAML real
  // haría que `signInWithSSO` falle del lado del cliente con un error que la
  // pantalla no puede explicar.
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .contains('sso_domains', [domain])
    .not('sso_provider_id', 'is', null)
    .eq('is_active', true)
    .limit(1)

  // A failure here is indistinguishable from "this domain doesn't use SSO":
  // both end as `{ sso: false }`, the login screen shows a password field, and
  // nothing anywhere says why. That is the right behaviour for the user — an
  // ordinary password login must not break because this lookup did — but it
  // made a missing `organizations.sso_domains` column (the migration is run by
  // hand, so it can simply not have been) look exactly like a correctly
  // configured org whose SSO silently never engages. Log it: the response stays
  // the same, the cause stops being invisible.
  if (error) {
    console.error(
      `[sso-check] lookup failed for domain "${domain}": ${error.message}. ` +
      'If this mentions a missing column, run supabase/migrations/20260805_sso_domains.sql.'
    )
  }

  const hasSso = (data?.length ?? 0) > 0

  return NextResponse.json(hasSso ? { sso: true, domain } : { sso: false })
}
