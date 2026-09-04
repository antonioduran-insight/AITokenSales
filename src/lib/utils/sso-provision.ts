import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Turn a freshly authenticated SSO identity into a usable CRM member.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Supabase Auth does not link identities: the first time someone signs in
 * through their company's IdP, a brand-new `auth.users` row is created. Since
 * `public.users.id` IS that id, they arrive with no profile — no role, no
 * organisation, no area — and every page in the CRM renders empty.
 *
 * So the profile has to be created here, on that first login. What it must NOT
 * do is invent the attributes: the IdP proved *who* the person is, and that is
 * a different question from *what they may do here*. The answers come from the
 * roster, which an admin filled in beforehand.
 *
 * WHY SERVICE-ROLE AND NOT THE SESSION CLIENT
 * -------------------------------------------
 * `sso_roster`'s RLS policy is keyed on `my_role()` / `my_org_id()`, both of
 * which read `public.users`. The person being provisioned has no row there yet,
 * so under RLS they can see nothing — including the entry that authorises them.
 * This is the system's cold start and the service role is the only way through
 * it. Every value written below comes from the roster or from the verified
 * session, never from anything the caller supplied.
 */

export type ProvisionOutcome =
  /** Profile exists, or was just created. They can use the CRM. */
  | 'ok'
  /** Authenticated fine, but no admin has authorised this address. */
  | 'not_on_roster'
  /** The email's domain isn't claimed by any org with SSO configured. */
  | 'no_org'
  /** On the roster, but the org has no seats left. */
  | 'seat_limit'
  /** Something failed that isn't the user's fault. */
  | 'error'

export async function provisionSsoUser(authUserId: string, email: string): Promise<ProvisionOutcome> {
  const normalised = email.trim().toLowerCase()
  if (!normalised) return 'error'

  const admin = createAdminClient()

  // 1. Already a member? Then this is just a normal login and there is nothing
  //    to do. Checked first so the roster lookup only runs once per person,
  //    ever — every subsequent sign-in short-circuits here.
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('id', authUserId)
    .maybeSingle()

  if (existing) return 'ok'

  // 2. Which organisation? Resolved from the email's domain against
  //    `sso_domains`, not from anything in the token — the domain list is ours
  //    and an admin had to enter it, whereas token claims are shaped by the
  //    customer's IdP.
  const at = normalised.lastIndexOf('@')
  const domain = at > 0 ? normalised.slice(at + 1) : ''
  if (!domain) return 'no_org'

  const { data: orgs, error: orgsError } = await admin
    .from('organizations')
    .select('id, max_seats')
    .contains('sso_domains', [domain])
    .not('sso_provider_id', 'is', null)
    .eq('is_active', true)
    .limit(2)

  // Same reasoning as /api/auth/sso-check: a query failure and a domain nobody
  // claims both land on 'no_org', which the UI renders as "your administrator
  // hasn't given you access yet" — a sentence that sends the customer to their
  // admin instead of to whatever actually broke.
  if (orgsError) {
    console.error(`[sso-provision] org lookup failed for domain "${domain}": ${orgsError.message}`)
  }

  // More than one match should be impossible — a trigger enforces that two orgs
  // cannot claim the same domain — but if it ever happens, refusing is the only
  // safe answer. Guessing would put someone in another customer's CRM.
  if (!orgs || orgs.length !== 1) return 'no_org'
  const org = orgs[0]

  // 3. The roster is the authorisation. Authenticating successfully against the
  //    IdP is not enough: a customer's directory contains their whole company,
  //    and only the people an admin listed are meant to be in the CRM.
  const { data: entry } = await admin
    .from('sso_roster')
    .select('id, role, area_id, workspace_id')
    .eq('organization_id', org.id)
    .eq('email', normalised)
    .maybeSingle()

  if (!entry) return 'not_on_roster'

  // 4. Seats are re-checked here, not just when the entry was added. A plan can
  //    be downgraded, or other people can be added, between authorisation and
  //    first login — and the roster entry would still be sitting there.
  //
  //    Only 'sdr' counts, matching how POST /api/users counts, so the two paths
  //    can't disagree about what a seat is.
  if (entry.role === 'sdr') {
    const { count } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .eq('role', 'sdr')
      .eq('is_active', true)

    if ((count ?? 0) >= (org.max_seats ?? 0)) return 'seat_limit'
  }

  // 5. Create the profile. `id` is the SSO identity's id, which is what makes
  //    this account and this person the same thing from here on.
  const { error: insertError } = await admin.from('users').insert({
    id: authUserId,
    email: normalised,
    // The IdP may send a display name, but it isn't required to and the format
    // varies wildly. The email's local part is a predictable placeholder the
    // person can see is a placeholder; an admin can correct it.
    full_name: normalised.slice(0, at) || normalised,
    role: entry.role,
    area_id: entry.area_id,
    workspace_id: entry.workspace_id,
    organization_id: org.id,
    is_active: true,
  })

  if (insertError) {
    console.error(`[sso] profile creation failed for ${normalised}: ${insertError.message}`)
    return 'error'
  }

  // 6. Mirror the area into `user_areas`. The rest of the CRM reads coverage
  //    from that table, not from the legacy single `users.area_id` — an SDR
  //    with only the column set shows leads on the Kanban but none in the Leads
  //    table, which is a bug this project has already fixed once.
  await admin.from('user_areas').insert({ user_id: authUserId, area_id: entry.area_id })

  // 7. Consume the entry. Deleted rather than flagged: its only job was to
  //    authorise this one first login, and a spent entry left lying around
  //    would make the "authorised but hasn't signed in yet" view lie.
  //
  //    Last on purpose. If this fails the person is already a full member, and
  //    a leftover row is harmless — the `existing` check at the top means it
  //    will never be read again.
  const { error: cleanupError } = await admin.from('sso_roster').delete().eq('id', entry.id)
  if (cleanupError) {
    console.warn(`[sso] roster entry ${entry.id} survived provisioning: ${cleanupError.message}`)
  }

  return 'ok'
}
