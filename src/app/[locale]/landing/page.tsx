import type { Metadata } from 'next'
import { LandingClient } from './LandingClient'

/**
 * Public marketing page. No session, no org, no data access — the middleware
 * lists `/landing` under publicPages so it renders for anonymous visitors in
 * every locale, and AppShell skips the CRM chrome for it.
 *
 * The interactive product tour it embeds runs entirely on local sample data
 * (see ProductDemo), so nothing here can reach a real prospect record.
 */

export const metadata: Metadata = {
  title: 'B2B outreach, built for teams selling across markets',
  description:
    'Find the right people on LinkedIn across every market you sell in, score them automatically, and reach out in their language — from one pipeline your whole team works in.',
  // The app-wide layout sets `google: notranslate` because machine translation
  // breaks React's DOM. That still applies here: this page ships real
  // translations of its own, so there is nothing for a translation bar to add.
  robots: { index: true, follow: true },
}

export default function LandingPage() {
  return <LandingClient />
}
