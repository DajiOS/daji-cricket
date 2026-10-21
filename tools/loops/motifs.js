// The hero background films, drawn in code (no stock footage). Each motif draws one frame of a seamless loop: t runs from 0 to 1
// and every movement is periodic in t, so frame 0 follows the last frame without a jump. Everything is light on black: the website
// lays the film over the page with mix-blend-mode screen at night, and inverted with multiply by day (site.css, .hero-loop).
// Rendered by tools/loops/render.mjs in headless Chromium and encoded with ffmpeg.
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  /** The same random numbers every time, so a film is the same film each render. */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const wrap = (v, m) => ((v % m) + m) % m;
  function glow(c, x, y, r, col, a) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  /** Particles drifting by whole screen-lengths over a loop, so they come back to where they started. */
  function motes(c, t, W, H, o) {
    const r = rng(o.seed || 7);
    for (let i = 0; i < o.n; i++) {
      const x0 = r() * W, y0 = r() * H, sp = 1 + Math.floor(r() * (o.laps || 2)), size = o.min + r() * (o.max - o.min), ph = r();
      const x = wrap(x0 + (o.dx || 0) * sp * t * W, W + 40) - 20, y = wrap(y0 + (o.dy || 0) * sp * t * H, H + 40) - 20;
      const tw = o.twinkle ? 0.5 + 0.5 * Math.sin(TAU * (t * (1 + Math.floor(r() * 3)) + ph)) : 1;
      glow(c, x + (o.sway ? Math.sin(TAU * (t + ph)) * o.sway : 0), y, size, o.cols[i % o.cols.length], (o.alpha || 0.8) * tw);
    }
  }
  function beam(c, x, y, ang, len, w, col, a) {
    c.save(); c.translate(x, y); c.rotate(ang);
    const g = c.createLinearGradient(0, 0, 0, len); g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g; c.beginPath(); c.moveTo(-w * 0.08, 0); c.lineTo(w * 0.08, 0); c.lineTo(w, len); c.lineTo(-w, len); c.closePath(); c.fill(); c.restore();
  }
  function kite(c, x, y, s, col, rot, tail) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = rgba(col, 0.9); c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.75, 0); c.lineTo(0, s * 1.1); c.lineTo(-s * 0.75, 0); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, -s); c.lineTo(0, s * 1.1); c.moveTo(-s * 0.75, 0); c.lineTo(s * 0.75, 0); c.stroke();
    c.strokeStyle = rgba(col, 0.6); c.beginPath(); c.moveTo(0, s * 1.1);
    for (let k = 1; k <= 6; k++) c.lineTo(Math.sin(tail + k) * s * 0.25, s * 1.1 + k * s * 0.35);
    c.stroke(); c.restore();
  }
  function petal(c, x, y, s, rot, col) { c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = rgba(col, 0.85); c.beginPath(); c.ellipse(0, 0, s, s * 0.45, 0, 0, TAU); c.fill(); c.restore(); }
  function falling(c, t, W, H, o, draw) {
    const r = rng(o.seed);
    for (let i = 0; i < o.n; i++) {
      const x0 = r() * W, y0 = r() * H, laps = 1 + Math.floor(r() * 2), ph = r(), s = o.min + r() * (o.max - o.min);
      const y = wrap(y0 + (o.up ? -1 : 1) * laps * t * (H + 60), H + 60) - 30, x = x0 + Math.sin(TAU * (t * laps + ph)) * (o.sway || 20);
      draw(x, y, s, TAU * (t * laps + ph), i);
    }
  }

  const M = {
    // ---- Opening season (Oct to Dec 2026)
    noir: (c, t, W, H) => { // floodlight beams sweeping over the ground, dust in the light
      for (const [x, ph] of [[W * 0.18, 0], [W * 0.82, 0.5]]) beam(c, x, -20, Math.sin(TAU * (t + ph)) * 0.22 + (x < W / 2 ? -0.35 : 0.35), H * 1.3, W * 0.16, '#fff3d8', 0.22);
      motes(c, t, W, H, { n: 90, min: 1.2, max: 3.2, dx: 0.5, dy: 0.25, cols: ['#ecd49a', '#fff3d8'], twinkle: true, alpha: 0.7 });
    },
    pavilion: (c, t, W, H) => { // slow rings opening out from the pavilion clock, gold motes
      for (let k = 0; k < 6; k++) { const r = wrap(t + k / 6, 1) * Math.max(W, H) * 0.9; c.strokeStyle = rgba('#dcc289', 0.35 * (1 - r / (Math.max(W, H) * 0.9))); c.lineWidth = 1.5; c.beginPath(); c.arc(W / 2, H * 0.3, r, 0, TAU); c.stroke(); }
      motes(c, t, W, H, { n: 50, min: 1.5, max: 3, dy: -1, sway: 14, cols: ['#efdcae'], seed: 11, alpha: 0.6 });
    },
    whites: (c, t, W, H) => { // Test-match calm: a red ball's seam drifting, chalk-white light lines
      for (let k = 0; k < 5; k++) { const y = H * (0.15 + k * 0.17) + Math.sin(TAU * (t + k * 0.2)) * 10; const g = c.createLinearGradient(0, 0, W, 0); const p = wrap(t + k * 0.23, 1); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(Math.max(0, p - 0.15), 'rgba(255,255,255,0)'); g.addColorStop(p, 'rgba(255,255,255,.35)'); g.addColorStop(Math.min(1, p + 0.15), 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, y, W, 1.5); }
      motes(c, t, W, H, { n: 30, min: 1, max: 2.5, dx: 1, cols: ['#ff6a5c', '#ffffff'], seed: 5, alpha: 0.6 });
    },
    pinkball: (c, t, W, H) => { // a night sky: twinkling stars and a pink comet crossing
      motes(c, t, W, H, { n: 160, min: 0.6, max: 2, cols: ['#ffffff', '#e6e9ff'], twinkle: true, seed: 3, alpha: 0.9 });
      for (const ph of [0, 0.5]) { const u = wrap(t * 2 + ph, 1), x = -100 + u * (W + 200), y = H * 0.25 + u * H * 0.3; const g = c.createLinearGradient(x - 160, y - 48, x, y); g.addColorStop(0, rgba('#ff7ab6', 0)); g.addColorStop(1, rgba('#ff7ab6', 0.8)); c.strokeStyle = g; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x - 160, y - 48); c.lineTo(x, y); c.stroke(); glow(c, x, y, 10, '#ffc2dc', 0.9); }
    },
    monsoon: (c, t, W, H) => { // rain on glass and ripples on the outfield
      const r = rng(17);
      c.strokeStyle = rgba('#bfeee4', 0.45); c.lineWidth = 1.2;
      for (let i = 0; i < 140; i++) { const x = r() * W, y0 = r() * H, laps = 3 + Math.floor(r() * 3), y = wrap(y0 + laps * t * H, H + 40) - 20, l = 10 + r() * 18; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y + l); c.stroke(); }
      for (let i = 0; i < 12; i++) { const x = r() * W, y = H * 0.55 + r() * H * 0.45, ph = r(), u = wrap(t * 2 + ph, 1); c.strokeStyle = rgba('#7fd6c3', 0.5 * (1 - u)); c.beginPath(); c.ellipse(x, y, u * 40, u * 12, 0, 0, TAU); c.stroke(); }
    },
    maroon: (c, t, W, H) => { // light passing through a palace jali
      const s = 56, sh = wrap(t, 1) * (W + 400) - 200;
      for (let y = 0; y < H + s; y += s) for (let x = 0; x < W + s; x += s) { const d = Math.abs(x - sh - (y - H / 2) * 0.4), a = Math.max(0, 1 - d / 220) * 0.55 + 0.05; c.strokeStyle = rgba('#e4bb6a', a); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - s / 2 + 4); c.lineTo(x + s / 2 - 4, y); c.lineTo(x, y + s / 2 - 4); c.lineTo(x - s / 2 + 4, y); c.closePath(); c.stroke(); c.beginPath(); c.arc(x, y, 8, 0, TAU); c.stroke(); }
    },
    carbon: (c, t, W, H) => { // a T20 broadcast: grid, a scan line and ticking speed readouts
      c.strokeStyle = rgba('#9fd8ff', 0.12); c.lineWidth = 1;
      for (let x = 0; x < W; x += 48) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      for (let y = 0; y < H; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      const y = wrap(t * 2, 1) * H; const g = c.createLinearGradient(0, y - 60, 0, y); g.addColorStop(0, rgba('#9fd8ff', 0)); g.addColorStop(1, rgba('#9fd8ff', 0.4)); c.fillStyle = g; c.fillRect(0, y - 60, W, 60);
      const r = rng(23); c.fillStyle = rgba('#cfeaff', 0.8); c.font = '600 14px monospace';
      for (let i = 0; i < 8; i++) { const x = r() * W * 0.9, yy = r() * H * 0.9 + 20, ph = r(); if (Math.sin(TAU * (t * 2 + ph)) > 0) c.fillText(`${(128 + Math.floor(r() * 25))} km/h`, x, yy); }
    },
    champagne: (c, t, W, H) => { // bubbles rising in a glass
      falling(c, t, W, H, { n: 70, min: 2, max: 7, up: true, sway: 8, seed: 29 }, (x, y, s) => { c.strokeStyle = rgba('#f2e2c2', 0.7); c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, s, 0, TAU); c.stroke(); glow(c, x - s * 0.3, y - s * 0.3, s * 0.6, '#ffffff', 0.5); });
    },
    stadium: (c, t, W, H) => { // floodlight towers flaring and the crowd's phone lights
      for (const x of [W * 0.12, W * 0.38, W * 0.62, W * 0.88]) { const f = 0.75 + 0.25 * Math.sin(TAU * (t * 2 + x / W)); glow(c, x, 40, 120, '#fff7dc', 0.35 * f); for (let k = 0; k < 4; k++) glow(c, x - 30 + k * 20, 40, 10, '#ffffff', 0.9 * f); }
      motes(c, t, W, H, { n: 120, min: 1, max: 2.2, cols: ['#ffcb3d', '#ffffff', '#4f7dff'], twinkle: true, seed: 31, alpha: 0.75 });
    },
    willow: (c, t, W, H) => { // leather seams stitched across the frame, warm dust
      const r = rng(37);
      for (let i = 0; i < 6; i++) { const y = r() * H, ph = r(); c.strokeStyle = rgba('#dca66b', 0.35); c.lineWidth = 2; c.setLineDash([8, 7]); c.lineDashOffset = -t * 15 * 8; c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(W * 0.3, y + Math.sin(TAU * (t + ph)) * 40, W * 0.7, y - 40, W, y + 10); c.stroke(); }
      c.setLineDash([]);
      motes(c, t, W, H, { n: 60, min: 1.2, max: 3, dx: 0.5, cols: ['#ecc392'], seed: 41, alpha: 0.6 });
    },
    // ---- Winter season (Jan to Mar 2027)
    mist: (c, t, W, H) => { for (let k = 0; k < 7; k++) { const x = wrap(k / 7 + t * (k % 2 ? 1 : -1), 1) * (W + 600) - 300, y = H * (0.2 + (k % 4) * 0.2); glow(c, x, y, 300, '#e6f2f8', 0.18); } },
    scorebook: (c, t, W, H) => { // ruled lines, and a pencil adding fives to the tally
      c.strokeStyle = rgba('#a0b9ff', 0.18); for (let y = 30; y < H; y += 36) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.strokeStyle = rgba('#ffffff', 0.8); c.lineWidth = 2; const n = Math.floor(t * 30);
      for (let i = 0; i < n; i++) { const g = Math.floor(i / 5), k = i % 5, x = 80 + (g % 6) * 120 + k * 14, y = 102 + Math.floor(g / 6) * 72; c.beginPath(); if (k < 4) { c.moveTo(x, y); c.lineTo(x, y + 28); } else { c.moveTo(x - 62, y + 22); c.lineTo(x - 2, y + 6); } c.stroke(); }
    },
    sunrise: (c, t, W, H) => { c.save(); c.translate(W * 0.8, H * 0.2); c.rotate(TAU * t / 12); for (let k = 0; k < 12; k++) { c.rotate(TAU / 12); beam(c, 0, 0, 0, W, 40, '#ffb38a', 0.12); } c.restore(); glow(c, W * 0.8, H * 0.2, 120, '#ffd3a8', 0.8); },
    azure: (c, t, W, H) => { const r = rng(43), cols = ['#3c9cff', '#ff5a3c', '#ffd23c', '#30c39e']; for (let i = 0; i < 9; i++) { const x0 = r() * W, y0 = r() * H * 0.7 + 30, s = 14 + r() * 16, ph = r(); kite(c, x0 + Math.sin(TAU * (t + ph)) * 30, y0 + Math.sin(TAU * (t * 2 + ph)) * 14, s, cols[i % 4], Math.sin(TAU * (t + ph)) * 0.25, TAU * (t * 2 + ph)); } },
    terracotta: (c, t, W, H) => { const sh = wrap(t, 1) * (W + 600) - 300; for (let y = H; y > 0; y -= 26) for (let x = 0; x < W; x += 52) { const d = Math.abs(x - sh), a = Math.max(0, 1 - d / 260) * 0.5 + 0.04; c.strokeStyle = rgba('#f3c29b', a); c.beginPath(); c.moveTo(x, y); c.lineTo(x + 26, y); c.lineTo(x + 26, y - 26); c.lineTo(x + 52, y - 26); c.stroke(); } },
    mango: (c, t, W, H) => { const r = rng(47); for (let i = 0; i < 40; i++) { const x = r() * W, y = r() * H, s = 30 + r() * 60, ph = r(); glow(c, x + Math.sin(TAU * (t + ph)) * 20, y + Math.cos(TAU * (t + ph)) * 10, s, '#ffd370', 0.12 + 0.1 * Math.sin(TAU * (t * 2 + ph))); } },
    dusk: (c, t, W, H) => { const g = c.createLinearGradient(0, H * 0.4, 0, H); g.addColorStop(0, 'rgba(255,168,74,0)'); g.addColorStop(0.5, rgba('#ffa84a', 0.25 + 0.08 * Math.sin(TAU * t))); g.addColorStop(1, 'rgba(255,120,80,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      const r = rng(53); c.strokeStyle = rgba('#ffd9a8', 0.7); c.lineWidth = 1.6; for (let i = 0; i < 7; i++) { const x = wrap(r() * W + t * (W + 100), W + 100) - 50, y = H * 0.2 + r() * H * 0.3, f = Math.sin(TAU * (t * 6 + r())) * 5; c.beginPath(); c.moveTo(x - 8, y + f); c.quadraticCurveTo(x - 4, y - 3, x, y); c.quadraticCurveTo(x + 4, y - 3, x + 8, y + f); c.stroke(); } },
    scoreboard: (c, t, W, H) => { // a dot-matrix board counting runs
      const runs = 140 + Math.floor(t * 24), txt = `${runs}/4`, D = 9, cols = 5;
      const font = { 0: '0x1F,0x11,0x11,0x11,0x1F', 1: '0x04,0x0C,0x04,0x04,0x0E', 2: '0x1F,0x01,0x1F,0x10,0x1F', 3: '0x1F,0x01,0x0F,0x01,0x1F', 4: '0x11,0x11,0x1F,0x01,0x01', 5: '0x1F,0x10,0x1F,0x01,0x1F', 6: '0x1F,0x10,0x1F,0x11,0x1F', 7: '0x1F,0x01,0x02,0x04,0x04', 8: '0x1F,0x11,0x1F,0x11,0x1F', 9: '0x1F,0x11,0x1F,0x01,0x1F', '/': '0x01,0x02,0x04,0x08,0x10' };
      for (let y = 0; y < H; y += D * 2) for (let x = 0; x < W; x += D * 2) { c.fillStyle = rgba('#ffb000', 0.07); c.beginPath(); c.arc(x, y, 2, 0, TAU); c.fill(); }
      let ox = W * 0.5 - 270; const oy = H * 0.36;
      for (const ch of txt) { const rows = font[ch].split(',').map(Number); rows.forEach((bits, ry) => { for (let cx = 0; cx < cols; cx++) if (bits & (1 << (cols - 1 - cx))) { glow(c, ox + cx * D * 2, oy + ry * D * 2, 9, '#ffb000', 0.9); } }); ox += (cols + 1) * D * 2; }
    },
    aurora: (c, t, W, H) => { for (let k = 0; k < 3; k++) { c.beginPath(); for (let x = 0; x <= W; x += 10) { const y = H * (0.18 + k * 0.08) + Math.sin(TAU * (x / W * 1.5 + t + k * 0.3)) * 40; if (x === 0) c.moveTo(x, y); else c.lineTo(x, y); } c.lineTo(W, 0); c.lineTo(0, 0); c.closePath(); const g = c.createLinearGradient(0, 0, 0, H * 0.5); g.addColorStop(0, rgba(k === 1 ? '#a98bff' : '#6ef0c8', 0)); g.addColorStop(1, rgba(k === 1 ? '#a98bff' : '#6ef0c8', 0.22)); c.fillStyle = g; c.fill(); }
      motes(c, t, W, H, { n: 90, min: 0.6, max: 1.6, cols: ['#ffffff'], twinkle: true, seed: 59, alpha: 0.8 }); },
    ember: (c, t, W, H) => { glow(c, W / 2, H + 80, 420, '#ff6a2b', 0.35 + 0.05 * Math.sin(TAU * t * 3)); falling(c, t, W, H, { n: 80, min: 1, max: 3, up: true, sway: 24, seed: 61 }, (x, y, s) => glow(c, x, y, s * 2.4, y > H * 0.5 ? '#ffb000' : '#ff6a2b', 0.9 * (y / H))); },
    // ---- Festival looks
    uttarayan: (c, t, W, H) => { const r = rng(67), cols = ['#e8501f', '#ffd23c', '#0a8ac8', '#e0218a', '#30c39e']; for (let i = 0; i < 14; i++) { const x0 = r() * W, y0 = r() * H * 0.75 + 20, s = 12 + r() * 18, ph = r(); kite(c, x0 + Math.sin(TAU * (t + ph)) * 36, y0 + Math.sin(TAU * (t * 2 + ph)) * 16, s, cols[i % 5], Math.sin(TAU * (t + ph)) * 0.3, TAU * (t * 2 + ph)); } },
    tiranga: (c, t, W, H) => { const bands = [['#ff9933', 0.25], ['#ffffff', 0.45], ['#138808', 0.65]];
      for (const [col, yy] of bands) { c.beginPath(); for (let x = 0; x <= W; x += 8) { const y = H * yy + Math.sin(TAU * (x / W + t)) * 18; if (x === 0) c.moveTo(x, y); else c.lineTo(x, y); } c.strokeStyle = rgba(col, 0.55); c.lineWidth = 22; c.stroke(); }
      c.save(); c.translate(W / 2, H * 0.45 + Math.sin(TAU * (0.5 + t)) * 18); c.rotate(TAU * t / 4); c.strokeStyle = rgba('#4d6bff', 0.8); c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 26, 0, TAU); c.stroke(); for (let k = 0; k < 24; k++) { c.rotate(TAU / 24); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 26); c.stroke(); } c.restore(); },
    holi: (c, t, W, H) => { const r = rng(71), cols = ['#f0479a', '#ffc800', '#00bedc', '#8c3cdc', '#3cdc6e']; for (let i = 0; i < 8; i++) { const x = r() * W, y = r() * H, ph = r(), u = wrap(t * 2 + ph, 1), col = cols[i % 5]; for (let k = 0; k < 18; k++) { const a = r() * TAU, d = u * (60 + r() * 90); glow(c, x + Math.cos(a) * d, y + Math.sin(a) * d, 18 + u * 30, col, 0.35 * (1 - u)); } } },
    ganesh: (c, t, W, H) => { falling(c, t, W, H, { n: 60, min: 5, max: 10, sway: 30, seed: 73 }, (x, y, s, rot, i) => petal(c, x, y, s, rot, i % 3 ? '#ffa21a' : '#ffd23c')); glow(c, W / 2, H * 0.15, 160, '#ffb547', 0.25); },
    navratri: (c, t, W, H) => { for (let ring = 0; ring < 3; ring++) { const n = 10 + ring * 4, R = 80 + ring * 70; for (let k = 0; k < n; k++) { const a = TAU * (k / n + t * (ring % 2 ? -1 : 1) / (ring + 1)), x = W / 2 + Math.cos(a) * R * 1.6, y = H / 2 + Math.sin(a) * R * 0.6; glow(c, x, y, 7, ['#ffb703', '#ff3ca0', '#00beb4'][ring], 0.9); } } },
    diwali: (c, t, W, H) => { const r = rng(79); for (let i = 0; i < 4; i++) { const x = W * (0.15 + i * 0.23 + r() * 0.05), y = H * (0.2 + r() * 0.25), ph = i / 4, u = wrap(t * 2 + ph, 1); for (let k = 0; k < 48; k++) { const a = TAU * k / 48, d = u * 130; glow(c, x + Math.cos(a) * d, y + Math.sin(a) * d + u * u * 30, 7, k % 2 ? '#ffd27a' : '#ff8a3c', 1 - u); } }
      for (let i = 0; i < 9; i++) { const x = W * (0.06 + i * 0.11), y = H - 30, f = 0.8 + 0.2 * Math.sin(TAU * (t * 4 + i * 0.3)); glow(c, x, y - 12, 26 * f, '#ffc94d', 0.8); } },
    christmas: (c, t, W, H) => { falling(c, t, W, H, { n: 120, min: 1.2, max: 3.2, sway: 18, seed: 83 }, (x, y, s) => glow(c, x, y, s * 1.6, '#ffffff', 0.85)); motes(c, t, W, H * 0.4, { n: 30, min: 1, max: 2, cols: ['#d9b25e'], twinkle: true, seed: 89, alpha: 0.9 }); },
  };
  window.LOOPS = M;
  window.drawLoop = function (name, t, W, H, c) { c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'lighter'; M[name](c, t, W, H); c.globalCompositeOperation = 'source-over'; };
})();
