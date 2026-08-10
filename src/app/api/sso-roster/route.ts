import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * El padrón de SSO de una organización: quién está autorizado a entrar por el
 * IdP de la empresa, y con qué rol, área y sede.
 *
 * Esta lista es la AUTORIZACIÓN. El IdP del cliente prueba quién es alguien —
 * y su directorio contiene a toda la empresa, no solo a quienes usan el CRM.
 * Sin el padrón, cualquier empleado que se autentique correctamente entraría y
 * consumiría un asiento.
 *
 * Solo los admin de la organización. Un SDR no tiene por qué ver la lista de
 * quién puede entrar a su empresa.
 */

type Caller = { id: string; organizationId: string }

async function getAdminCaller(): Promise<Caller | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' || !profile.organization_id) return null
  return { id: user.id, organizationId: profile.organization_id as string }
}

/** El add-on se revalida en el servidor, siempre. Gatearlo solo en la UI no es
 *  un límite de seguridad — mismo criterio que el proxy de Bridge. */
async function hasSsoAddon(organizationId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organization_addons')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('addon_type', 'sso')
    .eq('is_active', true)
    .maybeSingle()
  return !!data
}

// GET — el padrón de esta org, más si el add-on está activo.
export async function GET() {
  const caller = await getAdminCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const [rosterRes, addonActive, ssoRes] = await Promise.all([
    admin.from('sso_roster')
      .select('*, area:areas(*)')
      .eq('organization_id', caller.organizationId)
      .order('created_at', { ascending: false }),
    hasSsoAddon(caller.organizationId),
    admin.from('organizations')
      .select('sso_provider_id, sso_domains')
      .eq('id', caller.organizationId)
      .maybeSingle(),
  ])

  if (rosterRes.error) {
    return NextResponse.json({ error: rosterRes.error.message }, { status: 500 })
  }

  return NextResponse.json({
    roster: rosterRes.data ?? [],
    addon_active: addonActive,
    // Sin conexión configurada el padrón no sirve para nada todavía, y la
    // pantalla lo dice en vez de dejar al admin cargando gente que no va a
    // poder entrar.
    sso_configured: !!ssoRes.data?.sso_provider_id,
    sso_domains: ssoRes.data?.sso_domains ?? [],
  })
}

// POST — autorizar a alguien.
export async function POST(req: NextRequest) {
  const caller = await getAdminCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasSsoAddon(caller.organizationId)) {
    return NextResponse.json({ error: 'The SSO add-on is not active for this organization.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body.role === 'admin' ? 'admin' : 'sdr'
  const areaId = typeof body.area_id === 'string' ? body.area_id : ''

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  if (!areaId) {
    // No hay valor por defecto razonable: un SDR sin área ve un CRM
    // completamente vacío y parece que el producto está roto.
    return NextResponse.json({ error: 'An area is required — without one this person would see an empty CRM.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Ya es miembro. Sin este chequeo el admin agrega a alguien que ya entra
  // normalmente, la entrada queda para siempre sin consumirse, y la vista de
  // "autorizados que todavía no entraron" miente.
  const { data: already } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('organization_id', caller.organizationId)
    .limit(1)

  if ((already?.length ?? 0) > 0) {
    return NextResponse.json({ error: 'That person is already a member of this organization.' }, { status: 409 })
  }

  // El área tiene que existir; el sitio, si viene, tiene que ser de esta org.
  // Ninguno se acepta del cliente sin verificar: los dos deciden qué ve esa
  // persona cuando entre.
  const workspaceIdRaw = typeof body.workspace_id === 'string' && body.workspace_id ? body.workspace_id : null
  let workspaceId: string | null = null
  if (workspaceIdRaw) {
    const { data: ws } = await admin
      .from('workspaces')
      .select('id')
      .eq('id', workspaceIdRaw)
      .eq('organization_id', caller.organizationId)
      .maybeSingle()
    workspaceId = ws ? workspaceIdRaw : null
  }

  // Asientos, con el mismo criterio que POST /api/users: solo cuentan los
  // 'sdr' activos. Se cuenta el padrón pendiente también — si no, un admin
  // podría autorizar a treinta personas con siete asientos y descubrirlo
  // recién cuando la octava intente entrar.
  if (role === 'sdr') {
    const [{ data: org }, { count: activeSdrs }, { count: pending }] = await Promise.all([
      admin.from('organizations').select('max_seats').eq('id', caller.organizationId).maybeSingle(),
      admin.from('users').select('id', { count: 'exact', head: true })
        .eq('organization_id', caller.organizationId).eq('role', 'sdr').eq('is_active', true),
      admin.from('sso_roster').select('id', { count: 'exact', head: true })
        .eq('organization_id', caller.organizationId).eq('role', 'sdr'),
    ])
    const maxSeats = org?.max_seats ?? 0
    if ((activeSdrs ?? 0) + (pending ?? 0) >= maxSeats) {
      return NextResponse.json(
        { error: 'seat_limit_reached', max_seats: maxSeats },
        { status: 409 }
      )
    }
  }

  const { data, error } = await admin
    .from('sso_roster')
    .insert({
      organization_id: caller.organizationId,
      email, role, area_id: areaId,
      workspace_id: workspaceId,
      created_by: caller.id,
    })
    .select('*, area:areas(*)')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That email is already on the list.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ entry: data })
}

// DELETE — retirar una autorización que todavía no se usó.
export async function DELETE(req: NextRequest) {
  const caller = await getAdminCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  // Alcanzado por organization_id además del id: es el cliente de service-role,
  // así que la RLS no protege nada acá.
  const { error } = await admin
    .from('sso_roster')
    .delete()
    .eq('id', id)
    .eq('organization_id', caller.organizationId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Nota: borrar la entrada NO saca a nadie que ya haya entrado. Una vez
  // consumida, esa persona es miembro y se desactiva desde Usuarios como
  // cualquier otro. El add-on no gatea este DELETE a propósito: una org que
  // dejó vencer el add-on tiene que poder limpiar su propia lista.
  return NextResponse.json({ ok: true })
}
