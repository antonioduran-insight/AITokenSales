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

/**
 * Verified sender. A Resend domain must be verified before this will deliver —
 * until then Resend accepts the call and quietly delivers to nobody but your
 * own address, which looks exactly like success from here.
 *
 * The default is a SUBDOMAIN, `send.insight-software.com`, and that is
 * deliberate: transactional mail sent from the same domain the team writes to
 * customers from shares its reputation, so a run of bounces from the CRM would
 * follow their real correspondence into spam filters. A dedicated sending
 * subdomain also means adding SPF and DKIM records to a name with none, rather
 * than merging into the corporate domain's existing SPF — a domain may carry
 * only one SPF record, and a second one silently breaks authentication for
 * every mail the company sends.
 *
 * `EMAIL_FROM` overrides it. Whatever it is set to must be verified in Resend
 * first; this constant is only the fallback.
 */
const FROM = process.env.EMAIL_FROM || 'Insight Software <noreply@send.insight-software.com>'

/**
 * Why a send failed, at the level a UI can act on.
 *
 * The raw message is still returned for the logs, but a caller showing
 * something to a person needs to know WHOSE problem it is: "email isn't set up
 * on this deployment" is for whoever owns the deployment, "that address was
 * rejected" is for the admin who just typed it, and they are not the same
 * sentence. Both used to render as one generic "couldn't send", which is what
 * sent us digging through Vercel logs to discover a missing API key.
 */
export type SendFailureReason =
  /** The deployment can't send at all: no API key, a rejected key, or a
   *  `from` domain that isn't verified in Resend. Nothing the admin using the
   *  CRM can fix. */
  | 'not_configured'
  /** The destination address itself was refused. Usually a typo. */
  | 'invalid_recipient'
  /** Something else. Deliberately NOT guessed at — see `classifyFailure`. */
  | 'unknown'

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; reason: SendFailureReason }

/**
 * Bucket a Resend error into something a UI can say out loud.
 *
 * This reads Resend's error `name` and message, which is a heuristic over
 * somebody else's API surface — so anything not clearly recognised falls to
 * `unknown` rather than being forced into a bucket. A wrong cause confidently
 * stated is worse than "look at the logs": it sends someone to fix the thing
 * that wasn't broken.
 *
 * Note what is NOT here: a bounce. Resend accepts a message and bounces it
 * later, asynchronously, so a bounced address always looks like success from
 * inside this function. Delivery failures are visible only in Resend's own
 * dashboard.
 */
function classifyFailure(err: { name?: string; message?: string } | null): SendFailureReason {
  const name = (err?.name ?? '').toLowerCase()
  const message = (err?.message ?? '').toLowerCase()

  // Key problems and domain problems are both "this deployment can't send".
  if (
    name.includes('api_key') ||
    name.includes('access') ||
    name.includes('restricted') ||
    message.includes('api key') ||
    message.includes('not verified') ||
    message.includes('verify a domain') ||
    message.includes('domain is not')
  ) {
    return 'not_configured'
  }

  // A validation error that names the destination is the admin's typo; one
  // that names the sender is configuration, and is caught above.
  if (name.includes('validation') && (message.includes('`to`') || message.includes(' to '))) {
    return 'invalid_recipient'
  }

  return 'unknown'
}

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
    return {
      ok: false,
      error: 'RESEND_API_KEY is not configured on this deployment.',
      reason: 'not_configured',
    }
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

    if (error) return { ok: false, error: error.message, reason: classifyFailure(error) }
    return { ok: true, id: data?.id ?? null }
  } catch (e) {
    // A thrown exception is the network or the SDK, never a verdict about the
    // recipient — 'unknown' is the honest bucket.
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown email error',
      reason: 'unknown',
    }
  }
}
