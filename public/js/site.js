/* Ekteb landing — page behaviour.
   Lifted from the design export's inline <script> blocks so the page can run
   under a script-src 'self' CSP. Two things changed:
     - the language toggle is gone: locales are separate URLs now, so the
       switcher is plain links and only needs dismiss-on-outside-click;
     - the contact form actually posts to /api/contact instead of faking a
       success message.
   Everything else is the original behaviour, unchanged. */
(function () {
  'use strict'

  /* Header: solid on scroll, burger menu ------------------------------ */
  ;(function () {
    var h = document.getElementById('hdr')
    var b = document.getElementById('burger')
    var m = document.getElementById('mnav')
    if (!h) return

    function solid() { h.setAttribute('data-solid', window.scrollY > 24 ? '1' : '0') }
    solid()
    window.addEventListener('scroll', solid, { passive: true })

    if (!b || !m) return
    function close() { m.setAttribute('data-open', '0'); b.setAttribute('aria-expanded', 'false') }
    b.addEventListener('click', function () {
      var open = m.getAttribute('data-open') === '1'
      m.setAttribute('data-open', open ? '0' : '1')
      b.setAttribute('aria-expanded', open ? 'false' : 'true')
    })
    m.addEventListener('click', function (e) { if (e.target.closest('a')) close() })
    window.addEventListener('resize', function () { if (window.innerWidth > 1023) close() })
  })()

  /* Language menu: <details> handles opening, this only closes it ------ */
  ;(function () {
    var sw = document.getElementById('langsw')
    if (!sw) return
    document.addEventListener('click', function (e) {
      if (sw.open && !sw.contains(e.target)) sw.open = false
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sw.open) { sw.open = false; sw.querySelector('summary').focus() }
    })
  })()

  /* Reveal on scroll --------------------------------------------------- */
  ;(function () {
    var els = document.querySelectorAll('.rv')
    function go() { els.forEach(function (e) { e.classList.add('is-in') }) }
    if (!('IntersectionObserver' in window)) { go(); return }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (x) {
        if (x.isIntersecting) { x.target.classList.add('is-in'); io.unobserve(x.target) }
      })
    }, { threshold: 0.12 })
    els.forEach(function (e) { io.observe(e) })
    setTimeout(go, 600)
  })()

  /* Hero: entrance flag plus scroll-linked --p ------------------------- */
  ;(function () {
    var h = document.getElementById('hero')
    if (!h) return
    var enter = function () { h.setAttribute('data-in', '1') }
    requestAnimationFrame(enter)
    setTimeout(enter, 400)

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      h.style.setProperty('--p', '1')
      return
    }
    var last = -1
    function set() {
      var r = h.getBoundingClientRect()
      var d = Math.max(1, Math.min(300, r.height * 0.3))
      var p = Math.min(1, Math.max(0, -r.top / d))
      p = +p.toFixed(3)
      if (p !== last) { last = p; h.style.setProperty('--p', p) }
    }
    set()
    window.addEventListener('scroll', set, { passive: true, capture: true })
    document.addEventListener('scroll', set, { passive: true, capture: true })
    window.addEventListener('resize', set)
    setInterval(set, 250)
  })()

  /* Contact form ------------------------------------------------------- */
  ;(function () {
    var form = document.getElementById('contact-form')
    if (!form) return
    var input = document.getElementById('c-email')
    var msg = document.getElementById('ctc-msg')
    var blob = document.getElementById('contact-i18n')

    var M = {}
    try { M = JSON.parse(blob.textContent) } catch (e) { return }

    // Stamped on first interaction. A submit faster than the server's floor is
    // treated as automated; real people never clear that bar.
    var firstTouch = 0
    var mark = function () { if (!firstTouch) firstTouch = Date.now() }
    form.addEventListener('focusin', mark, { once: true })
    form.addEventListener('input', mark, { once: true })

    function say(state, text) {
      if (state) msg.setAttribute('data-state', state)
      else msg.removeAttribute('data-state')
      msg.textContent = text || ''
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var value = (input.value || '').trim()

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        input.setAttribute('aria-invalid', 'true')
        say('error', M.bad)
        input.focus()
        return
      }

      input.removeAttribute('aria-invalid')
      form.setAttribute('data-busy', '1')
      say('pending', M.sending)

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: value,
          locale: form.getAttribute('data-locale') || document.documentElement.lang,
          company: form.elements.company ? form.elements.company.value : '',
          elapsed: firstTouch ? Date.now() - firstTouch : 0
        })
      })
        .then(function (res) {
          return res.json().catch(function () { return {} }).then(function (body) {
            return { status: res.status, body: body }
          })
        })
        .then(function (r) {
          if (r.status === 429) { say('error', M.rate); return }
          if (!r.body.ok) { say('error', r.status === 400 ? M.bad : M.fail); return }
          say('ok', M.ok)
          input.value = ''
          input.blur()
        })
        .catch(function () { say('error', M.fail) })
        .then(function () { form.removeAttribute('data-busy') })
    })

    input.addEventListener('input', function () {
      input.removeAttribute('aria-invalid')
      say(null, '')
    })
  })()

  /* Funnel iframe: drive its timeline from this page's scroll ---------- */
  ;(function () {
    var f = document.getElementById('fs-anim-frame')
    if (!f) return

    window.addEventListener('message', function (e) {
      var d = e && e.data
      if (d && d.ektebFunnelH > 200) f.style.height = d.ektebFunnelH + 'px'
    })

    /* the animation is driven by how far this block has travelled through the
       viewport - nothing to sit and wait for, and it rewinds on the way back up */
    var last = -1
    var queued = false

    function send() {
      queued = false
      var r = f.getBoundingClientRect()
      var vh = window.innerHeight || 1
      var start = vh * 0.86
      var span = vh * 0.42 + r.height
      var p = (start - r.top) / span
      p = p < 0 ? 0 : p > 1 ? 1 : p
      if (Math.abs(p - last) < 0.002) return
      last = p
      if (f.contentWindow) { try { f.contentWindow.postMessage({ ektebScroll: p }, '*') } catch (err) {} }
    }
    function tick() { if (queued) return; queued = true; requestAnimationFrame(send) }

    window.addEventListener('scroll', tick, { passive: true })
    window.addEventListener('resize', tick)
    f.addEventListener('load', function () { last = -1; send() })
    setTimeout(send, 300)
    send()
  })()
})()
