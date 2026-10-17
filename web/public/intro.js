/* The opening animation, shared by the website and the desk: a launch-film style sequence. Short phrases appear word by word with one accent
   word, a 3D phone shows the booking screen, thin arcs glow behind, and the logo closes it. Smooth and eased throughout.
   DajiIntro.play(box, { dark, logo, onDone }) fills the box (a full-screen element) and calls onDone when it ends or Skip is pressed. */
(function () {
  'use strict';
  var CSS = [
    '.dI{position:absolute;inset:0;overflow:hidden;--bg:#07090a;--fg:#f3eee3;--mut:rgba(243,238,227,.55);--ac:#d6b36a;--line:rgba(214,179,106,.35);--bez:linear-gradient(145deg,#6c7a8c,#232a33 38%,#0d1014 60%,#46566a);--scr:#0c1013;--chip:rgba(255,255,255,.06);--on:#14110a;background:var(--bg);font-family:Manrope,Inter,system-ui,sans-serif;color:var(--fg)}',
    '.dI.light{--bg:#fbfaf7;--fg:#14201b;--mut:rgba(20,32,27,.55);--ac:#8c6f2a;--line:rgba(140,111,42,.35);--bez:linear-gradient(145deg,#c8ccd2,#7b828c 38%,#454b54 60%,#aeb4bd);--scr:#ffffff;--chip:rgba(20,32,27,.06);--on:#ffffff}',
    '.dI::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 55%,rgba(214,179,106,.10),transparent 60%);pointer-events:none}',
    '.dI.light::before{background:radial-gradient(ellipse at 50% 55%,rgba(140,111,42,.08),transparent 60%)}',
    '.dI-arcs{position:absolute;left:50%;top:50%;width:150vmin;height:150vmin;margin:-75vmin 0 0 -75vmin;opacity:0}',
    '.dI-arcs circle{fill:none;stroke:var(--line);stroke-width:.25}',
    '.dI-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 6vmin;pointer-events:none}',
    '.dI-ph h2{margin:0;font-weight:600;font-size:clamp(30px,7.2vmin,84px);line-height:1.12;letter-spacing:-.02em;max-width:18ch}',
    '.dI-ph.top{align-items:flex-start;padding-top:10vmin}',
    '.dI-w{display:inline-block;opacity:0;will-change:transform,opacity,filter}',
    '.dI-w.ac{color:var(--ac)}',
    '.dI-stage{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;perspective:1500px;perspective-origin:50% 40%;pointer-events:none}',
    '.dI-phone{position:relative;width:30vmin;height:58vmin;margin-bottom:6vmin;border-radius:4.6vmin;padding:.7vmin;background:var(--bez);box-shadow:0 5vmin 9vmin -3vmin rgba(0,0,0,.55),0 0 0 .15vmin rgba(255,255,255,.18) inset;transform-style:preserve-3d;opacity:0;font-size:1.5vmin}',
    '.dI-screen{position:absolute;inset:.7vmin;border-radius:3.9vmin;background:var(--scr);overflow:hidden;padding:7.2em 1.7em 1.6em;display:flex;flex-direction:column;gap:1.1em}',
    '.dI-isl{position:absolute;left:50%;top:1.1em;width:7.4em;height:2.1em;margin-left:-3.7em;border-radius:99px;background:#000}',
    '.dI-eb{font-size:.95em;letter-spacing:.14em;text-transform:uppercase;color:var(--ac);font-weight:700}',
    '.dI-t{font-size:2em;font-weight:700;letter-spacing:-.01em;line-height:1.1}',
    '.dI-days{display:flex;gap:.6em}',
    '.dI-day{flex:1;border-radius:.9em;padding:.7em 0;background:var(--chip);text-align:center;font-size:1em;line-height:1.25;color:var(--mut)}',
    '.dI-day b{display:block;font-size:1.5em;color:var(--fg);font-weight:700}',
    '.dI-day.on{background:var(--ac);color:var(--on)}.dI-day.on b{color:var(--on)}',
    '.dI-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:.6em}',
    '.dI-slot{border-radius:.8em;padding:.9em 0;background:var(--chip);text-align:center;font-size:1.05em;font-weight:600;color:var(--fg);transition:none}',
    '.dI-slot.off{opacity:.35;text-decoration:line-through}',
    '.dI-slot.sel{background:var(--ac);color:var(--on)}',
    '.dI-btn{margin-top:auto;border-radius:1em;padding:1.1em 0;text-align:center;font-weight:700;font-size:1.15em;background:var(--chip);color:var(--mut)}',
    '.dI-btn.go{background:var(--ac);color:var(--on)}',
    '.dI-logo{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0}',
    '.dI-logo img{width:min(78vw,820px);height:auto;display:block}',
    '.dI-skip{position:absolute;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:3;font:600 12px/1 Manrope,Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:99px;padding:10px 16px;cursor:pointer}',
    '.dI-skip:focus-visible{outline:2px solid var(--ac);outline-offset:2px}'
  ].join('\n');

  var EASE = 'cubic-bezier(.2,.8,.2,1)';

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function phrase(parent, words, cls) { // words: [text, isAccent]
    var ph = el('div', 'dI-ph' + (cls ? ' ' + cls : '')), h = el('h2');
    words.forEach(function (w, i) { var s = el('span', 'dI-w' + (w[1] ? ' ac' : ''), w[0]); h.appendChild(s); if (i < words.length - 1) h.appendChild(document.createTextNode(' ')); });
    ph.appendChild(h); parent.appendChild(ph); return ph;
  }
  function wordsIn(ph, at, anims) {
    Array.prototype.forEach.call(ph.querySelectorAll('.dI-w'), function (w, i) {
      anims.push(w.animate([{ opacity: 0, transform: 'translateY(.45em)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 800, delay: at + i * 90, easing: EASE, fill: 'both' }));
    });
  }
  function wordsOut(ph, at, anims) {
    Array.prototype.forEach.call(ph.querySelectorAll('.dI-w'), function (w, i) {
      anims.push(w.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-.3em)', filter: 'blur(8px)' }], { duration: 420, delay: at + i * 40, easing: 'ease-in', fill: 'forwards' }));
    });
  }

  function play(box, opt) {
    opt = opt || {};
    if (!document.getElementById('dI-css')) { var st = el('style'); st.id = 'dI-css'; st.textContent = CSS; document.head.appendChild(st); }
    var root = el('div', 'dI' + (opt.dark === false ? ' light' : '')), anims = [], timers = [], done = false;
    box.appendChild(root);
    var ns = 'http://www.w3.org/2000/svg';
    var arcs = el('div', 'dI-arcs'); arcs.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><circle cx="50" cy="50" r="49"/><circle cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="27" stroke-dasharray="40 14"/></svg>';
    root.appendChild(arcs);
    var A = function (e, kf, o) { var a = e.animate(kf, Object.assign({ fill: 'both' }, o)); anims.push(a); return a; };

    // arcs drift slowly behind everything
    A(arcs, [{ opacity: 0, transform: 'scale(.85) rotate(-12deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 2600, delay: 100, easing: EASE });
    A(arcs, [{ opacity: 1 }, { opacity: 0 }], { duration: 900, delay: 8200, easing: 'ease-in', composite: 'replace', fill: 'forwards' });

    // 1. the opening line
    var p1 = phrase(root, [['Floodlit', 1], ['ground.', 0]]);
    wordsIn(p1, 300, anims); wordsOut(p1, 2100, anims);

    // 2. the phone: a real look at the booking screen
    var stage = el('div', 'dI-stage'), phone = el('div', 'dI-phone');
    phone.innerHTML = '<div class="dI-isl"></div><div class="dI-screen"><div class="dI-eb">Reserve</div><div class="dI-t">Pick a day<br>and a time</div>'
      + '<div class="dI-days"><div class="dI-day">Fri<b>13</b></div><div class="dI-day on">Sat<b>14</b></div><div class="dI-day">Sun<b>15</b></div></div>'
      + '<div class="dI-slots"><div class="dI-slot off">6 am</div><div class="dI-slot">7 am</div><div class="dI-slot">8 am</div><div class="dI-slot">4 pm</div><div class="dI-slot">5 pm</div><div class="dI-slot">6 pm</div><div class="dI-slot">7 pm</div><div class="dI-slot">8 pm</div><div class="dI-slot">9 pm</div></div>'
      + '<div class="dI-btn">Choose your slot</div></div>';
    stage.appendChild(phone); root.appendChild(stage);
    var p2 = phrase(root, [['Pick', 0], ['your', 0], ['time.', 1]], 'top');
    wordsIn(p2, 2800, anims);
    A(phone, [
      { opacity: 0, transform: 'translateY(60vmin) rotateX(24deg) rotateY(-26deg) rotateZ(5deg)' },
      { opacity: 1, transform: 'translateY(0) rotateX(10deg) rotateY(-14deg) rotateZ(2deg)', offset: .6 },
      { opacity: 1, transform: 'translateY(-2vmin) rotateX(6deg) rotateY(-6deg) rotateZ(0deg)' }
    ], { duration: 2400, delay: 2500, easing: EASE });
    A(phone, [{ opacity: 1, transform: 'translateY(-2vmin) rotateX(6deg) rotateY(-6deg)' }, { opacity: 0, transform: 'translateY(-14vmin) rotateX(0) rotateY(10deg) scale(.96)' }], { duration: 700, delay: 5700, easing: 'ease-in', composite: 'replace', fill: 'forwards' });
    wordsOut(p2, 5500, anims);
    var slots = phone.querySelectorAll('.dI-slot'), btn = phone.querySelector('.dI-btn');
    timers.push(setTimeout(function () { slots[4].classList.add('sel'); }, 4000));
    timers.push(setTimeout(function () { btn.classList.add('go'); btn.textContent = 'Pay the advance'; }, 4500));

    // 3. the promise
    var p3 = phrase(root, [['Held', 1], ['in', 0], ['your', 0], ['name.', 1]]);
    wordsIn(p3, 6300, anims); wordsOut(p3, 7700, anims);

    // 4. the logo
    var lg = el('div', 'dI-logo'), img = el('img'); img.alt = 'Daji Cricket Ground'; img.src = opt.logo || 'assets/logo.svg'; lg.appendChild(img); root.appendChild(lg);
    A(lg, [{ opacity: 0, transform: 'scale(.94)', filter: 'blur(10px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 1100, delay: 8100, easing: EASE });

    var skip = el('button', 'dI-skip', 'Skip'); skip.type = 'button'; root.appendChild(skip);
    function finish() {
      if (done) return; done = true;
      timers.forEach(clearTimeout);
      root.style.transition = 'opacity .6s ease'; root.style.opacity = '0';
      setTimeout(function () { anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* gone */ } }); if (root.parentNode) root.remove(); if (opt.onDone) opt.onDone(); }, 650);
    }
    skip.addEventListener('click', finish);
    timers.push(setTimeout(finish, 10400));
    return { finish: finish };
  }
  window.DajiIntro = { play: play };
})();
