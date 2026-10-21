// Festival decoration for the home page, all drawn in code: SVG motifs (kites, the tricolour and Ashoka chakra, colour bursts,
// a marigold toran and modaks, garba bunting and dandiya, diyas and rangoli, Christmas lights) and one canvas of moving
// things (drifting kites, falling petals, gulal puffs, embers, sparkles, snow, fireworks). No images or fonts are fetched.
// app.js calls window.DajiFestive.mount(layer, look, { colour, mode }) on a festival day, unmount() after it and
// celebrate() at midnight on New Year's Eve. With reduced motion the canvas draws one still frame and nothing moves.
(() => {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const NINE = ['#f57c00', '#f2ede1', '#d32f2f', '#2f5bd8', '#f6c21c', '#2e9e4f', '#9aa0a8', '#8e4ec6', '#00a19a'];

// ------------------------------------------------------------------ SVG motifs
const svg = (cls, vb, body, extra = '') => `<svg class="fd ${cls}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

function kite(x, y, s, a, b, rot = 0) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M0 -50 L38 0 L0 64 L-38 0Z" fill="${a}"/><path d="M0 -50 L38 0 L0 64Z" fill="${b}" opacity=".9"/>
    <path d="M0 -50V64M-38 0H38" stroke="#fff" stroke-opacity=".75" stroke-width="2"/>
    <path d="M0 64 l-9 18h18Z" fill="${b}"/>
    <path d="M0 82 C 14 110 -16 130 4 160 S -10 210 8 240" fill="none" stroke="${a}" stroke-width="1.6" stroke-dasharray="1 5" stroke-linecap="round" opacity=".8"/>
  </g>`;
}
function chakra(r) {
  let spokes = '';
  for (let i = 0; i < 24; i++) spokes += `<path d="M0 0L0 -${r - 4}" transform="rotate(${i * 15})"/><circle cx="0" cy="-${r - 2}" r="2.2" transform="rotate(${i * 15 + 7.5})" fill="#000080" stroke="none"/>`;
  return `<g stroke="#000080" stroke-width="2.2" fill="none"><circle r="${r}" stroke-width="4"/>${spokes}<circle r="7" fill="#000080"/></g>`;
}
function tricolourWave() {
  const band = (y, col) => { let d = `M0 ${y}`; for (let x = 0; x <= 2400; x += 150) d += ` Q ${x + 75} ${y + (x / 150 % 2 ? 14 : -14)} ${x + 150} ${y}`; return `<path d="${d} V ${y + 26} H 0 Z" fill="${col}"/>`; };
  return band(4, '#ff9933') + band(26, '#ffffff') + band(48, '#138808');
}
function burst(cx, cy, r, cols) {
  let o = '';
  cols.forEach((c, i) => { const a = (i / cols.length) * Math.PI * 2; o += `<circle cx="${cx + Math.cos(a) * r * .45}" cy="${cy + Math.sin(a) * r * .45}" r="${r * .62}" fill="url(#g-${c.slice(1)})"/>`; });
  for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, d = r * rnd(.9, 1.7); o += `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d).toFixed(1)}" r="${rnd(1.5, 4.5).toFixed(1)}" fill="${pick(cols)}" opacity=".75"/>`; }
  return o;
}
function marigold(x, y, r) {
  return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#f28c0f"/><circle r="${r * .72}" fill="#ffb21e"/><circle r="${r * .42}" fill="#f7a10a"/><circle r="${r * .18}" fill="#c25e00"/></g>`;
}
function toran(width) {
  let o = '', swag = 220;
  for (let s = 0; s * swag < width; s++) {
    const x0 = s * swag, n = 9;
    for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + t * swag, y = 10 + Math.sin(t * Math.PI) * 34; o += marigold(x, y, 9); }
    o += `<g transform="translate(${x0 + swag} 10)"><path d="M0 4 C 10 20 6 40 0 52 C -6 40 -10 20 0 4Z" fill="#2e7d32"/><path d="M0 8V48" stroke="#a5d6a7" stroke-width="1.2"/></g>`;
  }
  return o;
}
function modak(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -44 C 6 -30 30 -6 30 10 C 30 26 16 34 0 34 C -16 34 -30 26 -30 10 C -30 -6 -6 -30 0 -44Z" fill="#fbe7c1" stroke="#e0a54a" stroke-width="1.5"/>
    <path d="M0 -40V32M-12 -18 C -18 0 -18 18 -12 32M12 -18 C 18 0 18 18 12 32M-22 -2 C -26 10 -24 24 -20 30M22 -2 C 26 10 24 24 20 30" stroke="#e0a54a" stroke-width="1.4" fill="none"/></g>`;
}
function bunting(width, today) {
  let o = `<path d="M0 6 Q ${width / 2} 30 ${width} 6" stroke="currentColor" stroke-opacity=".5" fill="none" stroke-width="1.5"/>`;
  const n = Math.max(9, Math.round(width / 70));
  for (let i = 0; i < n; i++) {
    const t = (i + .5) / n, x = t * width, y = 6 + 4 * 24 * t * (1 - t), c = NINE[i % 9], big = today && c === today;
    o += `<path d="M${x - (big ? 17 : 13)} ${y} L${x + (big ? 17 : 13)} ${y} L${x} ${y + (big ? 40 : 30)}Z" fill="${c}"${big ? ' stroke="#fff" stroke-width="1.5"' : ''}/>`;
  }
  return o;
}
function dandiya(day) {
  const stick = (rot, c) => `<g transform="rotate(${rot})"><rect x="-4" y="-90" width="8" height="180" rx="4" fill="${c}"/>${[-60, -30, 0, 30, 60].map((y) => `<rect x="-4" y="${y}" width="8" height="6" fill="#ffd166"/>`).join('')}<circle cy="-94" r="6" fill="#ff3ca0"/><path d="M0 90 l-6 22M0 90 l0 24M0 90 l6 22" stroke="#ffd166" stroke-width="2"/></g>`;
  let ring = '';
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; ring += `<circle cx="${(Math.cos(a) * 128).toFixed(1)}" cy="${(Math.sin(a) * 128).toFixed(1)}" r="${i % 2 ? 3 : 5}" fill="${i % 2 ? '#ffd166' : (day || '#ff3ca0')}"/>`; }
  return `<g class="fd-spin">${ring}</g>${stick(-28, day || '#ff3ca0')}${stick(28, '#00beb4')}`;
}
function diya(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><g class="fd-flame"><path d="M0 -6 C 8 -16 4 -28 0 -38 C -4 -28 -8 -16 0 -6Z" fill="url(#g-flame)"/><path d="M0 -8 C 3 -13 2 -20 0 -24 C -2 -20 -3 -13 0 -8Z" fill="#fff6c4"/></g>
    <path d="M-34 -4 Q 0 34 34 -4 Q 0 6 -34 -4Z" fill="#b8541c"/><path d="M-34 -4 Q 0 6 34 -4" stroke="#f0a24a" stroke-width="2.5" fill="none"/><path d="M-20 8 Q 0 18 20 8" stroke="#ffcf7a" stroke-width="1.5" fill="none" opacity=".7"/></g>`;
}
function rangoli(r) {
  const cols = ['#ff3c7d', '#ffb21e', '#16b5a8', '#7a3cff', '#ff6a1a', '#2e9e4f'];
  let o = '';
  for (let i = 0; i < 16; i++) o += `<path d="M0 0 C ${r * .22} ${-r * .35} ${r * .14} ${-r * .8} 0 ${-r} C ${-r * .14} ${-r * .8} ${-r * .22} ${-r * .35} 0 0Z" transform="rotate(${i * 22.5})" fill="${cols[i % 6]}" opacity=".9"/>`;
  for (let i = 0; i < 8; i++) o += `<path d="M0 0 C ${r * .16} ${-r * .2} ${r * .1} ${-r * .5} 0 ${-r * .58} C ${-r * .1} ${-r * .5} ${-r * .16} ${-r * .2} 0 0Z" transform="rotate(${i * 45 + 22.5})" fill="#fff4d6"/>`;
  for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; o += `<circle cx="${(Math.cos(a) * r * 1.12).toFixed(1)}" cy="${(Math.sin(a) * r * 1.12).toFixed(1)}" r="3.2" fill="${cols[i % 6]}"/>`; }
  return o + `<circle r="${r * .16}" fill="#ffb21e"/><circle r="${r * .08}" fill="#ff3c7d"/>`;
}
function lights(width) {
  let o = `<path d="M0 4 ${Array.from({ length: Math.ceil(width / 160) }, (_, i) => `Q ${i * 160 + 80} 34 ${i * 160 + 160} 4`).join(' ')}" stroke="#2d3b2f" stroke-width="2" fill="none"/>`;
  const cols = ['#e53935', '#f6c21c', '#43a047', '#29b6f6'];
  for (let x = 20, i = 0; x < width; x += 40, i++) { const t = (x % 160) / 160, y = 4 + 4 * 30 * t * (1 - t); o += `<g transform="translate(${x} ${y + 4})"><rect x="-2.5" y="-3" width="5" height="5" fill="#2d3b2f"/><ellipse class="fd-bulb" style="animation-delay:${(i % 5) * .4}s" cy="8" rx="5" ry="8" fill="${cols[i % 4]}"/></g>`; }
  return o;
}
function tree() {
  return `<path d="M0 -120 L60 -30 H30 L80 50 H40 L96 130 H-96 L-40 50 H-80 L-30 -30 H-60Z" fill="#1f6b3a"/><path d="M-60 -30 Q 0 0 60 -30M-80 50 Q 0 84 80 50" stroke="#d9b25e" stroke-width="3" fill="none"/>
    <rect x="-12" y="130" width="24" height="24" fill="#6b3d1f"/>${[[-30, 10], [26, -12], [-50, 92], [48, 100], [6, 64], [-14, -60]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="6" fill="${['#e53935', '#f6c21c', '#29b6f6'][i % 3]}"/>`).join('')}
    <path d="M0 -150l8 19 21 1-16 13 6 20-19-11-19 11 6-20-16-13 21-1Z" fill="#f0d58f"/>`;
}
const DEFS = `<defs>${['#ff3c7d', '#ffd21e', '#16c8dc', '#8c3cdc', '#2ecc71', '#ff6a1a'].map((c) => `<radialGradient id="g-${c.slice(1)}"><stop offset="0" stop-color="${c}" stop-opacity=".95"/><stop offset=".6" stop-color="${c}" stop-opacity=".45"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join('')}
  <linearGradient id="g-flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a00"/><stop offset=".6" stop-color="#ffb800"/><stop offset="1" stop-color="#fff2a8"/></linearGradient></defs>`;

/** The fixed motifs for a look: a band along the top and one or two motifs in the corners. */
function motifs(look, o) {
  const day = o.colour || '';
  switch (look) {
    case 'uttarayan': return svg('fd-corner fd-tr', '0 0 320 360', kite(200, 80, 1.15, '#e8501f', '#ffc400', 12) + kite(80, 150, .7, '#0a8ac8', '#f0479a', -14))
      ;
    case 'tiranga': return svg('fd-top fd-wave', '0 0 2400 80', tricolourWave(), ' preserveAspectRatio="none"')
      + svg('fd-corner fd-br fd-chakra', '-60 -60 120 120', `<g class="fd-spin">${chakra(54)}</g>`);
    case 'holi': return svg('fd-corner fd-tr fd-holi', '0 0 340 300', DEFS + burst(120, 120, 80, ['#ff3c7d', '#ffd21e', '#8c3cdc']) + burst(240, 190, 60, ['#16c8dc', '#2ecc71', '#ff6a1a']))
      ;
    case 'ganesh': return svg('fd-top fd-toran', '0 0 1760 70', toran(1760), ' preserveAspectRatio="xMinYMin slice"')
      + svg('fd-corner fd-br', '-110 -70 220 130', `<ellipse cx="0" cy="40" rx="104" ry="16" fill="#c9a227"/><ellipse cx="0" cy="36" rx="96" ry="12" fill="#e8c35a"/>${modak(-52, 6, .8)}${modak(52, 6, .8)}${modak(0, -6, 1)}`);
    case 'navratri': return svg('fd-top fd-bunting', '0 0 1600 60', bunting(1600, day), ' preserveAspectRatio="none"')
      + svg('fd-corner fd-br fd-dandiya', '-150 -150 300 300', dandiya(day));
    case 'diwali': return svg('fd-corner fd-tr fd-rangoli', '-130 -130 260 260', `<g class="fd-spin-slow">${rangoli(100)}</g>`)
      + svg('fd-bottom fd-diyas', '0 0 900 80', DEFS + [60, 190, 320, 450, 580, 710, 840].map((x, i) => diya(x, 58, i % 2 ? .8 : 1)).join(''));
    case 'christmas': return svg('fd-top fd-lights', '0 0 1600 60', lights(1600), ' preserveAspectRatio="xMinYMin slice"')
      + (o.mode === 'christmas' ? svg('fd-corner fd-br', '-110 -160 220 330', tree()) : '');
    default: return '';
  }
}

// ------------------------------------------------------------------ the canvas
let layer = null, cv = null, ctx = null, look = '', opts = {}, parts = [], raf = 0, W = 0, H = 0, dpr = 1, t0 = 0, lastSpawn = 0, io = null, onScreen = true, ro = null, party = 0;

function seed() {
  parts = [];
  const area = W * H, n = (k) => Math.max(6, Math.min(k, Math.round(area / 14000 * (k / 60))));
  const add = (c, f) => { for (let i = 0; i < c; i++) parts.push(f(i)); };
  switch (look) {
    case 'uttarayan': add(Math.min(7, Math.max(3, Math.round(W / 220))), () => ({ k: 'kite', x: rnd(0, W), y: rnd(H * .05, H * .55), s: rnd(.25, .55), vx: rnd(.06, .2) * (Math.random() < .5 ? -1 : 1), ph: rnd(0, 6), a: pick(['#e8501f', '#0a8ac8', '#f0479a', '#2e9e4f', '#8c3cdc']), b: pick(['#ffc400', '#ffffff', '#ff8a00']) })); break;
    case 'tiranga': add(n(40), () => petal(['#ff9933', '#ffffff', '#138808'])); break;
    case 'ganesh': add(n(44), () => petal(['#f28c0f', '#ffb21e', '#f7a10a', '#d84315'])); break;
    case 'holi': add(n(30), () => ({ k: 'speck', x: rnd(0, W), y: rnd(0, H), r: rnd(1, 3.2), c: pick(['#ff3c7d', '#ffd21e', '#16c8dc', '#8c3cdc', '#2ecc71']), vy: rnd(-.15, -.05), vx: rnd(-.1, .1) })); break;
    case 'navratri': add(n(44), () => ({ k: 'glint', x: rnd(0, W), y: rnd(0, H), s: rnd(2, 5), ph: rnd(0, 6), sp: rnd(.6, 1.6), c: pick(opts.colour ? [opts.colour, '#ffd166', '#ffffff'] : ['#ffd166', '#ff3ca0', '#00beb4', '#ffffff']) })); break;
    case 'diwali': add(n(40), () => ember()); add(n(30), () => star()); break;
    case 'christmas':
      add(n(50), () => star());
      if (opts.mode !== 'newyear') add(n(70), () => ({ k: 'snow', x: rnd(0, W), y: rnd(-H, H), r: rnd(1, 3.2), vy: rnd(.25, .8), ph: rnd(0, 6) }));
      break;
  }
}
function petal(cols) { return { k: 'petal', x: rnd(0, W), y: rnd(-H, H), w: rnd(4, 8), h: rnd(2.5, 4.5), rot: rnd(0, 6), vr: rnd(-.03, .03), vy: rnd(.35, .9), ph: rnd(0, 6), c: pick(cols) }; }
function ember() { return { k: 'ember', x: rnd(0, W), y: rnd(0, H), r: rnd(.8, 2.2), vy: rnd(-.6, -.2), ph: rnd(0, 6), c: pick(['#ffb800', '#ff8a00', '#ffe08a']) }; }
function star() { return { k: 'star', x: rnd(0, W), y: rnd(0, H * .7), s: rnd(.6, 1.8), ph: rnd(0, 6), sp: rnd(.5, 1.5) }; }
function firework(x, y) {
  const cols = pick([['#ffd166', '#ff6a1a'], ['#ff3c7d', '#ffffff'], ['#16c8dc', '#ffd166'], ['#8c3cdc', '#ff3c7d'], ['#2ecc71', '#ffd166']]);
  const n = 46 + Math.floor(Math.random() * 20);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, v = rnd(1.4, 3.2); parts.push({ k: 'fw', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: cols[i % 2] }); }
}
function puff() {
  parts.push({ k: 'puff', x: rnd(W * .05, W * .95), y: rnd(H * .1, H * .9), r: 4, max: rnd(50, 110), life: 1, c: pick(['#ff3c7d', '#ffd21e', '#16c8dc', '#8c3cdc', '#2ecc71', '#ff6a1a']) });
}

function draw(now) {
  const t = (now - t0) / 1000;
  ctx.clearRect(0, 0, W, H);
  const still = reduce();
  // new things that appear from time to time
  if (!still) {
    if (look === 'holi' && now - lastSpawn > 1100) { puff(); lastSpawn = now; }
    const fwEvery = party > now ? 380 : opts.mode === 'newyear' ? 1600 : look === 'diwali' ? 4200 : 0;
    if (fwEvery && now - lastSpawn > fwEvery) { firework(rnd(W * .15, W * .85), rnd(H * .12, H * .5)); lastSpawn = now; }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    switch (p.k) {
      case 'kite': {
        if (!still) { p.x += p.vx; if (p.x < -80) p.x = W + 80; if (p.x > W + 80) p.x = -80; }
        const sway = Math.sin(t * .9 + p.ph) * 8, x = p.x, y = p.y + sway, s = p.s * 48;
        ctx.strokeStyle = 'rgba(80,80,80,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + s * 1.3); ctx.quadraticCurveTo(x + 40, y + H * .4, x - 30 + sway, H + 10); ctx.stroke();
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.2 + p.ph) * .12);
        ctx.fillStyle = p.a; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * .75, 0); ctx.lineTo(0, s * 1.3); ctx.lineTo(-s * .75, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = p.b; ctx.globalAlpha = .9; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * .75, 0); ctx.lineTo(0, s * 1.3); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s * 1.3); ctx.moveTo(-s * .75, 0); ctx.lineTo(s * .75, 0); ctx.stroke();
        ctx.restore(); break;
      }
      case 'petal': {
        if (!still) { p.y += p.vy; p.x += Math.sin(t + p.ph) * .4; p.rot += p.vr; if (p.y > H + 10) { p.y = -10; p.x = rnd(0, W); } }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(t * 1.5 + p.ph)) * .7 + .3);
        ctx.fillStyle = p.c; ctx.globalAlpha = .85; ctx.beginPath(); ctx.ellipse(0, 0, p.w, p.h, 0, 0, Math.PI * 2); ctx.fill();
        if (p.c === '#ffffff') { ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.stroke(); }
        ctx.restore(); ctx.globalAlpha = 1; break;
      }
      case 'speck': {
        if (!still) { p.y += p.vy; p.x += p.vx; if (p.y < -5) { p.y = H + 5; p.x = rnd(0, W); } }
        ctx.fillStyle = p.c; ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
      }
      case 'puff': {
        p.r += (p.max - p.r) * .05; p.life -= .006;
        if (p.life <= 0) { parts.splice(i, 1); break; }
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, p.c); g.addColorStop(1, 'transparent');
        ctx.globalAlpha = p.life * .45; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
      }
      case 'glint': {
        const a = still ? .8 : .25 + .75 * Math.abs(Math.sin(t * p.sp + p.ph));
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); ctx.restore(); ctx.globalAlpha = 1; break;
      }
      case 'ember': {
        if (!still) { p.y += p.vy; p.x += Math.sin(t * 2 + p.ph) * .3; if (p.y < -5) { p.y = H + 5; p.x = rnd(0, W); } }
        ctx.globalAlpha = .4 + .5 * Math.abs(Math.sin(t * 3 + p.ph)); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
      }
      case 'star': {
        const a = still ? .7 : .2 + .8 * Math.abs(Math.sin(t * p.sp + p.ph));
        ctx.globalAlpha = a; ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill();
        if (p.s > 1.4) { ctx.strokeStyle = '#fff6dc'; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(p.x - p.s * 3, p.y); ctx.lineTo(p.x + p.s * 3, p.y); ctx.moveTo(p.x, p.y - p.s * 3); ctx.lineTo(p.x, p.y + p.s * 3); ctx.stroke(); }
        ctx.globalAlpha = 1; break;
      }
      case 'snow': {
        if (!still) { p.y += p.vy; p.x += Math.sin(t * .8 + p.ph) * .35; if (p.y > H + 5) { p.y = -5; p.x = rnd(0, W); } }
        ctx.globalAlpha = .8; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
      }
      case 'fw': {
        if (!still) { p.x += p.vx; p.y += p.vy; p.vx *= .985; p.vy = p.vy * .985 + .03; p.life -= .012; }
        if (p.life <= 0) { parts.splice(i, 1); break; }
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = Math.max(0, p.life) * .35; ctx.beginPath(); ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, 1.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
      }
    }
  }
}
function loop(now) { raf = 0; if (!cv) return; draw(now); if (!reduce() && onScreen && !document.hidden) raf = requestAnimationFrame(loop); }
function wake() { if (cv && !raf && !reduce() && onScreen && !document.hidden) raf = requestAnimationFrame(loop); }
function size() {
  if (!cv) return;
  const r = layer.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (w === W && h === H) return;
  W = w; H = h; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); seed();
  if (reduce()) still();
}
function still() {
  // one calm frame: everything placed, a few fireworks frozen mid-burst on the big night
  if (opts.mode === 'newyear' || party) { for (let i = 0; i < 3; i++) { firework(W * (.25 + i * .25), H * (.25 + (i % 2) * .15)); } for (const p of parts) if (p.k === 'fw') { p.x += p.vx * 18; p.y += p.vy * 18; p.life = .8; } }
  draw(performance.now());
}
document.addEventListener('visibilitychange', wake);

function unmount() {
  if (raf) cancelAnimationFrame(raf); raf = 0;
  if (io) io.disconnect(); io = null;
  if (ro) ro.disconnect(); ro = null;
  if (layer) layer.textContent = '';
  layer = null; cv = null; ctx = null; parts = []; W = H = 0; party = 0;
}
function mount(el, lk, o = {}) {
  unmount();
  layer = el; look = lk; opts = o; t0 = performance.now(); lastSpawn = 0;
  el.innerHTML = motifs(lk, o);
  cv = document.createElement('canvas'); cv.className = 'fd-canvas'; cv.setAttribute('aria-hidden', 'true');
  el.appendChild(cv);
  ctx = cv.getContext('2d');
  if (!ctx) { cv.remove(); cv = null; return; }
  size();
  try { ro = new ResizeObserver(() => { size(); wake(); }); ro.observe(el); } catch { window.addEventListener('resize', size); }
  try { io = new IntersectionObserver((e) => { onScreen = e[0].isIntersecting; wake(); }); io.observe(el); } catch { /* always on */ }
  if (reduce()) still(); else wake();
}
/** Midnight on New Year's Eve: a sky full of fireworks for a few seconds (one still burst with reduced motion). */
function celebrate(ms = 9000) {
  if (!cv) return;
  party = performance.now() + ms;
  if (reduce()) still(); else wake();
}

window.DajiFestive = { mount, unmount, celebrate };
})();
