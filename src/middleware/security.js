import helmet from 'helmet'
import compression from 'compression'
import { rateLimit } from 'express-rate-limit'
import { isProd } from '../config.js'

/**
 * CSP notes:
 *  - script-src stays 'self': every inline <script> from the design export was
 *    moved into /js/*.js, and the funnel's strings travel as an inert
 *    application/json block rather than executable code.
 *  - style-src needs 'unsafe-inline' because the design carries 41 inline
 *    style="" attributes (swatches, gradients, flex ratios) that are part of
 *    the artwork, plus Google Fonts stylesheets.
 *  - frame-src 'self' allows the funnel animation iframe.
 */
export const securityMiddleware = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    // Google Fonts are cross-origin; the default require-corp would block them.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
  compression(),
]

/** Lead form: generous enough for a genuine retype, tight enough to be useless
 *  for scripted submission. */
export const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'rate_limited' },
})
