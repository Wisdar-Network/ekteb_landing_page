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
 * through normalize(), which is the only place that knows the wire format —
 * when the API contract lands, that function is what changes, not the
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

export function normalize(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const type = str(raw.type).toLowerCase() === 'video' ? 'video' : 'article'
  const title = str(raw.title)
  if (!title) return null

  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
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
    sourceLang: str(raw.source_language ?? raw.sourceLang ?? raw.language).toLowerCase(),
    publishedAt: Number.isNaN(date.getTime()) ? null : date,
    duration: type === 'video' ? seconds(raw.duration) : null,
    words: type === 'article' ? Number.parseInt(raw.word_count ?? raw.words, 10) || null : null,
    tags,
    video: type === 'video' ? httpUrl(raw.video_url ?? raw.videoUrl) : '',
    image: httpUrl(raw.thumbnail ?? raw.image ?? raw.poster),
  }
}

/* ── fetching ──────────────────────────────────────────────────────────── */

const cache = new Map() // locale → { at, items, pending }

async function fromApi(locale) {
  const url = new URL(config.feeds.apiUrl)
  url.searchParams.set('language', locale)
  url.searchParams.set('limit', String(config.feeds.limit))
  const headers = { Accept: 'application/json' }
  if (config.feeds.apiKey) headers.Authorization = `Bearer ${config.feeds.apiKey}`

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(config.feeds.timeoutMs) })
  if (!res.ok) throw new Error(`feeds api answered ${res.status}`)
  const body = await res.json()
  const list = Array.isArray(body) ? body : body?.data ?? body?.items ?? []
  return list.map(normalize).filter(Boolean)
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
      console.error(`[feeds] ${locale}: ${err.message}`)
    })
    .finally(() => {
      entry.pending = null
    })
  return entry.pending
}

export async function listFeeds(locale) {
  if (!feedsLive()) return fromSample().slice(0, config.feeds.limit)

  let entry = cache.get(locale)
  if (!entry) cache.set(locale, (entry = { at: 0, items: null, pending: null }))

  const fresh = Date.now() - entry.at < config.feeds.cacheSeconds * 1000
  if (!entry.items) await refresh(locale, entry)
  else if (!fresh) refresh(locale, entry)
  return entry.items ?? []
}
