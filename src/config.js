import 'dotenv/config'

const int = (v, dflt) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? n : dflt
}

// Mailgun runs two independent stacks. A domain created in the EU dashboard is
// invisible to the US endpoint and answers 401, which reads like a bad key.
const MAILGUN_HOSTS = { us: 'https://api.mailgun.net', eu: 'https://api.eu.mailgun.net' }
const region = (process.env.MAILGUN_REGION || 'eu').trim().toLowerCase()

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  // Bind every interface by default. Inside a container 127.0.0.1 would be
  // unreachable from the Docker network, so the default has to be 0.0.0.0.
  host: process.env.HOST || '0.0.0.0',

  // Absolute origin, used for canonical/hreflang/sitemap. No trailing slash.
  siteUrl: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  appUrl: process.env.APP_URL || 'https://portal.ekteb.ai/login',

  // schema.org sameAs: the profiles that prove this Organization is the same
  // entity search engines already know from elsewhere. Comma-separated URLs.
  socialProfiles: (process.env.SOCIAL_PROFILES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // /feeds. Unset apiUrl means the page shows src/data/feeds.sample.json and
  // stays out of the index — see services/feeds.js.
  feeds: {
    apiUrl: (process.env.FEEDS_API_URL || '').trim(),
    apiKey: (process.env.FEEDS_API_KEY || '').trim(),
    limit: int(process.env.FEEDS_LIMIT, 24),
    cacheSeconds: int(process.env.FEEDS_CACHE_SECONDS, 120),
    timeoutMs: int(process.env.FEEDS_TIMEOUT_MS, 5000),
    // Hosts the cards load video and thumbnails from. CSP blocks any other
    // origin, so a new CDN must be added here. Comma-separated origins.
    mediaOrigins: (process.env.FEEDS_MEDIA_ORIGINS || 'https://ekteb-01.fra1.digitaloceanspaces.com')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  },

  mailgun: {
    apiKey: (process.env.MAILGUN_API_KEY || '').trim(),
    domain: (process.env.MAILGUN_DOMAIN || '').trim(),
    baseUrl: (process.env.MAILGUN_API_BASE || MAILGUN_HOSTS[region] || MAILGUN_HOSTS.us).replace(/\/+$/, ''),
    region,
    from: process.env.MAIL_FROM || 'Ekteb <no-reply@ekteb.com>',
    to: (process.env.MAIL_TO || '').trim(),
    // The visitor waits on this call, so it cannot hang on a stalled socket.
    timeoutMs: int(process.env.MAILGUN_TIMEOUT_MS, 10000),
  },
}

export const isProd = config.env === 'production'
