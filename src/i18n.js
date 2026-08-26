import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales')

/**
 * Locale registry. `dir` drives <html dir>, `htmlLang` is the BCP-47 tag,
 * and `label` is what the language switcher shows — always written in the
 * language it switches to, never translated.
 */
export const LOCALES = {
  ar: { dir: 'rtl', htmlLang: 'ar', ogLocale: 'ar_AR', label: 'العربية' },
  en: { dir: 'ltr', htmlLang: 'en', ogLocale: 'en_US', label: 'English' },
  tr: { dir: 'ltr', htmlLang: 'tr', ogLocale: 'tr_TR', label: 'Türkçe' },
}

export const LOCALE_CODES = Object.keys(LOCALES)
export const DEFAULT_LOCALE = 'ar'

// Per-key fallback chain: a missing tr key falls through to en, then ar, so a
// half-finished translation never renders an empty heading.
const FALLBACKS = { ar: [], en: ['ar'], tr: ['en', 'ar'] }

const strings = {}

function deepFill(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = deepFill(target[k] ?? {}, v)
    } else if (target[k] === undefined || target[k] === '') {
      target[k] = v
    }
  }
  return target
}

export function loadLocales() {
  const raw = {}
  for (const code of LOCALE_CODES) {
    raw[code] = JSON.parse(readFileSync(join(localesDir, `${code}.json`), 'utf8'))
  }
  for (const code of LOCALE_CODES) {
    let merged = structuredClone(raw[code])
    for (const fb of FALLBACKS[code]) merged = deepFill(merged, raw[fb])
    strings[code] = merged
  }
  return strings
}

export const t = (locale) => strings[locale] ?? strings[DEFAULT_LOCALE]

export const isLocale = (v) => Object.hasOwn(LOCALES, v)

/**
 * Pick a locale from an Accept-Language header. Matches the primary subtag so
 * `tr-TR`, `ar-SA`, and `en-GB` all land on a supported locale; falls back to
 * DEFAULT_LOCALE when nothing matches.
 */
export function negotiate(header = '') {
  const ranked = String(header)
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.trim().toLowerCase(), q: q ? Number.parseFloat(q.split('=')[1]) || 0 : 1 }
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0]
    if (isLocale(primary)) return primary
  }
  return DEFAULT_LOCALE
}

/** Every locale's URL for this page — used for hreflang and the switcher. */
export function alternates(siteUrl, path = '') {
  return LOCALE_CODES.map((code) => ({
    code,
    ...LOCALES[code],
    href: `${siteUrl}/${code}${path}`,
  }))
}

export const availableLocaleFiles = () =>
  readdirSync(localesDir).filter((f) => f.endsWith('.json'))
