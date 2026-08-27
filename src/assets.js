import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join, dirname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isProd } from './config.js'

/**
 * Cache busting.
 *
 * Every static URL a template emits goes through asset(), which appends a hash
 * of that file's bytes. A stamped URL therefore names one exact byte sequence
 * and can be cached forever; the moment the file changes, so does the URL, and
 * the browser fetches it because it has never seen that URL before. There is no
 * window in which a visitor holds a stale stylesheet.
 *
 * The matching Cache-Control lives in server.js: stamped requests get a year
 * and `immutable`, bare paths get `no-cache` so they revalidate. Both halves
 * are needed — stamping alone still lets an old deploy's `max-age` run out the
 * clock on a bare path, and revalidating alone costs a round trip per asset.
 */

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// Files never change inside a running container, so prod hashes once and keeps
// the answer. Dev re-stats on every render instead: an edit has to show up on
// reload without restarting the server.
const stamped = new Map()

function resolve(urlPath) {
  const clean = urlPath.split(/[?#]/)[0]
  const file = normalize(join(publicDir, clean))
  // normalize() collapses any ../ before this check, so a path that escaped
  // public/ never reaches the filesystem.
  return file.startsWith(publicDir + sep) ? file : null
}

function hash(file) {
  return createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10)
}

/**
 * @param {string} urlPath absolute public path, e.g. '/css/page.css'
 * @returns {string} the same path with a ?v= stamp, or unchanged if the file is
 *   missing — a broken query would only make the 404 harder to read.
 */
export function assetUrl(urlPath) {
  const file = resolve(urlPath)
  if (!file) return urlPath

  if (!isProd) {
    try {
      return `${urlPath}?v=${Math.trunc(statSync(file).mtimeMs).toString(36)}`
    } catch {
      return urlPath
    }
  }

  if (!stamped.has(urlPath)) {
    let out = urlPath
    try {
      out = `${urlPath}?v=${hash(file)}`
    } catch {
      console.warn(`[assets] missing, served unstamped: ${urlPath}`)
    }
    stamped.set(urlPath, out)
  }
  return stamped.get(urlPath)
}
