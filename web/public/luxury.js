/* The motion layer for the website: headlines rise into place and blocks fade up, slowly and with easing, on top of the editorial layout.
   Nothing runs for people who ask for less motion. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  var root = document.documentElement;

  // split a headline into letters that rise into place one after another
  function kinetic(el, base) {
    if (!el || el.dataset.kn) return;
    var text = el.textContent;
    if (!text || el.children.length) return;
    el.dataset.kn = '1';
    el.setAttribute('aria-label', text);
    el.textContent = '';
    var n = 0;
    text.split(/(\s+)/).forEach(function (w) {
      if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(' ')); return; }
      var word = document.createElement('span'); word.className = 'kw'; word.setAttribute('aria-hidden', 'true');
      w.split('').forEach(function (ch) {
        var k = document.createElement('span'); k.className = 'k'; k.textContent = ch;
        k.style.setProperty('--i', String((base || 0) + n)); k.style.setProperty('--tilt', (n % 2 ? 9 : -9) + 'deg'); n++;
        word.appendChild(k);
      });
      el.appendChild(word);
    });
    el.classList.add('kn');
  }

  function init() {
    // the hero headline plays as soon as the opening animation is over
    document.querySelectorAll('header.hero h1 .ln > span').forEach(function (s, i) { kinetic(s, i * 14); });
    // other headlines play when they scroll into view
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    document.querySelectorAll('section h2, .head h2, .head .display').forEach(function (h) { if (!h.closest('header.hero')) { kinetic(h, 0); h.classList.add('kin-view'); io.observe(h); } });
    // cards and blocks arrive in stop-motion
    document.querySelectorAll('section .card, section .plate, .gal figure, .facts > *').forEach(function (c) { c.classList.add('sm-in'); io.observe(c); });
    root.classList.add('luxury-on');
    setTimeout(function () { document.querySelectorAll('.sm-in:not(.in)').forEach(function (e) { e.style.opacity = '1'; }); }, 6000); // never leave anything hidden
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
