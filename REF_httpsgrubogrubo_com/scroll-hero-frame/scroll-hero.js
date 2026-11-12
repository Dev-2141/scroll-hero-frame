/* ==========================================================================
   Scroll Hero Frame  v1.0
   1. Scrub engine: scroll position -> video.currentTime (+ progress bar)
   2. Reveal engine: staggered fade / rise / blur-in, once per block
   No dependencies. Auto-starts every [data-scroll-hero] on DOMContentLoaded.
   API: ScrollHero.init(sectionEl) -> { destroy() },  ScrollHero.initAll()
   ========================================================================== */
(function (global) {
  'use strict';

  var MOBILE_QUERY = '(max-width: 820px)';
  var REVEAL_TARGETS = 'h2, .shf-lead, .shf-kicker, .shf-card h3, .shf-counter, .shf-bio, ' +
                       '.shf-awards-label, .shf-award, .shf-note, .shf-signature';
  var instances = new WeakMap();

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* ------------------------------------------------------------------ scrub */
  function createScrub(section) {
    var video = section.querySelector('.shf-video');
    var frame = section.querySelector('.shf-backdrop');
    var bar = section.querySelector('.shf-progress > span');
    if (!frame) return function () {};

    var mobile = global.matchMedia(MOBILE_QUERY);
    var scheduled = false, ready = false, lastTarget = -1, desiredTime = 0;
    // Shared with scroll-hero-cards.js: the live scroll progress (0..1).
    section._shf = { progress: function () { return fraction(); } };
    var primed = false, priming = false, lastSet = 0;
    var off = [];

    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      off.push(function () { target.removeEventListener(type, fn, opts); });
    }

    if (video) {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.pause();
      ready = video.readyState >= 1;
    }

    function hasDuration() {
      return video && ready && isFinite(video.duration) && video.duration > 0;
    }

    function fraction() {
      var vh = global.innerHeight || document.documentElement.clientHeight;
      var rect;
      if (mobile.matches) {
        // Video is its own panel: start when its top is at 85% of the screen,
        // finish while its last frames are still clearly visible.
        rect = frame.getBoundingClientRect();
        return clamp((vh * 0.85 - rect.top) / Math.max(1, rect.height + vh * 0.30), 0, 1);
      }
      // Desktop: 0 when the section top meets the screen bottom,
      // 1 when the section bottom meets the screen bottom.
      rect = section.getBoundingClientRect();
      return clamp((vh - rect.top) / Math.max(1, rect.height), 0, 1);
    }

    function applySeek(force) {
      if (!hasDuration()) return;
      var next = clamp(desiredTime, 0, Math.max(0, video.duration - 0.025));
      var now = performance.now();
      if (!force) {
        if (Math.abs(next - lastTarget) < 0.035) return;
        if (mobile.matches && (now - lastSet < 42 || video.seeking)) return;
      }
      lastSet = now;
      lastTarget = next;
      try { video.currentTime = next; } catch (e) { /* not seekable yet */ }
    }

    function update() {
      scheduled = false;
      var f = fraction();
      if (bar) bar.style.width = (f * 100).toFixed(2) + '%';
      if (!hasDuration()) return;
      desiredTime = f * video.duration;
      applySeek(false);
    }

    function schedule() {
      if (!scheduled) { scheduled = true; global.requestAnimationFrame(update); }
    }

    // iOS Safari will not paint frames of a never-started video. Start it once,
    // muted and inline, on the first touch, then pause immediately.
    function primeMobile() {
      if (!video || !mobile.matches || primed || priming || !ready) return;
      priming = true;
      var p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(function () { primed = true; video.pause(); priming = false; schedule(); applySeek(true); })
         .catch(function () { priming = false; schedule(); });
      } else { primed = true; video.pause(); priming = false; schedule(); }
    }

    if (video) {
      on(video, 'loadedmetadata', function () { ready = true; video.pause(); lastTarget = -1; schedule(); });
      on(video, 'loadeddata', schedule);
      on(video, 'canplay', schedule);
      on(video, 'seeked', function () {
        if (mobile.matches && Math.abs(desiredTime - video.currentTime) > 0.09) applySeek(true);
      });
      on(video, 'play', function () { if (!priming) video.pause(); });
      on(global, 'touchstart', primeMobile, { passive: true });
      on(global, 'pointerdown', primeMobile, { passive: true });
    }
    on(global, 'scroll', schedule, { passive: true });
    on(global, 'resize', schedule, { passive: true });
    if (mobile.addEventListener) on(mobile, 'change', function () { lastTarget = -1; schedule(); });
    on(document, 'visibilitychange', function () { if (!document.hidden) schedule(); });

    if (video && video.readyState === 0) video.load();
    schedule();

    return function destroy() { off.forEach(function (fn) { fn(); }); off = []; };
  }

  /* ----------------------------------------------------------------- reveal */
  function createReveal(section) {
    var root = section.querySelector('.shf-content');
    if (!root || section.hasAttribute('data-shf-no-reveal')) return function () {};
    var targets = root.querySelectorAll(REVEAL_TARGETS);

    Array.prototype.forEach.call(targets, function (el, i) {
      el.classList.add('shf-reveal');
      el.style.setProperty('--reveal-delay', (Math.min(i % 5, 4) * 75) + 'ms');
    });

    if (!('IntersectionObserver' in global)) {
      Array.prototype.forEach.call(targets, function (el) { el.classList.add('is-visible'); });
      return function () {};
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });

    Array.prototype.forEach.call(targets, function (el) { observer.observe(el); });
    return function destroy() { observer.disconnect(); };
  }

  /* -------------------------------------------------------------------- API */
  function init(section) {
    if (!section || instances.has(section)) return instances.get(section);
    var stopScrub = createScrub(section);
    var stopReveal = createReveal(section);
    var api = {
      destroy: function () {
        stopScrub(); stopReveal();
        instances.delete(section);
      }
    };
    instances.set(section, api);
    return api;
  }

  function initAll(scope) {
    var list = (scope || document).querySelectorAll('[data-scroll-hero]');
    return Array.prototype.map.call(list, init);
  }

  global.ScrollHero = { init: init, initAll: initAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initAll(); });
  } else {
    initAll();
  }
})(window);
