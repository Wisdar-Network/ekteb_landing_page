/* Ekteb /feeds — filter tabs and video previews.
   Same conventions as site.js: ES5, var, IIFE, no inline handlers (the page
   runs under script-src 'self'). The page is complete without this file: the
   tabs are links the server answers, and the cards only lose their previews. */
(function () {
  'use strict'

  var list = document.getElementById('fdp-list')
  if (!list) return
  var cards = [].slice.call(list.querySelectorAll('.fc'))
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* Video previews ----------------------------------------------------- */
  /* Clips are attached only as their card nears the viewport, then play
     muted on hover (or on tap where there is no hover). One plays at a time,
     and any that scrolls out of view stops. */
  var vidCards = cards.filter(function (c) { return c.querySelector('video.fc-vid') })
  var current = null

  function vid(c) { return c.querySelector('video.fc-vid') }

  function attach(c) {
    var v = vid(c)
    if (!v || v.getAttribute('src')) return
    v.preload = 'metadata'
    v.src = v.getAttribute('data-src')
  }

  function stop(c) {
    var v = vid(c)
    if (!v) return
    v.pause()
    c.removeAttribute('data-playing')
    if (current === c) current = null
  }

  function play(c) {
    if (c.getAttribute('data-broken') === '1') return
    if (current && current !== c) stop(current)
    attach(c)
    var v = vid(c)
    var p = v.play()
    if (p && p.catch) p.catch(function () {})
    c.setAttribute('data-playing', '1')
    current = c
  }

  vidCards.forEach(function (c) {
    var v = vid(c)
    var bar = c.querySelector('.fc-prog i')
    // A clip removed from storage leaves the card on its gradient and play
    // badge instead of a black box.
    v.addEventListener('error', function () { c.setAttribute('data-broken', '1'); stop(c) })
    if (bar) {
      v.addEventListener('timeupdate', function () {
        if (v.duration) bar.style.width = (v.currentTime / v.duration) * 100 + '%'
      })
    }
  })

  var hover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  vidCards.forEach(function (c) {
    var media = c.querySelector('.fc-media')
    if (hover) {
      c.addEventListener('mouseenter', function () { play(c) })
      c.addEventListener('mouseleave', function () { stop(c) })
    } else {
      media.addEventListener('click', function () {
        if (c.getAttribute('data-playing') === '1') stop(c); else play(c)
      })
    }
  })

  if ('IntersectionObserver' in window) {
    var near = new IntersectionObserver(function (entries) {
      entries.forEach(function (x) {
        if (x.isIntersecting) { attach(x.target); near.unobserve(x.target) }
      })
    }, { rootMargin: '300px 0px' })
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (x) { if (!x.isIntersecting) stop(x.target) })
    })
    vidCards.forEach(function (c) { near.observe(c); seen.observe(c) })
  } else {
    vidCards.forEach(attach)
  }

  /* Filter tabs -------------------------------------------------------- */
  var tabs = [].slice.call(document.querySelectorAll('.fdp-tabs a[data-filter]'))
  var empty = document.getElementById('fdp-empty')
  var bar = document.querySelector('.fdp-bar')

  function apply(type) {
    var shown = 0
    cards.forEach(function (c) {
      var on = type === 'all' || c.getAttribute('data-type') === type
      c.hidden = !on
      if (on) {
        c.style.setProperty('--i', String(Math.min(shown, 12)))
        // Cards revealed by a filter never crossed the viewport while hidden.
        c.classList.add('is-in')
        shown++
      } else {
        stop(c)
      }
    })
    tabs.forEach(function (a) {
      if (a.getAttribute('data-filter') === type) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
    if (empty) empty.hidden = shown > 0

    if (!reduce) {
      list.removeAttribute('data-anim')
      void list.offsetWidth // restart the entrance animation
      list.setAttribute('data-anim', '1')
    }

    // Filtering from deep in the grid would leave the visitor mid-list of the
    // new set; bring its first row back under the sticky bar.
    var top = list.getBoundingClientRect().top
    var floor = bar ? bar.getBoundingClientRect().bottom + 16 : 0
    if (top < floor) {
      window.scrollTo({ top: window.pageYOffset + top - floor, behavior: reduce ? 'auto' : 'smooth' })
    }
  }

  tabs.forEach(function (a) {
    a.addEventListener('click', function (e) {
      // Leave modified clicks to the browser: a new tab should still work.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return
      e.preventDefault()
      apply(a.getAttribute('data-filter'))
      try { window.history.replaceState(null, '', a.getAttribute('href')) } catch (err) {}
    })
  })
})()
