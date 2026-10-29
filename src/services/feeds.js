import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'

/**
 * The /feeds page's data.
 *
 * Two sources, one shape. With FEEDS_API_URL set, items come from the
 * platform's API; without it, from src/data/feeds.sample.json, so the page can
 * be built and reviewed before the API exists. Either way every item passes
 * through normalize(), which is the only place that knows the wire format
 * (portal.ekteb.ai/api/feeds?language=xx, keyed by an X-API-KEY header) —
 * when the API contract changes, that function is what changes, not the
 * template.
 *
 * The page renders server-side, so the visitor's request waits on this call.
 * Responses are cached per locale and served stale while a refresh runs in the
 * background: only the very first request after boot ever waits on the API,
 * and an API outage keeps showing the last good list instead of an empty page.
 */

const sampleFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'feeds.sample.json')

export const feedsLive = () => Boolean(config.feeds.apiUrl)

/* ── normalisation ─────────────────────────────────────────────────────── */

// The staging UI prints a literal "null" for a missing summary, so the string
// is treated as absent along with the real thing.
const str = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return s === 'null' || s === 'undefined' ? '' : s
}

// Seconds, from either a number or an "HH:MM:SS" / "MM:SS" string.
function seconds(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v))
  const s = str(v)
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s))
  const parts = s.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

const httpUrl = (v) => {
  const s = str(v)
  return /^https:\/\//i.test(s) ? s : ''
}

// The rule CSP applies to the same list: an entry like https://*.example.com
// admits any subdomain of example.com, but not example.com itself.
function allowedOrigin(origin) {
  return config.feeds.mediaOrigins.some((o) => {
    if (!o.includes('*.')) return o === origin
    const [scheme, host] = o.split('*.')
    return origin.startsWith(scheme) && origin.endsWith(`.${host}`)
  })
}

// Media the browser will actually load. CSP img-src/media-src admit only
// FEEDS_MEDIA_ORIGINS, and the API sometimes points a thumbnail at the
// publisher's own site; such a URL would render as a broken image, so it is
// dropped here and the card falls back to its drawn cover.
const mediaUrl = (v) => {
  const s = httpUrl(v)
  if (!s) return ''
  try {
    return allowedOrigin(new URL(s).origin) ? s : ''
  } catch {
    return ''
  }
}

export function normalize(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const type = str(raw.type).toLowerCase() === 'video' ? 'video' : 'article'
  const title = str(raw.title)
  if (!title) return null

  const rawTags = raw.hashtags ?? raw.tags
  const tags = (Array.isArray(rawTags) ? rawTags : [])
    .map((tg) => str(typeof tg === 'object' && tg ? tg.name : tg).replace(/^#/, ''))
    .filter(Boolean)

  const date = new Date(str(raw.published_at ?? raw.publishedAt ?? raw.date))

  return {
    id: str(raw.id) || `item-${index}`,
    type,
    title,
    summary: str(raw.summary ?? raw.description),
    source: str(raw.source ?? raw.source_name),
    // ISO 639-1 code of the language the material was published in. The label
    // is produced per page with Intl.DisplayNames, so no locale file lists
    // language names.
    sourceLang: str(raw.original_language ?? raw.source_language ?? raw.sourceLang).toLowerCase(),
    publishedAt: Number.isNaN(date.getTime()) ? null : date,
    duration: type === 'video' ? seconds(raw.duration_seconds ?? raw.duration) : null,
    words: type === 'article' ? Number.parseInt(raw.word_count ?? raw.words, 10) || null : null,
    tags,
    video: type === 'video' ? mediaUrl(raw.video_url ?? raw.videoUrl) : '',
    image: mediaUrl(raw.image_url ?? raw.thumbnail ?? raw.image),
  }
}

/* ── fetching ──────────────────────────────────────────────────────────── */

const cache = new Map() // locale → { at, items, pending }

async function fromApi(locale) {
  const url = new URL(config.feeds.apiUrl)
  url.searchParams.set('language', locale)
  const headers = { Accept: 'application/json' }
  if (config.feeds.apiKey) headers['X-API-KEY'] = config.feeds.apiKey

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(config.feeds.timeoutMs) })
  if (!res.ok) throw new Error(`feeds api answered ${res.status}`)
  const body = await res.json()
  if (body?.success === false) throw new Error('feeds api answered success: false')
  return merge(body)
}

const take = (list) => (Array.isArray(list) ? list : []).map(normalize).filter(Boolean)

// The API answers { videos: [...], articles: [...] }, each newest first. The
// grid is one stream, so the two are merged newest first and shown in full —
// how many items there are is the API's decision, not this page's. Dates carry
// no time of day, so ties fall back to the id, which the platform assigns in
// order. A flat list (the older { data } shape) is still accepted.
function merge(body) {
  const items =
    body?.videos || body?.articles
      ? [...take(body.videos), ...take(body.articles)]
      : take(Array.isArray(body) ? body : body?.data ?? body?.items)
  const time = (it) => it.publishedAt?.getTime() ?? 0
  const seq = (it) => Number(it.id) || 0
  return items.sort((a, b) => time(b) - time(a) || seq(b) - seq(a))
}

let sample = null
function fromSample() {
  sample ??= JSON.parse(readFileSync(sampleFile, 'utf8')).map(normalize).filter(Boolean)
  return sample
}

function refresh(locale, entry) {
  entry.pending ??= fromApi(locale)
    .then((items) => {
      entry.items = items
      entry.at = Date.now()
    })
    .catch((err) => {
      // Keep whatever was there: last good list beats an empty grid.
      // fetch() reports every network failure as a bare "fetch failed"; the
      // reason (ENOTFOUND, ECONNREFUSED, a TLS error…) is only on err.cause.
      const cause = err.cause ? ` (${err.cause.code || err.cause.name}: ${err.cause.message})` : ''
      console.error(`[feeds] ${locale}: ${err.message}${cause}`)
    })
    .finally(() => {
      entry.pending = null
    })
  return entry.pending
}

export async function listFeeds(locale) {
  if (!feedsLive()) return fromSample()

  let entry = cache.get(locale)
  if (!entry) cache.set(locale, (entry = { at: 0, items: null, pending: null }))

  const fresh = Date.now() - entry.at < config.feeds.cacheSeconds * 1000
  if (!entry.items) await refresh(locale, entry)
  else if (!fresh) refresh(locale, entry)
  return entry.items ?? []
}
