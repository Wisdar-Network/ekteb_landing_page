# Ekteb — landing page

The Ekteb landing page as a single Node project: back end and front end together,
in three languages (Arabic, English, Turkish).

Built on Express 5 + Nunjucks, derived from a Claude Design export
(`Ekteb Design System`) with the design preserved exactly.

---

## Running it

```bash
npm install
cp .env.example .env
npm run dev
```

Then open <http://localhost:3000> — you will be redirected to `/ar`, `/en`, or
`/tr` depending on your browser's language.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with reload on change |
| `npm start` | Production server |
| `npm run build` | Build generated assets (runs automatically before `dev`/`start`) |
| `npm run build:css` | Concatenate the design tokens into one stylesheet |
| `npm run build:og` | Render the social card and icons from `logo.svg` |

---

## Layout

```
src/
  server.js            Express, Nunjucks, and middleware setup
  config.js            environment variables, read and validated
  i18n.js              locale loading, negotiation, and the fallback chain
  routes/pages.js      /  ·  /:locale  ·  /funnel/:locale  ·  sitemap  ·  robots  ·  llms.txt
  routes/api.js        POST /api/contact
  seo.js               JSON-LD, llms.txt, robots.txt — all derived from the locale files
  services/mailer.js   lead delivery over the Mailgun HTTP API
  services/dedupe.js   suppresses a repeat address for 24 hours (in memory)
  middleware/          security (helmet + CSP + rate limit) and locale detection

locales/  ar.json · en.json · tr.json     ← every string on the site
views/    layout.njk · index.njk · funnel.njk · partials/
public/   css/ · js/ · media/
scripts/  build-css.mjs · build-og.mjs
```

### Editing copy

Every visible string lives in `locales/*.json` — no template contains
user-facing text. Keys ending in `_html` are rendered as HTML (they contain
`<b>` or `<br>`); everything else is escaped automatically.

All three files carry an identical key set. To check after an edit:

```bash
node -e "const f=require('fs');const w=(o,p='')=>Object.entries(o).flatMap(([k,v])=>{const K=p?p+'.'+k:k;return Array.isArray(v)?v.flatMap((x,i)=>typeof x==='object'?w(x,K+'['+i+']'):[K+'['+i+']']):(v&&typeof v==='object'?w(v,K):[K])});const a=new Set(w(JSON.parse(f.readFileSync('locales/ar.json'))));for(const l of ['en','tr']){const s=new Set(w(JSON.parse(f.readFileSync('locales/'+l+'.json'))));const m=[...a].filter(k=>!s.has(k));console.log(l+': '+(m.length?'missing '+m.join(', '):'complete'))}"
```

A key missing from `tr.json` falls back to `en.json`, then `ar.json` — the page
never renders a blank.

### Which language a visitor gets

`GET /` is a 302, never a page. It resolves in this order:

1. **The `ekteb-lang` cookie**, if the visitor has already picked a language
   from the switcher — an explicit choice outranks anything the browser says.
2. **`Accept-Language`**, matched on the primary subtag, so `ar-SA`, `en-GB`
   and `tr-TR` all land on a supported locale. Quality values are honoured, and
   `q=0` is treated as a refusal rather than a weak preference.
3. **English** — `FALLBACK_LOCALE` in [src/i18n.js](src/i18n.js). A browser set
   to French, German, or Chinese gets `/en`, and so does a request with no
   `Accept-Language` header at all.

That last step is deliberately *not* `DEFAULT_LOCALE`. Arabic is the primary
market and the master copy, but someone whose browser is set to a language this
site does not publish reads English far more often than Arabic. The two
constants are separate on purpose: `DEFAULT_LOCALE` still drives the sitemap
priority, the 404 page, and the per-key fallback chain.

If you change `FALLBACK_LOCALE`, the `x-default` hreflang follows it
automatically — in the page head and in `sitemap.xml`. That tag means "the page
served to a visitor who matches nothing", so it has to name whatever the
redirect actually does; a hardcoded value would tell crawlers one thing while
the server did another.

The response carries `Vary: Accept-Language, Cookie`, and the cookie is written
only when it changes — a `Set-Cookie` on every view makes most CDNs refuse to
cache the page.

### A deploy is never stuck behind a browser cache

Templates never write a static path directly. They go through the `asset()`
helper, which stamps the URL with a hash of the file's bytes:

```njk
<link rel="stylesheet" href="{{ asset('/css/page.css') }}">
```

So `/css/page.css?v=36eb94f128` becomes `?v=b02ed54613` the moment the file
changes, and the browser fetches it because it has never seen that URL — while
files that did *not* change keep their URL and stay cached. Stamped URLs are
served `max-age=31536000, immutable`; a bare path gets `no-cache` so it
revalidates; the HTML itself is `max-age=0, must-revalidate` so the new URLs are
always picked up. Nothing needs a hard refresh after a deploy.

If you add a static file, reference it through `asset()`.

### Adding a fourth language

1. Add `locales/xx.json`
2. Add the row to `LOCALES` in [src/i18n.js](src/i18n.js) with `dir`,
   `ogLocale`, and `label`
3. Add `xx` to `FALLBACKS` in the same file

Templates and CSS need no change: every rule uses logical properties, and
direction comes from `dir` on `<html>`.

---

## Contact form

There is no database — **the email itself is the record.**
`POST /api/contact` accepts `{ email, locale, company, elapsed }` and then:

1. Validates the address (zod)
2. Silently ignores the request if the hidden `company` field is filled
   (honeypot) or if it arrived in under 1.5 seconds
3. Ignores a repeat of the same address within 24 hours — in-process memory,
   forgotten on restart
4. Sends through the Mailgun HTTP API **and waits for the result**

**Why wait?** When a database backed this, delivery could be fire-and-forget: a
mail failure was harmless because the lead was already on disk. There is no
other copy now, and swallowing the failure would lose a customer who believes
their message arrived. So failure reaches the visitor:

| Case | Response | What the visitor sees |
|---|---|---|
| Sent | `201` | "Got it, we'll be in touch…" |
| Invalid address | `400` | "Enter a valid email address" |
| Repeat within 24h | `200` | "Got it…" — without mailing the team twice |
| Honeypot, or faster than 1.5s | `200` | Apparent success, so the bot learns nothing |
| Mailgun failed | `502` | "Could not send. Please try again" |
| More than 5 attempts/hour per IP | `429` | "We already have your request…" |

On failure two log lines carry the **full address** — that is the only backup
if Mailgun is down, so keep server logs.

The server retries **once**, and only for what a retry can fix: a network error,
a `5xx`, or a `429`. A `401` means a wrong key, domain, or region — repeating it
only doubles the visitor's wait.

### Mailgun setup

In `.env`:

```
MAILGUN_API_KEY=...        # Dashboard → Send → API keys
MAILGUN_DOMAIN=ekteb.ai    # the domain name only — not the API URL
MAILGUN_REGION=eu          # ekteb.ai was created in the EU region
MAIL_FROM=Ekteb <no-reply@ekteb.ai>   # must be on the same domain
MAIL_TO=leads@ekteb.com
```

**Two common mistakes, both of which report misleadingly:**

- Putting the API URL (`https://api.eu.mailgun.net`) in `MAILGUN_DOMAIN`. That
  field wants the bare domain; the URL is selected by `MAILGUN_REGION`.
- A `MAIL_FROM` on a domain other than `MAILGUN_DOMAIN` — Mailgun cannot sign it
  with DKIM.

And `MAILGUN_REGION` matters on its own: a domain created in the EU dashboard is
**invisible** to the US endpoint, so Mailgun answers `401` as though the key
were wrong.

To check the credentials before starting the site (export the variables first,
and switch the host to `api.eu.mailgun.net` if the region is `eu`):

```bash
curl -s --user "api:$MAILGUN_API_KEY" "https://api.mailgun.net/v3/$MAILGUN_DOMAIN/messages" -F from="$MAIL_FROM" -F to="$MAIL_TO" -F subject="Mailgun test" -F text="works"
```

**With Mailgun unconfigured:** development accepts the submission and prints the
lead to the console, so the form stays testable. Production (`NODE_ENV=production`)
answers `503` — claiming success without sending is exactly the fake-form
behaviour this replaced.

---

## SEO and AI crawling

Everything a machine reads is derived from `locales/*.json` through
[src/seo.js](src/seo.js), so a copy edit cannot leave the structured data
describing an older page.

### For traditional search engines

| What | Where |
|---|---|
| `canonical` + `hreflang` for all three languages + `x-default` | every page head |
| `robots: index, max-image-preview:large` | only on pages with a canonical — the animation stays `noindex` |
| `sitemap.xml` with an `xhtml:link` per language | `/sitemap.xml` |
| 1200×630 social card + `twitter:card` | `/media/og/og.png` |
| Descriptive `alt` on every product image, in three languages | `locales/*.json` → `media.*` |
| `width`/`height` on all 16 images | prevents layout shift (CLS) |
| `preload` + `fetchpriority` on the hero image | faster LCP |

**`lastmod` comes from the newest source file, not from "today".** A sitemap
that stamps today's date on every crawl teaches the crawler the field carries no
information, and it stops trusting it.

### Structured data (JSON-LD)

One `@graph` per page, four nodes cross-referenced by `@id`:

```
Organization         the company (512px logo, sameAs from SOCIAL_PROFILES)
WebSite              publisher = Organization
SoftwareApplication  the product itself, featureList from the six features
WebPage + FAQPage    the page, with its seven questions as mainEntity
```

Linking by `@id` is what lets a crawler see **one company behind three pages**
rather than three separate entities.

> Worth stating plainly: Google narrowed FAQ rich results in 2023 to government
> and health sites, so do not expect the questions to appear in search results.
> Their real value today is to answer engines, which read the Q&A directly.

### For AI crawlers

- **`/llms.txt`** — a markdown brief in the [llmstxt.org](https://llmstxt.org)
  format: what Ekteb is, links to the three languages, the features, the steps,
  and all seven questions with their answers.
- **`/llms-full.txt`** — the complete text of all three language pages.
- **`/robots.txt`** — names 18 AI agents explicitly: `OAI-SearchBot`, `ClaudeBot`,
  `PerplexityBot`, `Google-Extended`, and others; `/api/` is disallowed for all.

Why this matters here specifically: the page is built largely from inline SVG
and animation, so an answer engine reading text alone sees very little.
`llms.txt` hands it the full description as plain prose.

**Allowing them is a decision, not a default.** The agents are split in
[src/seo.js](src/seo.js) into answer engines (which fetch a page in order to
cite it, so blocking them removes you from those answers) and training scrapers
(`CCBot`). Both are allowed today because this is public marketing copy — flip
`Allow` to `Disallow` in the `AI_AGENTS` list to change that.

### What is left to you

The technical side is complete, but it is **the baseline, not an advantage**.
What actually brings traffic:

1. **Register the site** in Google Search Console and Bing Webmaster Tools and
   submit `sitemap.xml`. Without that, the first crawl can be two weeks away.
2. **Set `SOCIAL_PROFILES`** in `.env` — LinkedIn, X, and so on. Those links are
   what tie the `Organization` to an entity the engines already know.
3. **Content aimed at real questions.** A single landing page does not compete
   for broad terms; articles, comparison pages, and docs are what get indexed
   and cited.
4. **Presence where AI models read**: Product Hunt, G2, Capterra, Wikidata.
   Answer engines cite those sources more often than they cite your own site.
5. **A designed social card.** The current one is generated from the logo — it
   never breaks and never drifts from the brand, but a designed card carrying
   the headline and a product shot converts better.

---

## Deployment

```bash
docker build -t ekteb-landing .
docker run -p 3000:3000 --env-file .env ekteb-landing
```

The container is **stateless**: no database and no disk writes, so it needs no
volume and several instances can run behind a load balancer without
coordination. It binds `0.0.0.0:3000` — `127.0.0.1` would be unreachable from
the Docker network.

The app trusts one reverse-proxy hop unconditionally ([src/server.js](src/server.js)),
so the contact form's rate limit counts real visitors rather than the proxy.
Raise it to `2` if you put a second proxy (Cloudflare, say) in front.

[.github/workflows/prod-deploy.yml](.github/workflows/prod-deploy.yml) builds the
image in CI, copies it to the Azure host over SSH, and runs it on the `node01`
Docker network behind a reverse proxy.

It fires two ways:

- **Manually** — Actions → *Deploy to Server* → *Run workflow*.
- **On a push to `main`** whose tip commit message contains `deploy it`:

  ```bash
  git commit -m "fix hreflang — deploy it"
  ```

  The match is case-insensitive and the phrase can sit anywhere in the message.
  Every push to `main` starts the workflow, but the job's `if` gate decides
  whether it runs, so a push without the marker just logs a skipped run.

  Only the **tip** commit of the push is read (`github.event.head_commit.message`)
  — GitHub expressions cannot substring-search a list of commits. Push three
  commits with the marker on the first and nothing deploys; put it on the last
  one, or amend before pushing.

Deploys are serialised by a `concurrency` group. A second run waits for the
first rather than cancelling it — the job stops the container and removes the
old image before loading the new one, so interrupting it can leave the host with
nothing running.

**The image carries no configuration.** [.dockerignore](.dockerignore) keeps
`.env` out of it, so `dotenv` finds nothing inside the container and every
setting has to arrive at run time. CI writes the `PROD_ENV` Actions variable to
`.env`, `scp`s it to the host next to the image tar, and passes it with
`docker run --env-file`. Skip that flag and the container boots with only the
`NODE_ENV`/`HOST`/`PORT` defaults baked into the Dockerfile — the banner reads
`mail: not configured` and every lead gets a `503`. The deploy job greps the
boot log for `mail: mailgun` and fails if it is missing.

`--env-file` is not a shell and not `dotenv`: it splits on the first `=` and
takes the rest of the line **literally**. Do not quote values in `PROD_ENV` —
`MAIL_FROM=Ekteb <no-reply@ekteb.ai>` is right, `MAIL_FROM="Ekteb <...>"` ships
the quotes as part of the sender name.

Set in `.env` before deploying:

- `SITE_URL` — the real origin, no trailing slash (canonical, hreflang, sitemap,
  and the OG image URL are all built from it)
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`, `MAIL_TO` — without
  them the form answers `503`
- `NODE_ENV=production`

**On horizontal scaling:** deduplication and rate limiting live in process
memory, so with several instances the effective limit becomes 5 attempts per
instance. That is fine for a landing page; if you need a shared limit, the right
place is a Redis store for `express-rate-limit`.

---

## Architecture notes

**Why a separate path per language?** The original export shipped both languages
in the same page and hid one with CSS. With three languages that triples the
payload and makes Google index duplicate text. Each language is now its own page
with `canonical` and `hreflang`, and the page dropped from 55KB to 37-43KB
depending on language (7-8KB over the wire after Brotli).

**The animation (`/funnel/:locale`)** stays a separate document inside an
`iframe` because its engine reads a private scroll timeline. The host page
drives it with `postMessage({ektebScroll})`, and it reports its own height back
with `postMessage({ektebFunnelH})`. There are no language messages left — each
locale is rendered once on the server.

**CSP:** `script-src 'self'` — every script the export had inline now lives in
`public/js/`, and the animation's and form's strings arrive as
`<script type="application/json">` blocks (data, not executable code).
`style-src` needs `'unsafe-inline'` because the design carries 41 inline
`style=` attributes that are part of the artwork itself.
