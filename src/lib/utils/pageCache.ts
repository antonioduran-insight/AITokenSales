// Module-scope cache for client-fetched page data (Prospects, Kanban,
// Dashboard, ...). A `useState` inside a page component is lost the instant
// Next.js unmounts that route on navigation — that's exactly why leaving
// Leads and coming back re-fetched everything from zero, even for data that
// hadn't changed. A plain module-level `Map` doesn't have that problem: it
// lives in the JS module, not the component tree, so it survives a client-
// side route change as long as the tab itself isn't reloaded.
//
// Pattern is stale-while-revalidate, not "trust the cache forever": a page
// should render the cached value immediately (no spinner, no blank table),
// then kick a real fetch in the background and swap in fresh data when it
// lands. `isFresh` lets a caller skip that background fetch entirely when
// the entry is very recent (e.g. bouncing between two tabs within a few
// seconds), but the normal path is "show cached, then quietly refresh."
//
// Every write should go through `setCached` — including the result of a
// manual refresh or a filter change — so a mutation made on this page is
// reflected the next time this same key is read, not just on a timer.

interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<unknown>>()

// How long a cached entry is trusted well enough to skip even the
// background revalidation. Short on purpose — this is a sales CRM with
// multiple people editing the same org's data, not a static content site.
const FRESH_MS = 15_000

export function getCachedEntry<T>(key: string): { data: T; isFresh: boolean } | null {
  const entry = cache.get(key)
  if (!entry) return null
  return { data: entry.data as T, isFresh: Date.now() - entry.timestamp < FRESH_MS }
}

export function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
}

// For invalidating every cached view of a resource after a mutation whose
// exact key isn't known at the call site (e.g. "something about prospects
// changed" from a different page than the one that changed it) — clears
// every entry whose key starts with the given prefix rather than requiring
// an exact match.
export function invalidateCachePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}
