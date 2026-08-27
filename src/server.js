import express from 'express'
import nunjucks from 'nunjucks'
import cookieParser from 'cookie-parser'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, isProd } from './config.js'
import { assetUrl } from './assets.js'
import { loadLocales, LOCALES, DEFAULT_LOCALE, t } from './i18n.js'
import { securityMiddleware } from './middleware/security.js'
import { pagesRouter } from './routes/pages.js'
import { apiRouter } from './routes/api.js'
import { initMailer } from './services/mailer.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

loadLocales()
const mailReady = initMailer()

const app = express()

// One hop: this always runs behind a reverse proxy, and without this every
// visitor would share a single rate-limit budget keyed to the proxy's IP.
// Raise to 2 if a second proxy is added in front; delete it only if the
// container is ever exposed to the internet directly.
app.set('trust proxy', 1)
app.disable('x-powered-by')

const env = nunjucks.configure(join(root, 'views'), {
  autoescape: true,
  express: app,
  // noCache re-reads templates from disk on every render, which is all dev
  // needs. nunjucks watch mode would additionally require chokidar.
  noCache: !isProd,
})
// `| safe` stays explicit at the call site; this only exposes the raw string.
env.addFilter('nl2br', (s) => String(s).replace(/\n/g, '<br>'))
// Every static URL a template emits goes through this. See src/assets.js.
env.addGlobal('asset', assetUrl)

app.use(...securityMiddleware)
app.use(cookieParser())
app.use(express.json({ limit: '8kb' }))
app.use(express.urlencoded({ extended: false, limit: '8kb' }))

app.use(
  express.static(join(root, 'public'), {
    // maxAge is deliberately absent: Cache-Control is decided per request
    // below, and express.static's own value would overwrite it.
    etag: true,
    setHeaders(res) {
      if (!isProd) {
        // A reload during development must never show yesterday's stylesheet.
        res.setHeader('Cache-Control', 'no-store')
        return
      }
      // asset() stamps a hash of the file's bytes into every URL a template
      // emits, so a stamped URL can never name stale content - cache it for a
      // year and skip revalidation entirely. A bare path is one this deploy
      // did not hand out (a bookmark, a crawler, a page still sitting in
      // someone's cache), so it revalidates on every use: a 304 costs one
      // round trip, a month of stale CSS costs a broken layout.
      res.setHeader(
        'Cache-Control',
        res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache'
      )
    },
  })
)

app.use('/api', apiRouter)
app.use('/', pagesRouter)

app.use((req, res) => {
  const locale = LOCALES[req.path.split('/')[1]] ? req.path.split('/')[1] : DEFAULT_LOCALE
  res.status(404)
  if (req.accepts('html')) {
    return res.render('404.njk', {
      locale,
      ...LOCALES[locale],
      t: t(locale),
      siteUrl: config.siteUrl,
    })
  }
  res.json({ ok: false, error: 'not_found' })
})

app.use((err, _req, res, _next) => {
  console.error('[server]', err)
  res.status(500).json({ ok: false, error: 'server_error' })
})

const server = app.listen(config.port, config.host, () => {
  console.log(`\n  Ekteb landing — ${config.env}`)
  console.log(`  listening on ${config.host}:${config.port}  →  /${DEFAULT_LOCALE}`)
  console.log(`  locales: ${Object.keys(LOCALES).join(', ')}   mail: ${mailReady ? 'mailgun' : 'not configured'}\n`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
