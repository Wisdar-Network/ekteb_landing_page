/**
 * Generate the raster images the HTML cannot express as SVG:
 *
 *   public/media/og/og.png                1200x630 social card (og:image)
 *   public/media/og/logo-512.png          square logo for schema.org / PWA
 *   public/media/og/apple-touch-icon.png  180x180 home-screen icon
 *
 * Social crawlers and schema.org both want a raster, and every image here is
 * derived from media/logo.svg so the mark can never drift from the brand.
 *
 * No image library is involved: the SVG paths are flattened to polygons,
 * scanline-filled with anti-aliasing, and written as PNG through zlib. Run it
 * with `npm run build:og` after the logo changes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const OUT = 'public/media/og'

/* ── brand ─────────────────────────────────────────────────────────────── */
const INK = [16, 24, 40] // --ek-ink   #101828
const PURPLE = [96, 77, 140] // --ek-purple #604D8C
const YELLOW = [249, 210, 74] // --ek-yellow #F9D24A
const WHITE = [255, 255, 255]

/* ── SVG path parsing ──────────────────────────────────────────────────── */

/** Split a path's `d` into commands, tolerating exponents and implicit repeats. */
function tokenize(d) {
  const out = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g
  let m
  while ((m = re.exec(d))) out.push(m[1] || Number.parseFloat(m[2]))
  return out
}

/** Flatten one cubic bezier into line segments; 24 is plenty at logo scale. */
function cubic(out, p0, p1, p2, p3, steps = 24) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
}

/** `d` attribute → array of closed subpaths, each an array of [x, y]. */
function pathToPolygons(d) {
  const t = tokenize(d)
  const subs = []
  let cur = null
  let pos = [0, 0]
  let start = [0, 0]
  let cmd = null
  let i = 0

  const open = () => {
    if (cur && cur.length > 2) subs.push(cur)
    cur = []
  }

  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++]
    // An implicit repeat after M continues as L (per the SVG spec).
    else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'

    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? pos[0] : 0
    const oy = rel ? pos[1] : 0

    switch (cmd.toUpperCase()) {
      case 'M':
        open()
        pos = [t[i++] + ox, t[i++] + oy]
        start = pos
        cur.push(pos)
        break
      case 'L':
        pos = [t[i++] + ox, t[i++] + oy]
        cur.push(pos)
        break
      case 'H':
        pos = [t[i++] + ox, pos[1]]
        cur.push(pos)
        break
      case 'V':
        pos = [pos[0], t[i++] + oy]
        cur.push(pos)
        break
      case 'C': {
        const p1 = [t[i++] + ox, t[i++] + oy]
        const p2 = [t[i++] + ox, t[i++] + oy]
        const p3 = [t[i++] + ox, t[i++] + oy]
        cubic(cur, pos, p1, p2, p3)
        pos = p3
        break
      }
      case 'Z':
        if (cur && cur.length) cur.push(start)
        pos = start
        break
      default:
        throw new Error(`unsupported path command: ${cmd}`)
    }
  }
  open()
  return subs
}

/** A circle as a polygon — the logo's dot. */
const circleToPolygon = (cx, cy, r, steps = 64) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * Math.PI * 2
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })

/** Read logo.svg into [{ polygons, fill }] plus its viewBox. */
function loadSvg(file) {
  const src = readFileSync(file, 'utf8')
  const vb = src.match(/viewBox="([\d.\-\s]+)"/)
  const [, , vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 382, 108]

  const shapes = []
  for (const m of src.matchAll(/<path\b([^>]*)>/g)) {
    const attrs = m[1]
    const d = attrs.match(/\sd="([^"]+)"/)
    if (!d) continue
    const fill = attrs.match(/fill="([^"]+)"/)
    shapes.push({ polygons: pathToPolygons(d[1]), fill: fill ? fill[1] : '#000' })
  }
  for (const m of src.matchAll(/<circle\b([^>]*)\/?>/g)) {
    const at = (n) => Number.parseFloat((m[1].match(new RegExp(`${n}="([\\d.\\-]+)"`)) || [])[1] || 0)
    const fill = m[1].match(/fill="([^"]+)"/)
    shapes.push({ polygons: [circleToPolygon(at('cx'), at('cy'), at('r'))], fill: fill ? fill[1] : '#000' })
  }
  return { shapes, vw, vh }
}

/* ── rasterizer ────────────────────────────────────────────────────────── */

/**
 * Scanline fill with the nonzero winding rule.
 *
 * Vertical anti-aliasing comes from sampling each pixel row `SS` times;
 * horizontal from adding fractional coverage at each span end. That is enough
 * for a logo and avoids a full analytic-coverage implementation.
 */
function fill(cov, w, h, polygons, transform, SS = 5) {
  const edges = []
  for (const poly of polygons) {
    const pts = poly.map(transform)
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]
      const [x1, y1] = pts[i + 1]
      if (y0 !== y1) edges.push([x0, y0, x1, y1])
    }
    // close the ring if the path did not
    const a = pts[pts.length - 1]
    const b = pts[0]
    if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]])
  }
  if (!edges.length) return

  const span = (row, xa, xb, amount) => {
    if (xb <= xa) return
    const x0 = Math.max(0, xa)
    const x1 = Math.min(w, xb)
    if (x1 <= x0) return
    let px = Math.floor(x0)
    while (px < x1) {
      const left = Math.max(x0, px)
      const right = Math.min(x1, px + 1)
      cov[row * w + px] += (right - left) * amount
      px++
    }
  }

  const yMin = Math.max(0, Math.floor(Math.min(...edges.map((e) => Math.min(e[1], e[3])))))
  const yMax = Math.min(h, Math.ceil(Math.max(...edges.map((e) => Math.max(e[1], e[3])))))

  for (let row = yMin; row < yMax; row++) {
    for (let s = 0; s < SS; s++) {
      const y = row + (s + 0.5) / SS
      const xs = []
      for (const [x0, y0, x1, y1] of edges) {
        if ((y >= y0 && y < y1) || (y >= y1 && y < y0)) {
          xs.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1])
        }
      }
      if (xs.length < 2) continue
      xs.sort((a, b) => a[0] - b[0])
      let wind = 0
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i][1]
        if (wind !== 0) span(row, xs[i][0], xs[i + 1][0], 1 / SS)
      }
    }
  }
}

/* ── canvas ────────────────────────────────────────────────────────────── */

const canvas = (w, h) => ({ w, h, px: new Float32Array(w * h * 3), a: new Float32Array(w * h) })

function paint(c, fn) {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const rgba = fn(x, y)
      if (!rgba) continue
      const i = (y * c.w + x) * 3
      c.px[i] = rgba[0]
      c.px[i + 1] = rgba[1]
      c.px[i + 2] = rgba[2]
      c.a[y * c.w + x] = rgba[3] === undefined ? 1 : rgba[3]
    }
  }
}

/** Alpha-composite a coverage mask of one flat colour onto the canvas. */
function compose(c, cov, colour) {
  for (let i = 0; i < cov.length; i++) {
    const a = Math.min(1, cov[i])
    if (a <= 0) continue
    const p = i * 3
    c.px[p] = c.px[p] * (1 - a) + colour[0] * a
    c.px[p + 1] = c.px[p + 1] * (1 - a) + colour[1] * a
    c.px[p + 2] = c.px[p + 2] * (1 - a) + colour[2] * a
    c.a[i] = Math.max(c.a[i], a)
  }
}

/* ── PNG ───────────────────────────────────────────────────────────────── */

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function writePng(file, c, { alpha = false } = {}) {
  const ch = alpha ? 4 : 3
  const raw = Buffer.alloc(c.h * (1 + c.w * ch))
  let o = 0
  for (let y = 0; y < c.h; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < c.w; x++) {
      const i = y * c.w + x
      raw[o++] = Math.round(Math.max(0, Math.min(255, c.px[i * 3])))
      raw[o++] = Math.round(Math.max(0, Math.min(255, c.px[i * 3 + 1])))
      raw[o++] = Math.round(Math.max(0, Math.min(255, c.px[i * 3 + 2])))
      if (alpha) raw[o++] = Math.round(Math.max(0, Math.min(255, c.a[i] * 255)))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(c.w, 0)
  ihdr.writeUInt32BE(c.h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = alpha ? 6 : 2 // colour type
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(file, png)
  return png.length
}

/* ── compositions ──────────────────────────────────────────────────────── */

const svg = loadSvg('public/media/logo.svg')

/** Tight bounding box around a set of shapes, in SVG user units. */
function bbox(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of shapes) {
    for (const poly of s.polygons) {
      for (const [x, y] of poly) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * The wordmark and the graph mark carry different fills in logo.svg, which is
 * how they are told apart: the wordmark reads at banner width, the mark alone
 * is what survives at 180px on a home screen.
 */
const MARK = svg.shapes.filter((s) => /604D8C/i.test(s.fill))
const WORDMARK = svg.shapes.filter((s) => !/604D8C/i.test(s.fill))

/** Draw `shapes` into `c`, scaled to fit a width, every shape in one colour. */
function draw(c, shapes, { x, y, w, colour }) {
  const b = bbox(shapes)
  const scale = w / b.w
  for (const shape of shapes) {
    const cov = new Float32Array(c.w * c.h)
    fill(cov, c.w, c.h, shape.polygons, ([px, py]) => [
      x + (px - b.x0) * scale,
      y + (py - b.y0) * scale,
    ])
    compose(c, cov, colour)
  }
  return b.h * scale
}

const drawLogo = (c, o) => draw(c, svg.shapes, o)

function buildOg() {
  const c = canvas(1200, 630)
  // Ink base with a purple glow behind the mark, plus a faint vignette so the
  // card still reads on a white timeline.
  paint(c, (x, y) => {
    const gx = (x - 600) / 620
    const gy = (y - 300) / 430
    const glow = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy))
    const t = Math.pow(glow, 1.7) * 0.85
    const vx = (x - 600) / 600
    const vy = (y - 315) / 315
    const vig = 1 - Math.min(1, (vx * vx + vy * vy) * 0.28)
    return [
      (INK[0] + (PURPLE[0] - INK[0]) * t) * vig,
      (INK[1] + (PURPLE[1] - INK[1]) * t) * vig,
      (INK[2] + (PURPLE[2] - INK[2]) * t) * vig,
    ]
  })

  const logoW = 560
  const h = draw(c, svg.shapes, { x: (1200 - logoW) / 2, y: 258, w: logoW, colour: WHITE })

  // A short accent rule under the mark.
  const barY = Math.round(258 + h + 54)
  for (let y = barY; y < barY + 6; y++) {
    for (let x = 540; x < 660; x++) {
      const i = (y * c.w + x) * 3
      c.px[i] = YELLOW[0]
      c.px[i + 1] = YELLOW[1]
      c.px[i + 2] = YELLOW[2]
    }
  }
  return writePng(`${OUT}/og.png`, c)
}

function buildSquare(file, size, { transparent }) {
  const c = canvas(size, size)
  paint(c, () => (transparent ? [0, 0, 0, 0] : INK))
  const b = bbox(MARK)
  const w = Math.round(size * 0.66)
  const h = (b.h / b.w) * w
  draw(c, MARK, {
    x: (size - w) / 2,
    y: (size - h) / 2,
    w,
    colour: transparent ? PURPLE : WHITE,
  })
  return writePng(file, c, { alpha: transparent })
}

mkdirSync(OUT, { recursive: true })
const sizes = [
  ['og.png            1200x630', buildOg()],
  ['logo-512.png       512x512', buildSquare(`${OUT}/logo-512.png`, 512, { transparent: true })],
  ['apple-touch-icon   180x180', buildSquare(`${OUT}/apple-touch-icon.png`, 180, { transparent: false })],
]
for (const [name, bytes] of sizes) console.log(`  ${name}   ${(bytes / 1024).toFixed(1)} KB`)
