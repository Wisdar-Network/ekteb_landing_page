import express from 'express'
import nunjucks from 'nunjucks'
import cookieParser from 'cookie-parser'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, isProd } from './config.js'
import { loadLocales, LOCALES, DEFAULT_LOCALE, t } from './i18n.js'
import { securityMiddleware } from './middleware/security.js'
import { pagesRouter } from './routes/pages.js'
import { apiRouter } from './routes/api.js'
import { initMailer } from './services/mailer.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

loadLocales()
const mailReady = initMailer()

const app = express()

if (config.trustProxy) app.set('trust proxy', 1)
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

app.use(...securityMiddleware)
app.use(cookieParser())
app.use(express.json({ limit: '8kb' }))
app.use(express.urlencoded({ extended: false, limit: '8kb' }))

app.use(
  express.static(join(root, 'public'), {
    maxAge: isProd ? '30d' : 0,
    etag: true,
    setHeaders(res, path) {
      // Fonts and images are content-addressed enough in practice; CSS/JS get a
      // shorter life so a deploy is visible without a cache-busting query.
      if (/\.(webp|svg|png|jpe?g|woff2?)$/.test(path) && isProd) {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
      }
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

const server = app.listen(config.port, () => {
  console.log(`\n  Ekteb landing — ${config.env}`)
  console.log(`  http://localhost:${config.port}  →  /${DEFAULT_LOCALE}`)
  console.log(`  locales: ${Object.keys(LOCALES).join(', ')}   mail: ${mailReady ? 'mailgun' : 'not configured'}\n`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
