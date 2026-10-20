/* The Daji ball in 3D for the home page: half white and half red, a straight seam where the halves meet and three rows
   of stitching on the red side, as in the logo (shared/src/ball.ts). It is lit and drawn pixel by pixel on a canvas, so no
   3D library is needed. Every <canvas data-ball3d> gets one. It pauses off screen and stands still for reduced motion. */
(function () {
  'use strict';
  var WHITE = [247, 241, 227], RED = [179, 38, 30], SEAM = [92, 24, 16], THREAD = [251, 233, 214];
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // sRGB <-> linear, so the lighting adds up like real light
  function lin(c) { return c.map(function (v) { return Math.pow(v / 255, 2.2); }); }
  var W = lin(WHITE), R = lin(RED), S = lin(SEAM), T = lin(THREAD);
  var OUT = new Uint8ClampedArray(4097);
  for (var i = 0; i <= 4096; i++) OUT[i] = Math.round(Math.pow(i / 4096, 1 / 2.2) * 255);
  function enc(v) { return OUT[v >= 1 ? 4096 : v <= 0 ? 0 : (v * 4096) | 0]; }

  // key light from the upper left, a soft fill from the right; the viewer looks down -z
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
  var KEY = norm([-0.5, 0.62, 0.62]), FILL = norm([0.8, -0.1, 0.5]), HK = norm([KEY[0], KEY[1], KEY[2] + 1]);
  var TAU = Math.PI * 2, STITCHES = 52;
  function mul(a, b) { return a.map(function (r) { return [0, 1, 2].map(function (j) { return r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]; }); }); }

  function Ball(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.t = Math.random() * 10; this.on = false; this.last = 0;
    this.size(); var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.size(); self.draw(); }).observe(cv);
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { self.vis = e[0].isIntersecting; self.kick(); }).observe(cv); else this.vis = true;
    document.addEventListener('visibilitychange', function () { self.kick(); });
    this.draw();
  }
  Ball.prototype.size = function () {
    var css = Math.max(40, Math.round(this.cv.clientWidth || 200));
    var n = Math.min(360, Math.round(css * Math.min(window.devicePixelRatio || 1, 1.6)));
    if (n === this.n) return;
    this.n = n; this.cv.width = this.cv.height = n; this.img = this.ctx.createImageData(n, n);
    // the view-space normal of every pixel on the disc never changes; work it out once
    var r = n / 2 - 1, m = [], k = 0;
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var nx = (x + 0.5 - n / 2) / r, ny = -(y + 0.5 - n / 2) / r, d = nx * nx + ny * ny;
      if (d >= 1.0 + 2 / r) continue;
      var dd = Math.min(d, 0.9999), nz = Math.sqrt(1 - dd), a = Math.max(0, Math.min(1, (1 - Math.sqrt(d)) * r + 0.5));
      m.push((y * n + x) * 4, nx, ny, nz, a); k++;
    }
    this.px = new Float32Array(m); this.count = k;
  };
  Ball.prototype.kick = function () {
    var run = !reduce && this.vis && !document.hidden;
    if (run && !this.on) { this.on = true; this.last = 0; var self = this; requestAnimationFrame(function f(ts) { if (!self.on) return; if (self.last) self.t += Math.min(0.05, (ts - self.last) / 1000); self.last = ts; self.draw(); requestAnimationFrame(f); }); }
    if (!run) this.on = false;
  };
  Ball.prototype.draw = function () {
    var t = reduce ? 0.9 : this.t, d = this.img.data, p = this.px;
    d.fill(0);
    // rock left and right so both halves always show, while the ball rolls along its seam
    var yaw = Math.sin(t * 0.45) * 0.75, tilt = 0.3 + Math.sin(t * 0.4) * 0.06, roll = 0.22, spin = t * 1.1, cs = Math.cos(spin), ss = Math.sin(spin);
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(tilt), sx = Math.sin(tilt), cz = Math.cos(roll), sz = Math.sin(roll);
    // M = Rz * Rx * Ry * Rseam (ball to view); a view normal goes back into the ball with the transpose
    var M = mul(mul(mul([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]), [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]), [[1, 0, 0], [0, cs, -ss], [0, ss, cs]]);
    var m00 = M[0][0], m01 = M[0][1], m02 = M[0][2], m10 = M[1][0], m11 = M[1][1], m12 = M[1][2], m20 = M[2][0], m21 = M[2][1], m22 = M[2][2];
    for (var i = 0; i < p.length; i += 5) {
      var o = p[i], nx = p[i + 1], ny = p[i + 2], nz = p[i + 3], a = p[i + 4];
      var bx = m00 * nx + m10 * ny + m20 * nz, by = m01 * nx + m11 * ny + m21 * nz, bz = m02 * nx + m12 * ny + m22 * nz;
      var c = bx > 0 ? W : R, gloss = bx > 0 ? 0.32 : 0.5, bump = 0;
      var s = -bx;
      if (bx > -0.016 && bx < 0.016) { c = S; bump = -0.25; gloss = 0.15; } // the groove where the halves meet
      else if (s > 0.03 && s < 0.125) { // three rows of stitches on the red side
        var row = s < 0.058 ? 0 : s < 0.09 ? 1 : 2, rc = row === 0 ? 0.044 : row === 1 ? 0.074 : 0.106;
        if (Math.abs(s - rc) < 0.0095) {
          var f = (Math.atan2(by, bz) / TAU * STITCHES + row * 0.5) % 1; if (f < 0) f += 1;
          if (f < 0.55) { c = T; bump = 0.18; gloss = 0.2; }
        }
      }
      // leather grain
      var g = Math.sin(bx * 91.7 + by * 57.3) * Math.sin(by * 83.1 - bz * 61.9) * Math.sin(bz * 77.7 + bx * 49.1);
      var grain = 1 + g * 0.05;
      var lnx = nx, lny = ny + bump * 0.2, lnz = nz;
      var dk = lnx * KEY[0] + lny * KEY[1] + lnz * KEY[2], df = lnx * FILL[0] + lny * FILL[1] + lnz * FILL[2];
      var light = 0.16 + 0.95 * (dk > 0 ? dk : 0) + 0.22 * (df > 0 ? df : 0);
      var h = lnx * HK[0] + lny * HK[1] + lnz * HK[2]; h = h > 0 ? h : 0;
      var h2 = h * h, h4 = h2 * h2, h8 = h4 * h4, h16 = h8 * h8, h64 = h16 * h16 * h16 * h16;
      var spec = gloss * (h64 * 0.9 + h8 * 0.06);
      var rim = Math.pow(1 - nz, 3) * 0.18;
      var occl = 0.55 + 0.45 * (ny + 1) / 2; // a touch darker underneath
      d[o] = enc((c[0] * light * grain * occl) + spec + rim * 0.6);
      d[o + 1] = enc((c[1] * light * grain * occl) + spec + rim * 0.55);
      d[o + 2] = enc((c[2] * light * grain * occl) + spec + rim * 0.5);
      d[o + 3] = a * 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  };

  function start() { Array.prototype.forEach.call(document.querySelectorAll('canvas[data-ball3d]'), function (cv) { if (!cv._ball && cv.getContext) cv._ball = new Ball(cv); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.DajiBall3D = { start: start };
})();
