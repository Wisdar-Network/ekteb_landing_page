import { config, isProd } from '../config.js'

/**
 * Lead delivery over the Mailgun HTTP API.
 *
 * The API is a single form-encoded POST, so this talks to it with the built-in
 * fetch rather than pulling in an SDK — one less dependency to keep current,
 * and the failure modes stay visible in the log.
 *
 * With no database behind it any more, this send IS the lead record. So unlike
 * the previous fire-and-forget notifier, a failure here has to reach the
 * visitor: see routes/api.js.
 */

let ready = false

export function initMailer() {
  const { apiKey, domain, to, region } = config.mailgun
  const missing = [
    !apiKey && 'MAILGUN_API_KEY',
    !domain && 'MAILGUN_DOMAIN',
    !to && 'MAIL_TO',
  ].filter(Boolean)

  if (missing.length) {
    ready = false
    console.warn(
      `[mail] Mailgun not configured (missing ${missing.join(', ')}) — ` +
        (isProd
          ? 'the contact form will answer 503 and refuse the lead'
          : 'submissions will be logged to this console instead of sent')
    )
    return false
  }

  ready = true
  console.log(`[mail] Mailgun ready — ${domain} (${region}) → ${to}`)
  return true
}

export const isMailerReady = () => ready

const endpoint = () => `${config.mailgun.baseUrl}/v3/${encodeURIComponent(config.mailgun.domain)}/messages`

const auth = () => 'Basic ' + Buffer.from(`api:${config.mailgun.apiKey}`).toString('base64')

function body({ email, locale, referer, userAgent }) {
  const text = [
    `Email:   ${email}`,
    `Locale:  ${locale}`,
    `Page:    ${referer || '—'}`,
    `Client:  ${(userAgent || '—').slice(0, 200)}`,
    `Time:    ${new Date().toISOString()}`,
  ].join('\n')

  const form = new URLSearchParams({
    from: config.mailgun.from,
    to: config.mailgun.to,
    subject: `New Ekteb lead — ${email}`,
    text,
    // Replying in the mail client answers the visitor directly.
    'h:Reply-To': email,
    // Tags make lead volume filterable in the Mailgun dashboard.
    'o:tag': 'lead',
  })
  form.append('o:tag', `locale-${locale}`)
  return form
}

/**
 * Send one lead. Resolves on delivery, throws otherwise.
 *
 * Retries once, and only on the failures a retry can actually fix: a network
 * error, a 5xx, or a 429. A 401 or 404 means the key or domain is wrong, and
 * hammering it just doubles the visitor's wait.
 */
export async function sendLead(lead) {
  if (!ready) throw new Error('mailgun_not_configured')

  const payload = body(lead)
  let last

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(endpoint(), {
        method: 'POST',
        headers: {
          Authorization: auth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: payload,
        signal: AbortSignal.timeout(config.mailgun.timeoutMs),
      })

      if (res.ok) {
        const info = await res.json().catch(() => ({}))
        return { id: info.id || null }
      }

      const detail = (await res.text().catch(() => '')).slice(0, 300)
      last = new Error(`mailgun ${res.status}: ${detail || res.statusText}`)
      if (res.status < 500 && res.status !== 429) break
    } catch (err) {
      last = err
    }

    if (attempt === 1) await new Promise((r) => setTimeout(r, 400))
  }

  throw last || new Error('mailgun_failed')
}
