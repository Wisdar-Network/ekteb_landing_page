import { statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'
import { LOCALES, LOCALE_CODES, DEFAULT_LOCALE, t } from './i18n.js'

/**
 * Everything a machine reads about this site: schema.org JSON-LD for search
 * engines, and llms.txt for answer engines.
 *
 * Both are derived from locales/*.json rather than written by hand, so a copy
 * change cannot leave the structured data describing an older page.
 */

/* ── freshness ─────────────────────────────────────────────────────────── */

/**
 * dateModified from the newest source file, not from "now".
 *
 * A sitemap that stamps today's date on every crawl teaches the crawler that
 * lastmod carries no information, and it starts ignoring it.
 */
function newestMtime(dirs = ['locales', 'views', 'public/css', 'public/js']) {
  let newest = 0
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const m = statSync(p).mtimeMs
        if (m > newest) newest = m
      }
    }
  }
  dirs.forEach(walk)
  return new Date(newest || Date.now())
}

export const LAST_MODIFIED = newestMtime()
export const lastModifiedDate = () => LAST_MODIFIED.toISOString().slice(0, 10)

/* ── shared ids ────────────────────────────────────────────────────────── */

const ORG = () => `${config.siteUrl}/#organization`
const SITE = () => `${config.siteUrl}/#website`
const APP = () => `${config.siteUrl}/#software`

const pageUrl = (locale) => `${config.siteUrl}/${locale}`

/* ── JSON-LD ───────────────────────────────────────────────────────────── */

/**
 * One @graph per page, with cross-references by @id instead of repeated
 * objects — that is what lets a crawler see the organisation behind three
 * localised pages as a single entity rather than three.
 */
export function structuredData(locale) {
  const tr = t(locale)
  const url = pageUrl(locale)
  const langs = LOCALE_CODES.map((c) => LOCALES[c].htmlLang)

  const organization = {
    '@type': 'Organization',
    '@id': ORG(),
    name: tr.meta.siteName,
    alternateName: 'Ekteb',
    url: config.siteUrl,
    description: tr.seo.orgDescription,
    logo: {
      '@type': 'ImageObject',
      '@id': `${config.siteUrl}/#logo`,
      url: `${config.siteUrl}/media/og/logo-512.png`,
      contentUrl: `${config.siteUrl}/media/og/logo-512.png`,
      width: 512,
      height: 512,
      caption: tr.meta.siteName,
    },
    image: { '@id': `${config.siteUrl}/#logo` },
  }
  if (config.socialProfiles.length) organization.sameAs = config.socialProfiles

  const website = {
    '@type': 'WebSite',
    '@id': SITE(),
    url: config.siteUrl,
    name: tr.meta.siteName,
    description: tr.meta.description,
    publisher: { '@id': ORG() },
    inLanguage: langs,
  }

  const software = {
    // Both types, not just SoftwareApplication: browserRequirements is defined
    // on WebApplication only, so the bare parent type makes it an unrecognised
    // property (schema.org's validator flags it). WebApplication is also the
    // truer description, and Google's Software App rich result accepts it.
    '@type': ['SoftwareApplication', 'WebApplication'],
    '@id': APP(),
    name: tr.meta.siteName,
    url: config.siteUrl,
    description: tr.seo.orgDescription,
    applicationCategory: tr.seo.appCategory,
    applicationSubCategory: 'Content production',
    operatingSystem: 'Web browser',
    browserRequirements: 'Requires a modern browser',
    inLanguage: langs,
    publisher: { '@id': ORG() },
    provider: { '@id': ORG() },
    screenshot: `${config.siteUrl}/media/opt/hero-app.webp`,
    featureList: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((k) => tr.features[k].h3),
  }

  const questions = (tr.faq.items || []).map((item, i) => ({
    '@type': 'Question',
    '@id': `${url}#faq-${i + 1}`,
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  }))

  const webpage = {
    // FAQPage sits on the page node itself: the questions are this page's
    // main entity, not a separate document.
    '@type': questions.length ? ['WebPage', 'FAQPage'] : 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: tr.meta.title,
    description: tr.meta.description,
    isPartOf: { '@id': SITE() },
    about: { '@id': APP() },
    inLanguage: LOCALES[locale].htmlLang,
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: `${config.siteUrl}/media/og/og.png`,
      width: 1200,
      height: 630,
    },
    dateModified: LAST_MODIFIED.toISOString(),
    potentialAction: {
      '@type': 'CommunicateAction',
      name: tr.contact.submit,
      target: `${url}#contact`,
    },
  }
  if (questions.length) webpage.mainEntity = questions

  return { '@context': 'https://schema.org', '@graph': [organization, website, software, webpage] }
}

/**
 * Serialise a JSON-LD graph for embedding in HTML.
 *
 * JSON-LD is data, not executable code, so CSP's script-src does not apply to
 * it — but the HTML parser still ends the block at the first literal
 * `</script>`. Escaping every angle bracket is what stops a copy string from
 * closing it early; U+2028/9 are escaped because they are valid in JSON but
 * are line terminators in JavaScript.
 */
export function jsonLdScript(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/* ── llms.txt ──────────────────────────────────────────────────────────── */

/**
 * llms.txt (llmstxt.org): a plain-markdown brief for answer engines, which
 * would otherwise have to infer the offering from a page built mostly of
 * animation and inline SVG.
 */
export function llmsTxt() {
  const en = t('en')
  const L = []

  L.push(`# ${en.meta.siteName}`)
  L.push('')
  L.push(`> ${en.seo.orgDescription}`)
  L.push('')
  L.push(
    `${en.meta.siteName} is a web application for content teams. This site is the product's landing page and is published in Arabic, English and Turkish; each language is a separate URL with the same content.`
  )
  L.push('')

  L.push('## Pages')
  L.push('')
  for (const code of LOCALE_CODES) {
    const tr = t(code)
    L.push(`- [${tr.meta.title}](${pageUrl(code)}): ${tr.meta.description} (${LOCALES[code].label})`)
  }
  L.push('')

  L.push('## What it does')
  L.push('')
  for (const k of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']) {
    L.push(`- **${en.features[k].h3}** — ${en.features[k].p}`)
  }
  L.push('')

  L.push('## How it works')
  L.push('')
  for (const k of ['c1', 'c2', 'c3']) {
    const title = (en.steps[k].h3_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    L.push(`- **${title}** — ${en.steps[k].p}`)
  }
  L.push('')

  L.push('## Questions and answers')
  L.push('')
  for (const item of en.faq.items) {
    L.push(`- **${item.q}** ${item.a}`)
  }
  L.push('')

  L.push('## Optional')
  L.push('')
  L.push(`- [Full text of every page, all three languages](${config.siteUrl}/llms-full.txt)`)
  L.push(`- [Sitemap](${config.siteUrl}/sitemap.xml)`)
  L.push('')

  return L.join('\n')
}

/** The expanded companion: the readable copy of all three pages, in full. */
export function llmsFullTxt() {
  const L = []
  L.push(`# ${t('en').meta.siteName} — full site text`)
  L.push('')
  L.push(`Last modified: ${lastModifiedDate()}`)
  L.push('')

  for (const code of LOCALE_CODES) {
    const tr = t(code)
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    L.push('---')
    L.push('')
    L.push(`## ${LOCALES[code].label} — ${pageUrl(code)}`)
    L.push('')
    L.push(`**${strip(tr.hero.line1)} ${strip(tr.hero.line2)}**`)
    L.push('')
    L.push(strip(tr.hero.lead))
    L.push('')

    L.push(`### ${strip(tr.problem.h2_html)}`)
    L.push('')
    L.push(strip(tr.problem.lead))
    L.push('')
    for (const side of ['bad', 'good']) {
      const b = tr.problem[side]
      L.push(`**${strip(b.title)}** — ${strip(b.sub)}`)
      L.push('')
      for (const item of b.items || []) L.push(`- ${strip(item)}`)
      L.push('')
    }

    L.push(`### ${strip(tr.steps.h2)}`)
    L.push('')
    for (const k of ['c1', 'c2', 'c3']) {
      L.push(`${strip(tr.steps[k].h3_html)} — ${strip(tr.steps[k].p)}`)
    }
    L.push('')

    L.push(`### ${strip(tr.features.h2_html)}`)
    L.push('')
    for (const k of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']) {
      L.push(`- **${strip(tr.features[k].h3)}** — ${strip(tr.features[k].p)}`)
    }
    L.push('')

    L.push(`### ${strip(tr.usecases.h2_html)}`)
    L.push('')
    for (const item of tr.usecases.items || []) {
      L.push(`- **${strip(item.h3)}** — ${strip(item.p)}`)
    }
    L.push('')

    L.push(`### ${strip(tr.enterprise.h2)}`)
    L.push('')
    for (const item of tr.enterprise.items || []) {
      L.push(`- **${strip(item.h3_html || item.h3)}** — ${strip(item.p)}`)
    }
    L.push('')

    L.push(`### ${strip(tr.faq.h2)}`)
    L.push('')
    for (const item of tr.faq.items) {
      L.push(`**${strip(item.q)}**`)
      L.push('')
      L.push(strip(item.a))
      L.push('')
    }
  }

  return L.join('\n')
}

/* ── robots.txt ────────────────────────────────────────────────────────── */

/**
 * AI user agents fall into two groups, and they deserve different answers:
 *
 *  - Answer/search crawlers (OAI-SearchBot, PerplexityBot, ClaudeBot…) fetch a
 *    page in order to cite it to a user. Blocking them removes the site from
 *    those answers, so they are allowed.
 *  - Bulk dataset scrapers (CCBot) collect for corpora with no referral back.
 *    Allowed here too, because a landing page is public marketing copy and
 *    presence in those corpora is what makes a model able to name the product
 *    at all — flip the Allow to Disallow below if that changes.
 *
 * Google-Extended and Applebot-Extended are not crawlers: they are opt-out
 * switches for Gemini/Apple Intelligence training. They are listed explicitly
 * so the choice is visible rather than defaulted.
 */
const AI_AGENTS = [
  ['OAI-SearchBot', 'ChatGPT search results'],
  ['ChatGPT-User', 'a user asking ChatGPT to open this page'],
  ['GPTBot', 'OpenAI crawler'],
  ['ClaudeBot', 'Anthropic crawler'],
  ['Claude-User', 'a user asking Claude to open this page'],
  ['Claude-SearchBot', 'Claude search results'],
  ['PerplexityBot', 'Perplexity answers'],
  ['Perplexity-User', 'a user asking Perplexity to open this page'],
  ['Google-Extended', 'Gemini grounding and training'],
  ['Applebot', 'Siri and Spotlight'],
  ['Applebot-Extended', 'Apple Intelligence training'],
  ['meta-externalagent', 'Meta AI'],
  ['Amazonbot', 'Alexa answers'],
  ['Bytespider', 'ByteDance / TikTok search'],
  ['CCBot', 'Common Crawl'],
  ['Diffbot', 'knowledge graph'],
  ['cohere-ai', 'Cohere'],
  ['YouBot', 'You.com'],
]

export function robotsTxt() {
  const L = []
  L.push('# Ekteb — https://ekteb.ai')
  L.push('')
  L.push('User-agent: *')
  L.push('Allow: /')
  L.push('Disallow: /api/')
  L.push('')
  L.push('# AI crawlers and answer engines. Allowed on purpose: this is public')
  L.push('# marketing copy, and being citable is the point.')
  for (const [agent, why] of AI_AGENTS) {
    L.push('')
    L.push(`# ${why}`)
    L.push(`User-agent: ${agent}`)
    L.push('Allow: /')
    L.push('Disallow: /api/')
  }
  L.push('')
  L.push(`Sitemap: ${config.siteUrl}/sitemap.xml`)
  L.push('')
  return L.join('\n')
}
