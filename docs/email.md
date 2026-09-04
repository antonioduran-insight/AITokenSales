# Transactional email

The app sends its own emails through **Resend**. Supabase Auth is still what
mints the one-time links, but it no longer delivers anything.

## Why we send them instead of Supabase

Supabase can mail invitations and password resets itself, and it was doing so
until 05/08/2026. Two reasons it doesn't any more:

- **Sending limits.** The built-in sender is capped at a handful of messages
  per hour and is explicitly not meant for production. Resend on the Teams
  plan has no comparable ceiling.
- **The templates were unreviewable.** They lived in a dashboard textarea,
  outside git, with all four languages jammed into one field as
  `{{ if eq .Data.locale "zh" }}` branches. No pull request ever showed them,
  nothing verified the translations existed, and a typo was invisible until a
  customer received it.

Now the bodies are built in `src/lib/email/templates.ts` from the same
`src/messages/*.json` files that translate the rest of the product, so the
existing four-way parity check covers them too.

## How it fits together

```
generateLink()  →  action_link  →  templates.ts  →  sendEmail()  →  Resend
  (Supabase)        one-time URL     localised HTML    src/lib/email/send.ts
```

`generateLink()` is the key call: it creates the one-time link **without
mailing anything**, which is what makes the message ours to compose.

| Trigger | Route | Email |
|---|---|---|
| Admin invites someone | `POST /api/users` | Invitation |
| Someone forgot their password | `POST /api/auth/forgot-password` | Reset |
| Admin sends a reset for an SDR | `PATCH /api/users` (`send_password_reset`) | Reset |

All three land on `/auth/callback`, which exchanges the token for a session and
forwards to `/[locale]/set-password`.

## Which language each email is written in

Not the sender's — the **recipient's**. `user_metadata.locale` is written:

| When | Where | Value |
|---|---|---|
| Every successful login | `src/app/[locale]/login/page.tsx` | the locale in use right then |
| Invitation | `src/app/api/users/route.ts` | the inviting admin's locale, as a seed |

So it self-corrects: whatever language someone actually works in is the
language their emails arrive in. The admin's choice only matters for a person
who has never logged in yet.

The admin-triggered reset reads the target's metadata explicitly, so a
Spanish-speaking admin resetting a Chinese-speaking rep's password still sends
a Chinese email.

Anything missing or unrecognised falls back to English rather than throwing —
an email in the wrong language still gets somebody back into their account.

## Setup

Two environment variables, in Vercel (Production **and** Preview):

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | From the Resend dashboard → API Keys |
| `EMAIL_FROM` | e.g. `Insight Software <noreply@send.insight-software.com>` — defaults to that if unset |

And in Resend: **verify the sending domain** (Domains → Add → the DNS records).
Until that is done, Resend accepts the call and silently refuses to deliver to
anyone outside your own account.

Nothing needs configuring in Supabase any more. The SMTP settings and the email
templates there are now unused — leave them alone rather than deleting them,
since `generateLink` shares the same expiry settings.

## Failure behaviour, deliberately not uniform

Each caller decides for itself, because the cost of failing differs:

- **Invitation** — the account is already created by the time the mail is
  attempted, so a send failure does **not** roll it back. The API returns
  `invite_email_error` alongside the new user's id, and the admin sees a
  notice telling them to use "Reset password" to retry. Deleting a valid
  account over a transient mail error would be the worse outcome.
- **Password reset** — nothing was created, so a failure is just an error.
- **Missing `RESEND_API_KEY`** — reported by name rather than as a generic
  failure. The symptom ("no email arrived") is identical to a dozen other
  causes and this one is fixed in thirty seconds.

## Testing

```bash
curl -X POST https://<domain>/api/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@insight-software.com","locale":"zh"}'
```

Expected: `{"found":true,"reason":"sent"}` and a **Chinese** email — unless you
last logged in somewhere else, in which case you get that language instead,
which is the feature working. Other responses: `no_account`, `deactivated`,
`send_failed`.

The endpoint is rate-limited to 5 requests per minute per IP.
