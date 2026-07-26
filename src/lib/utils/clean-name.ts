/**
 * Strips a job title the scraper occasionally leaves stuck onto the name
 * field (FUNC-F2) — e.g. "Jassen Castillo - Software Engineer" arrives as a
 * single string instead of separate name/title fields. Takes everything
 * before the first " - " / " – " / " — " / " | " separator, since a real
 * title never appears before a person's name in what the scraper captures.
 *
 * Only splits when there's real text on both sides, so a name that
 * legitimately contains a dash (rare, but possible) isn't mangled into an
 * empty string.
 */
export function cleanScrapedName(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  const match = trimmed.match(/^(.+?)\s+[-–—|]\s+(.+)$/)
  if (match && match[1].trim() && match[2].trim()) return match[1].trim()
  return trimmed
}
