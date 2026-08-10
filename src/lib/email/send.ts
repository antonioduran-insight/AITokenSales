import { Resend } from 'resend'

/**
 * Outbound transactional email, sent by us through Resend.
 *
 * WHY WE SEND THESE AND NOT SUPABASE
 * ----------------------------------
 * Supabase can send auth emails itself, but its built-in sender is rate
 * limited to a handful per hour and its templates live in a dashboard field —
 * outside git, unreviewable, and with each language pasted in as a
 * `{{ if eq .Data.locale "zh" }}` branch nobody can diff.
 *
 * Sending them ourselves means `generateLink()` hands back the action link
 * WITHOUT mailing anything, and the body is built here from the same
 * `src/messages/*.json` files that translate the rest of the product. One
 * source of truth for every string a customer ever reads.
 *
 * SERVER ONLY. `RESEND_API_KEY` must never reach the browser, so nothing here
 * may be imported from a client component.
 */

/** Verified sender. A Resend domain must be verified before this will deliver. */
const FROM = process.env.EMAIL_FROM || 'Renly <noreply@renly.it.com>'

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string }

/**
 * Never throws. Every caller is in the middle of something the user asked for
 * (inviting a colleague, resetting a password) and needs to decide for itself
 * whether a mail failure should fail the whole request — the invite path, for
 * instance, has already created an auth user by this point.
 */
export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  /** Plain-text alternative. Not optional in practice: without it, some
   *  corporate filters score the message as spam purely for being HTML-only,
   *  and a password reset landing in Junk is indistinguishable from one that
   *  never arrived. */
  text: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Named precisely, because the symptom ("no email arrived") is identical
    // to a dozen other causes and this one is fixed in thirty seconds.
    return { ok: false, error: 'RESEND_API_KEY is not configured on this deployment.' }
  }

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    })

    if (error) return { ok: false, error: error.message }
    return { ok: true, id: data?.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown email error' }
  }
}
