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

/**
 * Where a visitor lands when their browser asks for a language this site does
 * not publish. Deliberately not DEFAULT_LOCALE: Arabic is the primary market
 * and the master copy, but someone whose browser is set to French or Spanish
 * reads English far more often than Arabic, so an unmatched header is answered
 * in English. Changing this must also move the `x-default` hreflang in
 * routes/pages.js — that tag *is* the declaration of this behaviour.
 */
export const FALLBACK_LOCALE = 'en'

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
 * FALLBACK_LOCALE when nothing matches, when the header is absent, or when it
 * is a bare `*`.
 */
export function negotiate(header = '') {
  const ranked = String(header)
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.trim().toLowerCase(), q: q ? Number.parseFloat(q.split('=')[1]) || 0 : 1 }
    })
    // q=0 is not a weak preference, it is a refusal: `fr, ar;q=0` means the
    // visitor would rather have anything than Arabic. Ranking it last would
    // still hand it to them once nothing better matched.
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0]
    if (isLocale(primary)) return primary
  }
  return FALLBACK_LOCALE
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
