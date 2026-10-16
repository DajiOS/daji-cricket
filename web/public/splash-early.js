/* Runs in the page head, before anything is painted: if the intro animation is going to play, the page is covered from the very first frame
   (the same conditions app.js checks). app.js takes over from here; if it never loads, the cover is lifted after 14 seconds. */
(function () {
  var d = document.documentElement;
  try {
    var seen = false; try { seen = sessionStorage.getItem('daji.splash') === '1'; } catch (e) { /* private mode: just play */ }
    var framed = window.parent !== window || /[?&]embed=/.test(location.search);
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (seen || framed || reduce || (location.hash && location.hash !== '#top')) return;
    d.classList.add('splash-on');
    setTimeout(function () { d.classList.remove('splash-on'); }, 14000);
  } catch (e) { /* never block the page */ }
})();
