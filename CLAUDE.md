# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # watch mode on :3000 (runs build first)
npm start            # production mode (runs build first)
npm run build        # build:css + build:og
npm run build:css    # concatenate public/css/tokens/*.css → tokens.bundle.css
npm run build:og     # rasterise logo.svg → public/media/og/*.png
```

There is no test runner, linter, or formatter configured. Verification is done
by exercising the running server — see **Verifying changes** below.

Locale key parity check (all three files must expose an identical key set):

```bash
node -e "const f=require('fs');const w=(o,p='')=>Object.entries(o).flatMap(([k,v])=>{const K=p?p+'.'+k:k;return Array.isArray(v)?v.flatMap((x,i)=>typeof x==='object'?w(x,K+'['+i+']'):[K+'['+i+']']):(v&&typeof v==='object'?w(v,K):[K])});const a=w(JSON.parse(f.readFileSync('locales/ar.json')));console.log('ar: '+a.length);for(const l of ['en','tr']){const s=new Set(w(JSON.parse(f.readFileSync('locales/'+l+'.json'))));const m=a.filter(k=>!s.has(k));console.log(l+': '+(m.length?'MISSING '+m.join(', '):'complete'))}"
```

## The governing constraint: design fidelity

This site is a rebuild of a static Claude Design export (a single bilingual HTML
file that shipped Arabic and English together and hid one with CSS). **The visual
result must stay pixel-identical to that export.** Every structural choice here —
keeping all 41 inline SVGs verbatim, keeping the 42 inline `style=` attributes,
preserving nested spans that look redundant — exists to protect that.

Before changing anything that touches markup or CSS, assume the odd-looking thing
is load-bearing. One example that already bit: collapsing the nested
subtitle-demo spans in `views/partials/features.njk` moved `dir` from an inline
run onto the flex item and flipped line alignment in the RTL column.

Three deliberate deviations from the export exist, all in
`public/css/page.css`, each with a comment explaining what was wrong and why the
export masked it. Do not "clean them up".

## Architecture

### Copy lives only in `locales/`

`locales/{ar,en,tr}.json` hold every visible string. No template contains user-
facing text. `src/i18n.js` merges each locale over a fallback chain
(`tr → en → ar`) at boot, so a missing Turkish key renders English rather than
an empty heading.

Conventions:

- Keys ending `_html` contain markup (`<b>`, `<br>`) and are rendered with
  `| safe`. Everything else is auto-escaped. `<br>` placement differs per
  language because line lengths differ — that is why it belongs in the locale
  file, not the template.
- `media.*` holds image alt text. `seo.*` holds schema.org copy.
- All three files must stay at identical key counts. Run the parity check above
  after editing any of them.

Adding a fourth language: add `locales/xx.json`, add a row to `LOCALES` and an
entry to `FALLBACKS` in `src/i18n.js`. Templates and CSS need no change — the
stylesheet uses logical properties throughout and direction comes from
`<html dir>`.

### Request flow

`src/server.js` boots i18n and the mailer, then mounts `/api` before `/`.

- `GET /` → 302 to a negotiated locale (cookie → `Accept-Language` → `en`),
  with `Vary: Accept-Language, Cookie`. The last step is `FALLBACK_LOCALE`, not
  `DEFAULT_LOCALE`: an unmatched browser language gets English, while Arabic
  stays the site default for the sitemap priority, the 404 page, and the
  per-key fallback chain. `x-default` is derived from `FALLBACK_LOCALE` in both
  the page head and the sitemap — it declares exactly this redirect, so it must
  never be hardcoded back to a locale.
- `GET /:locale` → renders `index.njk`. Unknown locale falls through to 404.
- `GET /funnel/:locale` → the scroll animation as a standalone document.
- `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt` are all generated
  from `src/seo.js`, never served as static files.

The language cookie is written **only when it changes** — a `Set-Cookie` on
every page view makes most CDNs refuse to cache the response.

### The funnel iframe

`/funnel/:locale` stays a separate document because its animation engine reads a
private scroll timeline. The host page drives it over `postMessage`:

- host → funnel: `{ ektebScroll: <0..1> }` (`public/js/site.js`)
- funnel → host: `{ ektebFunnelH: <px> }` so the iframe can size itself

There is no language message: each locale is rendered server-side once.

Where that progress comes from depends on the width. From 831px up the frame is
sticky inside `.fs-pin`, a 300vh track, and progress is how far that track has
travelled past it — so the animation is scrubbed while the picture holds still.
Below 831px `.fs-pin` collapses to its natural height and progress is the
frame's own travel through the viewport. `fit()` centres the sticky frame in
whatever height the viewport has; it must run again whenever the funnel reports
a new height.

At <=760px the funnel stops taking host progress altogether: each of the three
cards runs its own looping clock (play 2400ms, hold 1500ms), started and stopped
by an IntersectionObserver. Stacked cards are independent of each other and of
the scroll position, so do not wire them back to `ektebScroll`.

### CSP shapes the JavaScript

`script-src 'self'` — no inline scripts anywhere. Every script the export had
inline now lives in `public/js/`. Strings that JS needs are passed through inert
`<script type="application/json">` blocks (`#funnel-i18n`, `#contact-i18n`)
which the external scripts `JSON.parse`. Keep that pattern; do not add inline
handlers or `eval` (the browser will block it, including in dev tooling).

`style-src` needs `'unsafe-inline'` because the design carries 42 inline
`style=` attributes that are part of the artwork.

`public/js/*.js` is ES5-style, `var`-based, IIFE-wrapped — it was migrated from
the export, not rewritten. Match that style when editing those two files. Server
code under `src/` is modern ESM; match *that* style there.

### No database — the email is the record

Three forms post to the one endpoint — the hero, the mobile menu, and
`#contact` — and `public/js/site.js` wires all of them from the single
`#contact-i18n` strings blob that `#contact` renders. A new form needs an id
triple in that list, a honeypot, and `data-locale`; it does not need its own
copy.

None of them has persistence. `POST /api/contact` validates with zod,
drops honeypot/too-fast submissions silently with a `200`, dedupes repeat
addresses for 24h in memory (`src/services/dedupe.js`), then **awaits** the
Mailgun send.

The send is deliberately blocking: with nothing else storing the lead, a
swallowed failure loses a customer who believes their message arrived. So
Mailgun failure returns `502` and logs the address; an unconfigured mailer
returns `503` in production but accepts and logs in development. Do not restore
fire-and-forget here without restoring storage first.

Mailgun is reached over its HTTP API with the built-in `fetch` (no SDK). It
retries exactly once, and only on network errors, `5xx`, or `429` — a `401`
means wrong key/domain/region and retrying just doubles the visitor's wait.

`MAILGUN_REGION` must match where the domain was created; an EU domain queried
against the US endpoint answers `401` as if the key were wrong.

### SEO is derived, never hand-written

`src/seo.js` builds the JSON-LD `@graph` (Organization, WebSite,
SoftwareApplication, WebPage+FAQPage), `llms.txt`, `llms-full.txt`, and
`robots.txt` from the locale files. Editing copy updates all of them.

`jsonLdScript()` escapes `<`, `>`, U+2028/9 — JSON-LD is not executed so CSP
does not cover it, but the HTML parser still ends the block at a literal
`</script>`.

`lastmod`/`dateModified` come from the newest source-file mtime, not from
`Date.now()`. A sitemap that stamps today's date on every crawl teaches crawlers
the field is meaningless.

`robots.txt` names 18 AI agents individually, split into answer engines and
training scrapers with a comment on why each is allowed. The allow/deny decision
lives in one place: the `AI_AGENTS` array in `src/seo.js`.

### Nothing survives a deploy in someone's cache

Every static URL a template emits goes through the `asset()` Nunjucks global
(`src/assets.js`), which appends a hash of that file's bytes:

```njk
<link rel="stylesheet" href="{{ asset('/css/page.css') }}">
<img src="{{ asset('/media/opt/hero-app.webp') }}" alt="…">
```

**A new static file must be referenced through `asset()`.** A bare path still
works, but it is the one case that can serve a visitor last deploy's copy.

The stamp and the `Cache-Control` in `src/server.js` are two halves of one
mechanism:

- a stamped URL names one exact byte sequence, so it gets
  `max-age=31536000, immutable` — never revalidated, and a changed file simply
  arrives under a URL the browser has never seen;
- a bare path might be one an earlier deploy handed out, so it gets `no-cache`:
  stored, but revalidated every time (a 304, not a download);
- HTML — `/:locale` and `/funnel/:locale` — is `max-age=0, must-revalidate`, so
  the document is always rechecked and the new asset URLs are picked up on the
  next load.

`og:image` is stamped too (`src/routes/pages.js`). Social platforms key their
image cache on the URL and ignore `Cache-Control`, so a changed logo only
propagates because the URL changed with it.

Prod hashes each file once at boot — nothing writes to `public/` in a running
container. Dev stamps with mtime instead and re-stats on every render, so an
edit shows up on reload; dev also sends `no-store`.

### Generated files

`public/css/tokens.bundle.css` and `public/media/og/*.png` are build outputs and
are gitignored. `scripts/build-og.mjs` is a self-contained SVG rasteriser (path
flattening → scanline fill → zlib PNG) with no image dependency; it derives
every raster from `public/media/logo.svg` so the brand cannot drift.

## Verifying changes

Any change touching markup or CSS needs a geometry check, not an eyeball. The
pattern that has been used here: load `/ar`, `/en`, `/tr` into hidden same-origin
iframes at 1280px and 400px, record `getBoundingClientRect()` for ~25 structural
selectors before and after the change, and diff. Zero drift is the pass
condition.

Also check: zero console errors on all three locales plus `/funnel/*`, and no
horizontal overflow (`scrollWidth > clientWidth`) — Latin copy is roughly 1.6×
longer than the Arabic the design was drawn in, so overflow bugs appear in
`/en` and `/tr` long before `/ar`.

## Deployment

`.github/workflows/prod-deploy.yml` runs two ways: manually
(`workflow_dispatch`), and on a push to `main` whose **tip** commit message
contains `deploy it` (case-insensitive, anywhere in the message). Every push to
`main` starts the workflow; the job-level `if` decides whether it deploys, so a
push without the marker shows up as a skipped run. The marker is read from
`github.event.head_commit.message` — GitHub expressions cannot substring-search
a list of commits, so only the last commit of the push counts. A `concurrency`
group serialises deploys: the job stops the container and deletes the image
before loading the new one, and `cancel-in-progress` is `false` because killing
a deploy mid-flight can leave the host stopped with no image to start.

The job builds the Docker image in CI, `scp`s a tar to an Azure host, and runs it on the
`node01` Docker network with `--rm` and no published ports — a reverse proxy on
that network fronts it. `.env` is written from the `PROD_ENV` Actions variable, `scp`d to the host
beside the tar, and handed to the container with `docker run --env-file` —
`.dockerignore` keeps it out of the image, so nothing configures the app unless
that flag is present. A container started without it still boots (the Dockerfile
sets `NODE_ENV`, `HOST`, `PORT`) and reports `mail: not configured`, which is
what a missing `--env-file` looks like in the log. Docker's env-file parser is
not `dotenv`: values are literal, so `PROD_ENV` must not quote them.

`app.set('trust proxy', 1)` is unconditional in `src/server.js` — there is no
env flag. It always runs behind a proxy, and without it express-rate-limit
keys every visitor to the proxy's single IP, so the whole internet shares one
5-per-hour budget on the contact form. Raise to `2` for a second proxy hop.

The server binds `config.host` (`HOST`, default `0.0.0.0`); the Dockerfile sets
it explicitly because `127.0.0.1` inside a container is unreachable from the
Docker network.

`SITE_URL` must be the real origin with no trailing slash — canonical,
hreflang, sitemap, and the OG image URL are all built from it.

The container is stateless; no volume is needed.

## Environment notes (Windows)

- Bash heredocs in this environment have collapsed `\\` to `\` and truncated
  large payloads. Both produced silently corrupted files. For anything with
  backslashes or more than a few hundred lines, use the Write tool.
- Nunjucks is not Jinja2: filters such as `attr` do not exist.
- Killing a background `npm start` may leave the child `node src/server.js`
  alive. Windows lets a second process bind the same port, and the stale one
  keeps serving — check `netstat -ano | grep :3000` when behaviour looks cached.
