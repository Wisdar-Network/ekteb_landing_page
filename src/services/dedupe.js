/**
 * Remembers which addresses came in recently, so one person filling the form
 * twice does not mail the team twice.
 *
 * This used to be a SQL lookup. In memory it forgets on restart, which costs at
 * most one duplicate notification after a deploy — cheap next to running a
 * database purely to answer this one question.
 */
const seen = new Map()
const MAX = 5000
const WINDOW_MS = 24 * 60 * 60 * 1000

const key = (email) => String(email).trim().toLowerCase()

function sweep(now) {
  const cutoff = now - WINDOW_MS
  for (const [k, at] of seen) if (at <= cutoff) seen.delete(k)
}

export function seenRecently(email, windowMs = WINDOW_MS) {
  const at = seen.get(key(email))
  return at !== undefined && Date.now() - at < windowMs
}

export function remember(email) {
  const now = Date.now()
  if (seen.size >= MAX) {
    sweep(now)
    // Still full: drop the oldest. Map iterates in insertion order, and every
    // key is re-inserted below, so the first entry is the least recent.
    while (seen.size >= MAX) seen.delete(seen.keys().next().value)
  }
  const k = key(email)
  seen.delete(k)
  seen.set(k, now)
}

/** Test hook. */
export const _reset = () => seen.clear()
