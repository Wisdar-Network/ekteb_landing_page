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
import { listFeeds, feedsLive } from '../services/feeds.js'

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

/* ── /:locale/feeds ────────────────────────────────────────────────────── */

const FEED_TYPES = ['video', 'article']

// Arabic pages keep Latin digits, as the rest of the copy does.
const intlTag = (locale) => (locale === 'ar' ? 'ar-u-nu-latn' : LOCALES[locale].htmlLang)

function clock(sec) {
  if (sec == null) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = String(sec % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Everything locale-dependent is formatted here so the template only prints.
// Language names come from Intl rather than the locale files: the API can
// report any source language, and no hand-kept list would cover them all.
function presentFeeds(items, locale) {
  const tag = intlTag(locale)
  const langs = new Intl.DisplayNames([tag], { type: 'language', fallback: 'none' })
  const date = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const num = new Intl.NumberFormat(tag)
  const { words } = t(locale).feeds

  return items.map((it) => {
    let langLabel = ''
    try {
      langLabel = it.sourceLang ? langs.of(it.sourceLang) ?? '' : ''
    } catch {}
    return {
      ...it,
      initial: [...(it.source || '#')][0].toUpperCase(),
      // Article covers are tinted by source, so one outlet keeps one colour
      // wherever it lands in the grid.
      tone: [...it.source].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 7) % 4,
      langLabel,
      iso: it.publishedAt ? it.publishedAt.toISOString() : '',
      dateLabel: it.publishedAt ? date.format(it.publishedAt) : '',
      durLabel: clock(it.duration),
      wordsLabel: it.words ? words.replace('{n}', num.format(it.words)) : '',
    }
  })
}

pagesRouter.get('/:locale/feeds', async (req, res, next) => {
  const { locale } = req.params
  if (!isLocale(locale)) return next()
  rememberLocale(req, res, locale)
  res.set('Cache-Control', 'public, max-age=0, must-revalidate')

  let items
  try {
    items = presentFeeds(await listFeeds(locale), locale)
  } catch (err) {
    return next(err)
  }
  // ?type= is the no-script path for the filter: the server hides the other
  // cards itself. With scripting, feeds.js filters in place and keeps the URL
  // in step, so a shared link opens on the same tab either way.
  const filter = FEED_TYPES.includes(req.query.type) ? req.query.type : 'all'
  const live = feedsLive()

  res.render(
    'feeds.njk',
    view(locale, {
      items,
      filter,
      counts: {
        all: items.length,
        video: items.filter((it) => it.type === 'video').length,
        article: items.filter((it) => it.type === 'article').length,
      },
      canonical: `${config.siteUrl}/${locale}/feeds`,
      locales: alternates(config.siteUrl, '/feeds'),
      xDefault: `${config.siteUrl}/${FALLBACK_LOCALE}/feeds`,
      // The shared header and switcher link back into the landing page and
      // across to this page in other languages.
      navBase: `/${locale}`,
      pagePath: '/feeds',
      pageTitle: t(locale).feeds.meta.title,
      pageDescription: t(locale).feeds.meta.description,
      // Sample items are placeholders: they must not be what search engines
      // remember this URL for.
      robots: live ? null : 'noindex, follow',
    })
  )
})

/* ── /:locale/privacy, /:locale/terms ──────────────────────────────────── */

// The mobile app's store listings link to these URLs, so they must not move.
// The effective date is one fact for all three languages, so it lives here
// rather than in each locale file; bump it whenever the text changes.
const LEGAL_PAGES = {
  privacy: { updated: '2026-10-29' },
  terms: { updated: '2026-10-29' },
}

for (const [page, { updated }] of Object.entries(LEGAL_PAGES)) {
  pagesRouter.get(`/:locale/${page}`, (req, res, next) => {
    const { locale } = req.params
    if (!isLocale(locale)) return next()
    rememberLocale(req, res, locale)
    res.set('Cache-Control', 'public, max-age=0, must-revalidate')

    const doc = t(locale).legal[page]
    const date = new Intl.DateTimeFormat(intlTag(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    res.render(
      'legal.njk',
      view(locale, {
        doc,
        // The page each document links across to at its foot.
        other: page === 'privacy' ? 'terms' : 'privacy',
        updatedIso: updated,
        updatedLabel: date.format(new Date(updated)),
        canonical: `${config.siteUrl}/${locale}/${page}`,
        locales: alternates(config.siteUrl, `/${page}`),
        xDefault: `${config.siteUrl}/${FALLBACK_LOCALE}/${page}`,
        navBase: `/${locale}`,
        pagePath: `/${page}`,
        pageTitle: doc.meta.title,
        pageDescription: doc.meta.description,
      })
    )
  })
}

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
  })
  // Listed only once real items are behind it; the sample set is noindex.
  // No lastmod: the content changes with the feed, not with the source files.
  if (feedsLive()) {
    for (const code of LOCALE_CODES) {
      const links = LOCALE_CODES.map(
        (alt) =>
          `    <xhtml:link rel="alternate" hreflang="${LOCALES[alt].htmlLang}" href="${config.siteUrl}/${alt}/feeds"/>`
      ).join('\n')
      urls.push(
        [
          `  <url>`,
          `    <loc>${config.siteUrl}/${code}/feeds</loc>`,
          `    <changefreq>hourly</changefreq>`,
          `    <priority>0.7</priority>`,
          links,
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${config.siteUrl}/${FALLBACK_LOCALE}/feeds"/>`,
          `  </url>`,
        ].join('\n')
      )
    }
  }
  // lastmod is the document's own effective date: the text, not the code
  // around it, is what a crawler should re-read.
  for (const [page, { updated }] of Object.entries(LEGAL_PAGES)) {
    for (const code of LOCALE_CODES) {
      const links = LOCALE_CODES.map(
        (alt) =>
          `    <xhtml:link rel="alternate" hreflang="${LOCALES[alt].htmlLang}" href="${config.siteUrl}/${alt}/${page}"/>`
      ).join('\n')
      urls.push(
        [
          `  <url>`,
          `    <loc>${config.siteUrl}/${code}/${page}</loc>`,
          `    <lastmod>${updated}</lastmod>`,
          `    <changefreq>yearly</changefreq>`,
          `    <priority>0.3</priority>`,
          links,
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${config.siteUrl}/${FALLBACK_LOCALE}/${page}"/>`,
          `  </url>`,
        ].join('\n')
      )
    }
  }
  const body = urls.join('\n')

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      `${body}\n</urlset>\n`
  )
})
