import { Router } from 'express'
import { z } from 'zod'
import { sendLead, isMailerReady } from '../services/mailer.js'
import { seenRecently, remember } from '../services/dedupe.js'
import { contactLimiter } from '../middleware/security.js'
import { DEFAULT_LOCALE, isLocale } from '../i18n.js'
import { isProd } from '../config.js'

export const apiRouter = Router()

const ContactSchema = z.object({
  email: z.string().trim().min(5).max(254).email(),
  locale: z.string().optional(),
  // Honeypot: a real person never sees this field, so anything in it is a bot.
  company: z.string().max(0).optional().or(z.literal('')),
  // Round-trip time in ms, stamped by the client on first interaction.
  elapsed: z.coerce.number().nonnegative().optional(),
})

const MIN_FILL_MS = 1500

apiRouter.post('/contact', contactLimiter, async (req, res) => {
  const parsed = ContactSchema.safeParse(req.body ?? {})

  if (!parsed.success) {
    const bot = typeof req.body?.company === 'string' && req.body.company.length > 0
    // Bots get a 200 so they stop retrying and learn nothing about the check.
    return bot ? res.json({ ok: true }) : res.status(400).json({ ok: false, error: 'invalid_email' })
  }

  const { email, elapsed } = parsed.data
  const locale = isLocale(parsed.data.locale) ? parsed.data.locale : DEFAULT_LOCALE

  if (elapsed !== undefined && elapsed < MIN_FILL_MS) return res.json({ ok: true })
  if (seenRecently(email)) return res.json({ ok: true, duplicate: true })

  const lead = {
    email,
    locale,
    referer: req.get('referer'),
    userAgent: req.get('user-agent'),
  }

  // Mail is the only place a lead lives now, so an unconfigured mailer must not
  // answer with a success the visitor would believe. Development still accepts
  // the submission — the console line below is the record there.
  if (!isMailerReady()) {
    console.warn(`[contact] LEAD (mailgun not configured): ${email} · ${locale} · ${lead.referer || '—'}`)
    if (isProd) return res.status(503).json({ ok: false, error: 'mail_unavailable' })
    remember(email)
    return res.status(201).json({ ok: true, delivered: false })
  }

  try {
    await sendLead(lead)
    remember(email)
    return res.status(201).json({ ok: true })
  } catch (err) {
    // Loud and complete: this line is the only copy of the lead if Mailgun is
    // down, so it has to carry the address, not just the failure.
    console.error(`[contact] DELIVERY FAILED — lead not saved anywhere else: ${email} · ${locale}`)
    console.error('[contact] mailgun:', err.message)
    return res.status(502).json({ ok: false, error: 'mail_failed' })
  }
})
