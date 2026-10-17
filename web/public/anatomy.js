// "The ground, layer by layer": an isometric line drawing that lifts apart as the page scrolls. Pure SVG, so it is sharp at any size.
(() => {
  const track = document.getElementById('an-track'), svg = document.getElementById('an-svg'), list = document.getElementById('an-list');
  if (!track || !svg || !list) return;
  const NS = 'http://www.w3.org/2000/svg', K = Math.cos(Math.PI / 6);
  const P = (x, y, z = 0) => [(x - y) * K, (x + y) * 0.5 - z];
  const el = (n, a = {}, parent) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e; };
  const poly = (pts, g, close = true, a = {}) => el('path', { d: 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L') + (close ? 'Z' : ''), ...a }, g);
  const seg = (a, b, g, at = {}) => poly([P(...a), P(...b)], g, false, at);
  const box = (x0, y0, z0, x1, y1, z1, g) => {
    const c = (x, y, z) => P(x, y, z);
    poly([c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)], g);
    poly([c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0)], g);
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) seg([x, y, z0], [x, y, z1], g);
  };
  const ring = (r, z, g, a = {}) => poly(Array.from({ length: 96 }, (_, i) => { const t = (i / 96) * Math.PI * 2; return P(r * Math.cos(t), r * Math.sin(t), z); }), g, true, a);

  const layers = [
    { name: 'Ground', note: 'The outfield, rolled and cut for matches and practice.', draw(g) {
      ring(260, 0, g); ring(260, -10, g); ring(150, 0, g, { 'stroke-dasharray': '3 6' });
      for (let i = 0; i < 96; i += 8) { const t = (i / 96) * Math.PI * 2; seg([260 * Math.cos(t), 260 * Math.sin(t), 0], [260 * Math.cos(t), 260 * Math.sin(t), -10], g); }
    } },
    { name: 'Wicket', note: 'A grass wicket, prepared for leather ball and tennis ball formats.', draw(g) {
      box(-150, -17, 0, 150, 17, 3, g);
      for (const x of [-122, 122]) { seg([x, -17, 3], [x, 17, 3], g); }
      for (const x of [-136, 136]) { seg([x, -17, 3], [x, 17, 3], g); for (const y of [-6, 0, 6]) seg([x, y, 3], [x, y, 30], g); }
      seg([-136, 0, 3], [136, 0, 3], g, { 'stroke-dasharray': '2 7' });
    } },
    { name: 'Nets', note: 'Practice lanes beside the main ground, open for sessions.', draw(g) {
      for (let i = 0; i < 3; i++) {
        const y0 = 150 + i * 30; box(-100, y0, 0, 100, y0 + 24, 40, g);
        for (let x = -88; x < 100; x += 12) seg([x, y0, 40], [x, y0 + 24, 40], g, { opacity: 0.45 });
        for (let z = 10; z < 40; z += 10) { seg([-100, y0, z], [100, y0, z], g, { opacity: 0.35 }); }
      }
    } },
    { name: 'Floodlights', note: 'Four towers light the whole ground from dusk to late night.', draw(g) {
      for (const d of [45, 135, 225, 315]) {
        const t = (d * Math.PI) / 180, x = 285 * Math.cos(t), y = 285 * Math.sin(t);
        seg([x, y, 0], [x, y, 190], g); box(x - 16, y - 16, 190, x + 16, y + 16, 206, g);
        seg([x, y, 190], [x * 0.2, y * 0.2, 0], g, { 'stroke-dasharray': '2 7', opacity: 0.6 });
        seg([x, y, 190], [-x * 0.2, -y * 0.2, 0], g, { 'stroke-dasharray': '2 7', opacity: 0.35 });
      }
    } },
  ];

  const root = el('g', { transform: 'translate(0 0) scale(.8)' }, svg), gs = [], rows = [];
  layers.forEach((l, i) => {
    const g = el('g', { class: 'an-l' }, root); l.draw(g); gs.push(g);
    const li = document.createElement('li'); li.innerHTML = '<b></b><span></span>'; li.firstChild.textContent = l.name; li.lastChild.textContent = l.note;
    li.addEventListener('click', () => { const r = track.getBoundingClientRect(), span = track.offsetHeight - innerHeight; scrollTo({ top: scrollY + r.top + span * ((i + 0.5) / layers.length) * 0.78 + span * 0.2 }); });
    list.appendChild(li); rows.push(li);
  });
  const ease = (t) => t * t * (3 - 2 * t), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = -1;
  const draw = () => {
    const r = track.getBoundingClientRect(), span = Math.max(1, track.offsetHeight - innerHeight);
    const p = still ? 0.6 : Math.min(1, Math.max(0, -r.top / span));
    const gap = 150 * ease(Math.min(1, p / 0.22)), n = layers.length;
    const act = p < 0.22 ? -1 : Math.min(n - 1, Math.floor(((p - 0.22) / 0.78) * n));
    gs.forEach((g, i) => { g.setAttribute('transform', `translate(0 ${((n - 1) / 2 - i) * gap + 0})`); g.classList.toggle('on', act === i); g.classList.toggle('dim', act >= 0 && act !== i); });
    if (act !== last) { rows.forEach((li, i) => li.classList.toggle('on', i === act)); last = act; }
  };
  addEventListener('scroll', draw, { passive: true }); addEventListener('resize', draw); draw();
})();
