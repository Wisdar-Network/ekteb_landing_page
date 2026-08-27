import { Router } from 'express'
import { config } from '../config.js'
import { assetUrl } from '../assets.js'
import { LOCALES, LOCALE_CODES, DEFAULT_LOCALE, FALLBACK_LOCALE, alternates, isLocale, t } from '../i18n.js'
import { pickLocale, rememberLocale, varyOnLanguage } from '../middleware/locale.js'
import {
  structuredData,
  jsonLdScript,
  llmsTxt,
  llmsFullTxt,
  robotsTxt,
  lastModifiedDate,
} from '../seo.js'

export const pagesRouter = Router()

function view(locale, extra = {}) {
  return {
    locale,
    ...LOCALES[locale],
    t: t(locale),
    locales: alternates(config.siteUrl, ''),
    localeCodes: LOCALE_CODES,
    siteUrl: config.siteUrl,
    appUrl: config.appUrl,
    canonical: `${config.siteUrl}/${locale}`,
    // Derived, not written into the template: x-default names the page an
    // unmatched visitor gets, so it has to follow pickLocale() rather than sit
    // as a hardcoded /ar in the head.
    xDefault: `${config.siteUrl}/${FALLBACK_LOCALE}`,
    // Stamped like every other asset. Social platforms cache an image against
    // its URL and ignore Cache-Control, so a new logo is only ever picked up
    // because the URL changed with it.
    ogImage: `${config.siteUrl}${assetUrl('/media/og/og.png')}`,
    ...extra,
  }
}

pagesRouter.get('/', varyOnLanguage, (req, res) => {
  res.redirect(302, `/${pickLocale(req)}`)
})

pagesRouter.get('/:locale', (req, res, next) => {
  const { locale } = req.params
  if (!isLocale(locale)) return next()
  rememberLocale(req, res, locale)
  // Revalidate rather than expire: an ETag 304 costs a round trip, while a
  // fixed max-age would serve stale copy after an edit.
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  // Serialised here rather than in the template: escaping JSON-LD correctly is
  // a security concern, not a formatting one. See jsonLdScript().
  res.render('index.njk', view(locale, { jsonLd: jsonLdScript(structuredData(locale)) }))
})

// The scroll-driven funnel lives in its own document so its animation engine
// keeps a private scroll timeline; it is rendered per locale like any page.
pagesRouter.get('/funnel/:locale', (req, res, next) => {
  const { locale } = req.params
  if (!isLocale(locale)) return next()
  // Same rule as the page that frames it: the document always revalidates, so
  // a deploy's new asset URLs reach the iframe on the next load rather than
  // whenever a heuristic freshness lifetime happens to run out.
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')
  res.render('funnel.njk', view(locale, { canonical: null }))
})

pagesRouter.get('/robots.txt', (_req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsTxt())
})

// llmstxt.org: a plain-text brief for answer engines, which otherwise have to
// infer the product from a page built largely of animation and inline SVG.
pagesRouter.get('/llms.txt', (_req, res) => {
  res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(llmsTxt())
})

pagesRouter.get('/llms-full.txt', (_req, res) => {
  res
    .type('text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=3600')
    .send(llmsFullTxt())
})

pagesRouter.get('/sitemap.xml', (_req, res) => {
  // The newest content date, not today's — a lastmod that always says 'today'
  // teaches crawlers the field carries no information.
  const today = lastModifiedDate()
  const urls = LOCALE_CODES.map((code) => {
    const links = LOCALE_CODES.map(
      (alt) =>
        `    <xhtml:link rel="alternate" hreflang="${LOCALES[alt].htmlLang}" href="${config.siteUrl}/${alt}"/>`
    ).join('\n')
    return [
      `  <url>`,
      `    <loc>${config.siteUrl}/${code}</loc>`,
      `    <lastmod>${today}</lastmod>`,
      `    <changefreq>weekly</changefreq>`,
      `    <priority>${code === DEFAULT_LOCALE ? '1.0' : '0.9'}</priority>`,
      links,
      // x-default is not "the main language" — it is the page served to a
      // visitor whose language matches nothing, which is exactly what
      // pickLocale() does. The two must name the same locale or the sitemap
      // tells crawlers something the server does not do.
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${config.siteUrl}/${FALLBACK_LOCALE}"/>`,
      `  </url>`,
    ].join('\n')
  }).join('\n')

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      `${urls}\n</urlset>\n`
  )
})
