/* Ekteb landing — page behaviour.
   Lifted from the design export's inline <script> blocks so the page can run
   under a script-src 'self' CSP. Two things changed:
     - the language toggle is gone: locales are separate URLs now, so the
       switcher is plain links and only needs dismiss-on-outside-click;
     - the three email forms actually post to /api/contact instead of faking
       a success message.
   Everything else is the original behaviour, unchanged. */
(function () {
  'use strict'

  /* Header: solid on scroll, full-screen burger menu ------------------- */
  ;(function () {
    var h = document.getElementById('hdr')
    var b = document.getElementById('burger')
    var m = document.getElementById('mnav')
    if (!h) return

    function solid() { h.setAttribute('data-solid', window.scrollY > 24 ? '1' : '0') }
    solid()
    window.addEventListener('scroll', solid, { passive: true })

    if (!b || !m) return
    var sc = document.getElementById('mnav-scrim')
    var xb = document.getElementById('mnav-x')

    /* The menu now covers the viewport, so the page behind it must not
       scroll while it is up. */
    function close() {
      m.setAttribute('data-open', '0')
      b.setAttribute('aria-expanded', 'false')
      if (sc) sc.setAttribute('data-open', '0')
      document.body.removeAttribute('data-mnav')
      // Collapse the language dropdown too, or reopening the menu shows it
      // stuck open from last time.
      m.querySelectorAll('.langsw[open]').forEach(function (sw) { sw.open = false })
    }
    function open() {
      m.setAttribute('data-open', '1')
      b.setAttribute('aria-expanded', 'true')
      if (sc) sc.setAttribute('data-open', '1')
      document.body.setAttribute('data-mnav', '1')
    }

    b.addEventListener('click', function () {
      if (m.getAttribute('data-open') === '1') close(); else open()
    })
    if (sc) sc.addEventListener('click', close)
    if (xb) xb.addEventListener('click', close)
    // Escape unwinds one layer at a time: the language dropdown first (the
    // handler below closes it), the whole menu only once nothing is open
    // inside it.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !m.querySelector('.langsw[open]')) close()
    })
    m.addEventListener('click', function (e) { if (e.target.closest('a')) close() })
    window.addEventListener('resize', function () { if (window.innerWidth > 1023) close() })
  })()

  /* Language menu: <details> handles opening, this only closes it ------ */
  /* Two of them now: the header pill and the row inside the mobile menu. */
  ;(function () {
    var sws = document.querySelectorAll('.langsw')
    if (!sws.length) return
    document.addEventListener('click', function (e) {
      sws.forEach(function (sw) { if (sw.open && !sw.contains(e.target)) sw.open = false })
    })
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return
      sws.forEach(function (sw) {
        if (sw.open) { sw.open = false; sw.querySelector('summary').focus() }
      })
    })
    /* The one inside the mobile menu opens in place near the bottom of a panel
       that scrolls, so the last option can land below the fold. Pull the whole
       disclosure into view instead of leaving the visitor to find it. */
    sws.forEach(function (sw) {
      if (!sw.closest('.mnav')) return
      sw.addEventListener('toggle', function () {
        if (sw.open) sw.scrollIntoView({ block: 'nearest' })
      })
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

  /* Email capture forms ------------------------------------------------ */
  /* Three of them now — the hero, the mobile menu, and #contact — all posting
     to the same endpoint. #contact renders the strings blob once and the
     other two read it, so the copy still lives only in locales/. */
  ;(function () {
    var blob = document.getElementById('contact-i18n')
    if (!blob) return
    var M = {}
    try { M = JSON.parse(blob.textContent) } catch (e) { return }

    ;[['contact-form', 'c-email', 'ctc-msg'],
      ['hero-form', 'h-email', 'hero-msg'],
      ['mnav-form', 'm-email', 'mnav-msg']].forEach(function (ids) {
        wire(ids[0], ids[1], ids[2])
      })

    function wire(formId, inputId, msgId) {
      var form = document.getElementById(formId)
      var input = document.getElementById(inputId)
      var msg = document.getElementById(msgId)
      if (!form || !input || !msg) return

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
    }
  })()

  /* Funnel iframe: drive its timeline from this page's scroll ---------- */
  ;(function () {
    var f = document.getElementById('fs-anim-frame')
    if (!f) return
    var pin = document.getElementById('fs-pin')

    window.addEventListener('message', function (e) {
      var d = e && e.data
      if (d && d.ektebFunnelH > 200) { f.style.height = d.ektebFunnelH + 'px'; fit() }
    })

    /* While the frame is pinned it sticks at a fixed offset, so centre it in
       whatever height the viewport actually has. */
    function fit() {
      var w = f.parentNode
      if (!(pin && window.innerWidth >= 831)) { w.style.top = ''; return }
      var h = parseFloat(f.style.height) || f.offsetHeight
      var vh = window.innerHeight || 1
      w.style.top = Math.max(72, (vh - h) / 2) + 'px'
    }
    window.addEventListener('resize', fit)

    /* the animation is driven by how far this block has travelled through the
       viewport - nothing to sit and wait for, and it rewinds on the way back up */
    var last = -1
    var queued = false

    function send() {
      queued = false
      var vh = window.innerHeight || 1
      var p
      if (pin && window.innerWidth >= 831) {
        /* pinned: the tall track is the timeline, so progress is how far it
           has scrolled past the sticky frame */
        var pr = pin.getBoundingClientRect()
        var span = pr.height - vh
        p = span > 0 ? (-pr.top) / span : 0
      } else {
        var r = f.getBoundingClientRect()
        var start = vh * 0.86
        var sp = vh * 0.42 + r.height
        p = (start - r.top) / sp
      }
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
