/* Ekteb funnel animation — scroll-driven engine.
   Extracted from the design export's standalone document so the page can
   run under a script-src 'self' CSP and be rendered once per locale. */
/* Height reported to a host page is the funnel's own height — never the local
   scroll spacer, which exists only when the file drives itself. */
(function(){function post(){try{var el=document.querySelector('.stage__inner');var h=el?el.getBoundingClientRect().height+40:document.documentElement.scrollHeight;parent.postMessage({ektebFunnelH:Math.ceil(h)},'*')}catch(e){}}
window.addEventListener('load',post);window.addEventListener('resize',post);setInterval(post,600)}());
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     SCROLL-DRIVEN VARIANT
     No timeline. The parent page posts one number — how far the section
     has travelled through the viewport (0 → 1) — and this file renders
     the matching frame. Nobody waits: scroll fast and you land on the
     finished state; scroll back and it rewinds.
     ══════════════════════════════════════════════════════════════════ */
  /* the wall is tall enough that even at its smallest scale it still overflows
     the panel — so it never stops being a window onto something larger */
  var TILES = 350, DOC_RATE = 0.34, SURVIVE = 3;

  /* where each beat lives on the 0 → 1 scroll range — the third card lands and is
     allowed to settle before it starts filling in */
  var K = { fill:[0,.20], filter:[.20,.34], s2:.36, rows:[.38,.54], link1:.52,
            pick:.58, s3:.65, link2:.73, steps:[.75,.93], chans:[.93,1] };
  /* stacked (phone) layout: every card runs its own beat as it enters the screen */
  var M = { fill:[0,.55], filter:[.48,.95], travel:[0,.6],
            rows:[.05,.65], pick:.78, steps:[.08,.8], chans:[.82,1] };

    /* Strings arrive from the server as an inert application/json block: the
     page is rendered per locale, so there is nothing to switch at runtime. */
  var STRINGS = (function () {
    try { return JSON.parse(document.getElementById('funnel-i18n').textContent); }
    catch (e) { return { watch: '', drop: '', ranked: '', pick: '', s: [] }; }
  })();
  var T = function () { return STRINGS; };

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced  = function () { return reduceMQ.matches; };
  /* The export hard-coded en-US grouping, which is right for Arabic (the
     design uses Western digits) and English. Turkish groups with a dot, and
     the Turkish copy already writes 20.000, so the counter must agree. */
  var NUM_LOCALE = document.documentElement.lang === 'tr' ? 'tr-TR' : 'en-US';
  var fmt = function (n) { return n.toLocaleString(NUM_LOCALE); };
  var cl  = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var seg = function (p, a, b) { return cl((p - a) / (b - a)); };
  var out3 = function (t) { return 1 - Math.pow(1 - t, 3); };

  var fn = $('#fn'), stream = $('#fnStream'), mosaic = $('#fnMosaic'), num = $('#fnNum');
  var status = $('#fnStatus'), statusTx = $('#fnStatusText');
  var rows = $$('#fnSorted .fn__row'), pick = $('#fnSorted .fn__row[data-pick="1"]');
  var link1 = $('#fnLink1'), link2 = $('#fnLink2');
  var brand = $('#fnBrand'), topBar = $('#fnTop'), sub = $('#fnSub');
  var steps = $$('#fnSteps .fn__step'), chans = $$('#fnChans .chip');
  var tierA = $('.fn__tier--a'), tierB = $('.fn__tier--b'), tierC = $('.fn__tier--c');
  var stackMQ = window.matchMedia('(max-width:760px)');
  var stacked = function () { return stackMQ.matches; };
  var panelA = $('.fn__tier--a .fn__panel'), panelB = $('.fn__tier--b .fn__panel'), panelC = $('.fn__tier--c .fn__panel');

  /* ── the monitoring wall ─────────────────────────────────────────── */
  var srcs = $$('#fnSorted img').concat($$('#pool img')).map(function (i) { return i.src; });
  srcs = srcs.filter(function (s, i) { return s && srcs.indexOf(s) === i; });
  (function build() {
    var frag = document.createDocumentFragment(), v = 0;
    for (var i = 0; i < TILES; i++) {
      var cell = document.createElement('span');
      cell.className = 'fn__tile';
      if ((((i * 37 + 11) % 100) / 100) < DOC_RATE) {
        cell.className += ' fn__tile--doc';
        var doc = document.createElement('span');
        doc.className = 'fn__doc'; doc.innerHTML = '<i></i><i></i><i></i>';
        cell.appendChild(doc);
      } else if (srcs.length) {
        var img = document.createElement('img');
        img.src = srcs[v++ % srcs.length]; img.alt = ''; img.decoding = 'async';
        img.style.objectPosition = (36 + ((i * 17) % 28)) + '% ' + (36 + ((i * 23) % 28)) + '%';
        cell.appendChild(img);
      }
      frag.appendChild(cell);
    }
    mosaic.appendChild(frag);
  }());
  var tiles = $$('.fn__tile', mosaic);
  /* filtering reads across the whole wall, not as a wave */
  var doomed = tiles.map(function (t, i) { return i; }).filter(function (i) { return i % SURVIVE !== 0; })
                    .sort(function (a, b) { return ((a * 61) % TILES) - ((b * 61) % TILES); });

  /* ── calibration: the wall is laid out once, then only scaled ───── */
  var MOS_W = {}, TC_W = 0, SCALE = { 1:1, 2:1, 3:1 }, WALL_COLS = 14, VIS = { 2:10, 3:7 };
  function calibrate() {
    var had2 = fn.classList.contains('is-s2'), had3 = fn.classList.contains('is-s3');
    var prev = fn.style.transition; fn.style.transition = 'none';
    mosaic.style.removeProperty('--mos-w'); tierC.style.removeProperty('--tc-w');
    fn.classList.remove('is-s2','is-s3'); MOS_W[1] = stream.clientWidth;
    fn.classList.add('is-s2');            MOS_W[2] = stream.clientWidth;
    fn.classList.add('is-s3');            MOS_W[3] = stream.clientWidth;
    TC_W = panelC.clientWidth - 22;
    fn.classList.remove('is-s2','is-s3');
    if (had2) fn.classList.add('is-s2');
    if (had3) fn.classList.add('is-s3');
    fn.offsetHeight; fn.style.transition = prev;
    if (TC_W > 0) tierC.style.setProperty('--tc-w', TC_W + 'px');
    mosaic.style.setProperty('--mos-w', MOS_W[1] + 'px');
    var colW = MOS_W[1] / WALL_COLS, wide = window.innerWidth > 760 && colW > 0;
    SCALE[1] = 1;
    SCALE[2] = wide ? MOS_W[2] / (colW * VIS[2]) : 1;
    SCALE[3] = wide ? MOS_W[3] / (colW * VIS[3]) : 1;
  }

  /* ── connectors ──────────────────────────────────────────────────── */
  function drawLink(link, srcYs, toY) {
    var rtl = document.documentElement.dir !== 'ltr';
    var lr = link.getBoundingClientRect(), svg = link.querySelector('svg'), paths = $$('path', svg);
    if (lr.width < 6 || lr.height < 6) return;
    var w = lr.width, h = lr.height, k = w * 0.52;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    paths.forEach(function (p, i) {
      if (i >= srcYs.length) { p.style.display = 'none'; return; }
      p.style.display = '';
      var y = srcYs[i], x0 = rtl ? w : 0, x1 = rtl ? 0 : w, c0 = rtl ? w - k : k, c1 = rtl ? k : w - k;
      p.setAttribute('d','M ' + x0.toFixed(1) + ' ' + y.toFixed(1) + ' C ' + c0.toFixed(1) + ' ' + y.toFixed(1) +
                         ', ' + c1.toFixed(1) + ' ' + toY.toFixed(1) + ', ' + x1.toFixed(1) + ' ' + toY.toFixed(1));
      try { p.style.setProperty('--len', Math.ceil(p.getTotalLength())); }
      catch (e) { p.style.setProperty('--len', Math.round(w + Math.abs(y - toY))); }
    });
  }
  function drawLinks() {
    var l1 = link1.getBoundingClientRect(), a = panelA.getBoundingClientRect(), b = panelB.getBoundingClientRect();
    drawLink(link1, [0.22,0.5,0.78].map(function (f) { return a.top + a.height * f - l1.top; }),
             b.top + b.height * 0.5 - l1.top);
    var l2 = link2.getBoundingClientRect(), c = panelC.getBoundingClientRect(), pr = pick.getBoundingClientRect();
    drawLink(link2, [pr.height ? pr.top + pr.height * 0.5 - l2.top : b.top + b.height * 0.16 - l2.top],
             c.top + Math.min(c.height * 0.5, 96) - l2.top);
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER — one pure function of scroll progress. Idempotent, so it
     rewinds as cleanly as it plays.
     ══════════════════════════════════════════════════════════════════ */
  var linksDrawn = { 1:false, 2:false }, lastStage = 1;

  /* one painter per card, so the same beats can be driven by one global progress
     (desktop columns) or by three independent ones (stacked phone layout) */
  function paintWall(fillP, filtP, zoom, travelP) {
    var n = Math.round(tiles.length * fillP);
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('is-in', i < n);
    num.textContent = fmt(Math.round(20000 * fillP));
    var dn = Math.round(doomed.length * filtP);
    for (var j = 0; j < doomed.length; j++) tiles[doomed[j]].classList.toggle('is-out', j < dn);
    /* the travel is measured on the SCALED wall — otherwise shrinking it would
       scroll its content clean past the top of the panel */
    var maxY = mosaic.offsetHeight * zoom - stream.clientHeight;
    var y = maxY > 0 ? -maxY * travelP : 0;
    mosaic.style.transform = 'translateY(' + y.toFixed(1) + 'px) scale(' + zoom.toFixed(4) + ')';
  }
  function paintRows(rowsP, picked) {
    var rn = Math.round(rows.length * rowsP);
    rows.forEach(function (r, k) { r.classList.toggle('is-in', k < rn); });
    pick.classList.toggle('is-picked', !!picked);
  }
  function paintOut(stepsP, chansP) {
    var sk = Math.floor(stepsP * (steps.length + 0.001));
    steps.forEach(function (s, k) {
      s.classList.toggle('is-on', k < sk);
      s.classList.toggle('is-now', k === sk - 1 && sk < steps.length);
      s.classList.toggle('is-final', k === steps.length - 1 && sk >= steps.length);
    });
    var branded = sk >= 4;
    brand.style.opacity = branded ? '1' : '';
    topBar.classList.toggle('is-in', branded);
    sub.classList.toggle('is-in', sk >= 2);
    sub.classList.toggle('is-branded', branded);
    var cn = Math.round(chans.length * chansP);
    chans.forEach(function (c, k) { c.classList.toggle('is-in', k < cn); });
    return sk;
  }
  function paintStatus(sk, stage, filtering) {
    var t = T(), label = t.watch, done = false;
    if (sk >= steps.length)   { label = t.s[5]; done = true; }
    else if (sk > 0)          { label = t.s[sk - 1]; }
    else if (stage === 'pick'){ label = t.pick; }
    else if (stage === 'rank'){ label = t.ranked; }
    else if (filtering)       { label = t.drop; }
    statusTx.textContent = label;
    status.classList.toggle('is-done', done);
  }

  function render(p) {
    p = cl(p);
    if (stacked()) return renderStacked();

    var zoom = 1 + (SCALE[2] - 1) * seg(p, K.s2, K.s2 + 0.06);
    zoom = zoom + (SCALE[3] - SCALE[2]) * seg(p, K.s3, K.s3 + 0.06);
    paintWall(out3(seg(p, K.fill[0], K.fill[1])), seg(p, K.filter[0], K.filter[1]),
              zoom, out3(seg(p, 0, K.fill[1] + 0.04)));

    var s2 = p >= K.s2, s3 = p >= K.s3;
    fn.classList.toggle('is-s2', s2); fn.classList.toggle('is-s3', s3);

    paintRows(seg(p, K.rows[0], K.rows[1]), p >= K.pick);

    /* connectors — measured the first time each one is needed */
    var l1on = p >= K.link1, l2on = p >= K.link2;
    if (l1on && !linksDrawn[1]) { drawLinks(); linksDrawn[1] = true; }
    if (l2on && !linksDrawn[2]) { drawLinks(); linksDrawn[2] = true; }
    link1.classList.toggle('is-in', l1on);
    link2.classList.toggle('is-in', l2on);

    var sk = paintOut(seg(p, K.steps[0], K.steps[1]), seg(p, K.chans[0], K.chans[1]));
    paintStatus(sk, p >= K.pick ? 'pick' : s2 ? 'rank' : '', p >= K.filter[0]);

    /* re-measure the connectors once a column finishes opening */
    var st = s3 ? 3 : s2 ? 2 : 1;
    if (st !== lastStage) { lastStage = st; setTimeout(drawLinks, 460); }
  }

  /* ── stacked layout ──────────────────────────────────────────── */
  /* Each card owns its own looping clock: it starts when the card reaches the
     screen, plays once, holds on the finished state, then replays. Cards are
     independent of each other and of the scroll position. */
  var LOOP = { play:2400, hold:1500 };
  var clocks = [], loopRaf = null;
  function clockFor(el){ var c = { el:el, p:0, t0:0, live:false }; clocks.push(c); return c; }
  function loopTick(ts){
    var any = false;
    for (var i = 0; i < clocks.length; i++) {
      var c = clocks[i]; if (!c.live) continue; any = true;
      if (!c.t0) c.t0 = ts;
      var k = (ts - c.t0) % (LOOP.play + LOOP.hold);
      c.p = k < LOOP.play ? k / LOOP.play : 1;
    }
    renderStacked();
    loopRaf = any ? requestAnimationFrame(loopTick) : null;
  }
  function startLoops(){
    if (!clocks.length) {
      [tierA, tierB, tierC].forEach(function (el) { el.__clock = clockFor(el); });
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) {
          var c = x.target.__clock; if (!c) return;
          if (x.isIntersecting) { if (!c.live) { c.live = true; c.t0 = 0; } }
          else { c.live = false; }
        });
        if (!loopRaf) loopRaf = requestAnimationFrame(loopTick);
      }, { threshold:0.3 });
      clocks.forEach(function (c) { io.observe(c.el); });
    }
    if (!loopRaf) loopRaf = requestAnimationFrame(loopTick);
  }

  function renderStacked() {
    if (!clocks.length) { startLoops(); }
    fn.classList.remove('is-s2', 'is-s3');
    var pa = tierA.__clock ? tierA.__clock.p : 0,
        pb = tierB.__clock ? tierB.__clock.p : 0,
        pc = tierC.__clock ? tierC.__clock.p : 0;
    paintWall(out3(seg(pa, M.fill[0], M.fill[1])), seg(pa, M.filter[0], M.filter[1]),
              1, out3(seg(pa, M.travel[0], M.travel[1])));
    paintRows(seg(pb, M.rows[0], M.rows[1]), pb >= M.pick);
    link1.classList.toggle('is-in', pb > 0.04);
    link2.classList.toggle('is-in', pc > 0.04);
    var sk = paintOut(seg(pc, M.steps[0], M.steps[1]), seg(pc, M.chans[0], M.chans[1]));
    paintStatus(sk, pb >= M.pick ? 'pick' : pb > 0.1 ? 'rank' : '', pa >= M.filter[0]);
  }

  /* ── progress source ────────────────────────────────────────────── */
  var target = 0, current = 0, raf = null, heard = false;

  function loop() {
    current += (target - current) * 0.3;               /* smooths the wheel */
    if (Math.abs(target - current) < 0.0005) current = target;
    render(current);
    raf = (current === target) ? null : requestAnimationFrame(loop);
  }
  function setProgress(p, instant) {
    target = cl(p);
    if (instant || reduced()) { current = target; render(current); return; }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  window.addEventListener('message', function (e) {
    var d = e && e.data; if (!d) return;
    if (typeof d.ektebScroll === 'number') { heard = true; goEmbedded(); setProgress(d.ektebScroll); }
  });

  /* ── boot ───────────────────────────────────────────────────────── */
  /* Self-driving by default — the file's own scrollbar is the timeline, whether
     it is opened directly or shown in a preview frame. The moment a host page
     posts a real progress value, that takes over and the local scroll is let go. */
  /* Kept hoisted above the boot calls (the export declares them after).
     The stacked layout used to read scroller.getBoundingClientRect() during
     render(0), and var-hoisting left scroller undefined there, so boot threw
     on every narrow viewport and the animation was dead on mobile. The card
     clocks no longer touch scroller, but declaring these first keeps the boot
     order safe if the stacked path ever reads them again. */
  var hint = $('#scrollHint');
  var scroller = $('#scroller');

  document.documentElement.classList.add('is-solo');
  calibrate();
  render(0);
  drawLinks();

  var onScroll = function () {
    var max = scroller.scrollHeight - scroller.clientHeight;
    var p = max > 0 ? scroller.scrollTop / max : 0;
    if (stacked()) { startLoops(); if (hint) hint.classList.toggle('is-gone', p > 0.02); return; }
    setProgress(p);
    if (hint) hint.classList.toggle('is-gone', p > 0.02);
  };
  scroller.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', onScroll);
  onScroll();
  if (reduced()) setProgress(1, true);

  function goEmbedded() {
    if (!document.documentElement.classList.contains('is-solo')) return;
    window.removeEventListener('scroll', onScroll);
    scroller.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    document.documentElement.classList.remove('is-solo');
    calibrate(); linksDrawn[1] = linksDrawn[2] = false;
  }

  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { calibrate(); linksDrawn[1] = linksDrawn[2] = false; render(current); drawLinks(); }, 160);
  });
  reduceMQ.addEventListener('change', function () { render(current); });
}());
