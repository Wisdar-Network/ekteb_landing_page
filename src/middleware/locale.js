import { DEFAULT_LOCALE, isLocale, negotiate } from '../i18n.js'

export const LANG_COOKIE = 'ekteb-lang'
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000

/**
 * Resolve which locale a bare `/` visitor should land on: an explicit prior
 * choice beats the browser's preference, which beats the site default.
 */
export function pickLocale(req) {
  const cookie = req.cookies?.[LANG_COOKIE]
  if (isLocale(cookie)) return cookie
  return negotiate(req.headers['accept-language']) || DEFAULT_LOCALE
}

/**
 * Remember the visitor's choice so `/` sends them back to the same language.
 *
 * Only written when it would actually change: a Set-Cookie on every page view
 * makes most CDNs treat the response as private and refuse to cache it, which
 * costs far more than the cookie is worth.
 */
export function rememberLocale(req, res, locale) {
  if (req.cookies?.[LANG_COOKIE] === locale) return
  res.cookie(LANG_COOKIE, locale, {
    maxAge: COOKIE_MAX_AGE,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  })
}

/** Responses at `/` differ by header, so caches must not share one copy. */
export function varyOnLanguage(_req, res, next) {
  res.setHeader('Vary', 'Accept-Language, Cookie')
  next()
}
