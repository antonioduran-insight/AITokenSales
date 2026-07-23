// Server-only helpers for talking to the Python scraper/Bridge backend on
// Railway. Every outbound call must go through `backendHeaders()` so the shared
// secret is applied consistently — the backend rejects requests without it.

export const SCRAPER_API_URL =
  process.env.SCRAPER_API_URL || process.env.NEXT_PUBLIC_SCRAPER_API_URL || ''

/**
 * Headers for a backend request, including the internal API key.
 *
 * `INTERNAL_API_KEY` is server-only (never `NEXT_PUBLIC_`) and must match the
 * value configured on the backend. When it is unset the header is omitted
 * rather than sent empty, so a local backend without auth still works and a
 * misconfigured deploy fails loudly at the backend instead of silently
 * authenticating with "undefined".
 */
export function backendHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  const key = process.env.INTERNAL_API_KEY
  if (key) headers['X-Internal-Api-Key'] = key
  return headers
}
