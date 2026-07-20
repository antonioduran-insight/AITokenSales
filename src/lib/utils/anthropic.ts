// Normalize an Anthropic base URL before persisting it.
//
// The scraper backend appends `/v1` (and the version path) itself, so storing a
// base URL that already ends in `/v1` produces the classic `/v1/v1` double-path
// error. Strip any trailing slashes and a trailing `/v1` segment so the value
// saved in Supabase is always the bare host + prefix.
export function normalizeAnthropicBaseUrl(url: string | null | undefined): string | null {
  if (url == null) return null
  let u = String(url).trim()
  if (!u) return null
  u = u.replace(/\/+$/, '') // drop trailing slashes
  if (/\/v1$/i.test(u)) u = u.replace(/\/v1$/i, '')
  u = u.replace(/\/+$/, '')
  return u || null
}
