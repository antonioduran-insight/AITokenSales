import en from '@/messages/en.json'
import zh from '@/messages/zh.json'
import es from '@/messages/es.json'
import vi from '@/messages/vi.json'

/**
 * Bodies for the emails this app sends.
 *
 * The strings come from the same `src/messages/*.json` files that translate
 * every other surface, so a translator works in one place and a missing key is
 * caught by the same parity check that covers the UI. The alternative — the
 * Supabase dashboard's template field — puts four languages in a textarea that
 * no pull request ever shows.
 *
 * Deliberately hand-written HTML with inline styles, no framework. Email
 * clients ignore <style> blocks, external CSS and most of flexbox; anything
 * fancier than this renders differently in Outlook than it does anywhere else.
 */

const MESSAGES = { en, zh, es, vi } as const
export type EmailLocale = keyof typeof MESSAGES

/** Falls back to English rather than throwing: an email in the wrong language
 *  still gets the person back into their account, a crash does not. */
function pick(locale: string): EmailLocale {
  return (locale in MESSAGES ? locale : 'en') as EmailLocale
}

function strings(locale: string) {
  return MESSAGES[pick(locale)].email as Record<string, string>
}

/** Interpolates `{name}` placeholders — the same shape next-intl uses, so a
 *  string can be moved between the UI and an email without being rewritten. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
}

function layout(opts: { heading: string; body: string[]; ctaLabel: string; ctaUrl: string; footer: string }): string {
  const paragraphs = opts.body
    .map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3a3a4a;">${p}</p>`)
    .join('')

  // Table-based centering, because margin:auto on a div is unreliable in
  // Outlook. Light background regardless of the app's dark theme — an email
  // has no way to know the reader's client is in dark mode, and a dark card
  // inverted by Gmail looks broken.
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f4f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang TC','Microsoft JhengHei',sans-serif;">
        <tr><td>
          <h1 style="margin:0 0 18px;font-size:20px;font-weight:700;color:#12121a;">${opts.heading}</h1>
          ${paragraphs}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td style="border-radius:8px;background:#6C63FF;">
              <a href="${opts.ctaUrl}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${opts.ctaLabel}</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8a8a9a;">${opts.footer}</p>
          <p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#a8a8b8;word-break:break-all;">${opts.ctaUrl}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

/** The link is repeated as plain text at the end of both bodies — some clients
 *  strip the button entirely, and a mail whose only way forward was a stripped
 *  button is a dead end. */
function plain(lines: string[], ctaUrl: string): string {
  return `${lines.join('\n\n')}\n\n${ctaUrl}\n`
}

export function resetPasswordEmail(locale: string, actionUrl: string) {
  const s = strings(locale)
  return {
    subject: s.resetSubject,
    html: layout({
      heading: s.resetHeading,
      body: [s.resetBody1, s.resetBody2],
      ctaLabel: s.resetCta,
      ctaUrl: actionUrl,
      footer: s.resetFooter,
    }),
    text: plain([s.resetHeading, s.resetBody1, s.resetBody2, s.resetFooter], actionUrl),
  }
}

export function inviteEmail(locale: string, actionUrl: string, vars: { inviter?: string; org?: string }) {
  const s = strings(locale)
  const intro = vars.inviter && vars.org
    ? fill(s.inviteBody1WithNames, { inviter: vars.inviter, org: vars.org })
    : s.inviteBody1

  return {
    subject: vars.org ? fill(s.inviteSubjectWithOrg, { org: vars.org }) : s.inviteSubject,
    html: layout({
      heading: s.inviteHeading,
      body: [intro, s.inviteBody2],
      ctaLabel: s.inviteCta,
      ctaUrl: actionUrl,
      footer: s.inviteFooter,
    }),
    text: plain([s.inviteHeading, intro, s.inviteBody2, s.inviteFooter], actionUrl),
  }
}
