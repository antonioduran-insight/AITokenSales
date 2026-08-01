import { redirect } from 'next/navigation'

// Unreachable under normal operation: middleware handles the bare "/" (auth
// check -> /zh/login, or on through to the app if already logged in) before
// Next's router ever resolves to this file. Kept only as a defensive
// fallback in case middleware is ever bypassed (e.g. disabled locally), so a
// stray hit here still lands somewhere sensible instead of a 404.
export default function RootPage() {
  redirect('/zh/login')
}
