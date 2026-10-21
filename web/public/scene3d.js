/* The 3D scene behind the home headline for the ten designer themes, as in the design concepts: the Daji ball (half white,
   half red, three rows of stitching) spinning inside gold rings, bowled down the pitch so it knocks the stumps over, or seen
   from a camera that circles the wicket. Floodlit dust, stars or rain drift through it. Everything is drawn in code with
   three.js (vendor/three.min-r128.js, loaded only when a designer theme is on). Without WebGL the page keeps the canvas ball
   from ball3d.js instead. It pauses off screen and in a hidden tab, and stands still for people who ask for less motion. */
(function () {
  'use strict';
  var SRC = 'vendor/three.min-r128.js';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var R, scene, cam, clock, T = 0, raf = 0, P = null, host = null, ro = null, io = null, failed = false, visible = true, loading = null, want = null;
  var ballG, ball, mat, rings, shadowPlane, stumpsG, stumps = [], bails = [], pitch, grass, grassMat, dust, rain, hemi, key, rim, flash, tex = {};

  function load() {
    if (window.THREE) return Promise.resolve();
    // one copy of three.js for the page: the opening animation (intro3d.js) may already be fetching it
    if (!loading) loading = window.DajiThreeLoading || (window.DajiThreeLoading = new Promise(function (ok, no) { var s = document.createElement('script'); s.src = SRC; s.async = true; s.onload = ok; s.onerror = no; document.head.appendChild(s); }));
    return loading;
  }
  function cv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function noise(ctx, w, h, amt, amt2, ctx2) {
    var a = ctx.getImageData(0, 0, w, h), b = ctx2 ? ctx2.getImageData(0, 0, w, h) : null, d = a.data;
    for (var i = 0; i < d.length; i += 4) { var n = (Math.random() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; if (b) { var m = n * amt2; b.data[i] += m; b.data[i + 1] += m; b.data[i + 2] += m; } }
    ctx.putImageData(a, 0, 0); if (b) ctx2.putImageData(b, 0, 0);
  }
  // the Daji ball as an equirectangular map: the seam runs round the equator so nothing stretches; a bump map raises the stitches
  function ballTex() {
    if (tex.b) return tex.b;
    var W = 2048, H = 1024, cy = H / 2, c = cv(W, H), g = c.getContext('2d'), b = cv(W, H), h = b.getContext('2d'), i, x, y;
    [['#ece4d2', '#fbf7ee', 0, cy], ['#9e1f17', '#c02c22', cy, H]].forEach(function (s) {
      g.fillStyle = s[0]; g.fillRect(0, s[2], W, s[3] - s[2]);
      g.save(); g.beginPath(); g.rect(0, s[2], W, s[3] - s[2]); g.clip();
      for (i = 0; i < 50; i++) { x = Math.random() * W; y = s[2] + Math.random() * (s[3] - s[2]); var r = 60 + Math.random() * 220, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, s[1] + '66'); gr.addColorStop(1, s[1] + '00'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
      for (i = 0; i < 14; i++) { x = Math.random() * W; y = s[2] + Math.random() * (s[3] - s[2]); var r2 = 20 + Math.random() * 70, g2 = g.createRadialGradient(x, y, 0, x, y, r2); g2.addColorStop(0, 'rgba(60,30,20,.12)'); g2.addColorStop(1, 'rgba(60,30,20,0)'); g.fillStyle = g2; g.fillRect(x - r2, y - r2, 2 * r2, 2 * r2); }
      g.restore();
    });
    h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
    noise(g, W, H, 12, 2, h);
    g.fillStyle = '#5a120d'; g.fillRect(0, cy - 6, W, 12);
    h.fillStyle = '#2e2e2e'; h.fillRect(0, cy - 6, W, 12);
    h.fillStyle = '#b4b4b4'; h.fillRect(0, cy - 10, W, 4); h.fillRect(0, cy + 6, W, 4);
    [[20, 1], [38, 0.92], [56, 0.8]].forEach(function (row) {
      var yy = cy + row[0];
      for (x = 6; x < W; x += 19) {
        g.save(); g.translate(x + 1.5, yy + 1.5); g.rotate(0.42); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(-2.6, -7, 5.2, 14); g.restore();
        g.save(); g.translate(x, yy); g.rotate(0.42); g.globalAlpha = row[1]; g.fillStyle = '#fbe9d6'; g.fillRect(-2.6, -7, 5.2, 14); g.restore();
        h.save(); h.translate(x, yy); h.rotate(0.42); h.fillStyle = '#f4f4f4'; h.fillRect(-2.6, -7, 5.2, 14); h.restore();
      }
    });
    var map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(b);
    map.encoding = THREE.sRGBEncoding; map.anisotropy = 8; bump.anisotropy = 8;
    return (tex.b = { map: map, bump: bump });
  }
  function pitchTex() {
    var W = 256, H = 2048, c = cv(W, H), g = c.getContext('2d');
    g.fillStyle = '#c4ab76'; g.fillRect(0, 0, W, H);
    for (var i = 0; i < 120; i++) { var x = Math.random() * W, y = Math.random() * H, r = 8 + Math.random() * 40; g.fillStyle = 'rgba(120,92,48,' + (Math.random() * 0.12) + ')'; g.beginPath(); g.ellipse(x, y, r, r * 1.6, 0, 0, 7); g.fill(); }
    var wear = g.createLinearGradient(0, 0, W, 0); wear.addColorStop(0, 'rgba(90,120,60,.35)'); wear.addColorStop(0.18, 'rgba(90,120,60,0)'); wear.addColorStop(0.82, 'rgba(90,120,60,0)'); wear.addColorStop(1, 'rgba(90,120,60,.35)'); g.fillStyle = wear; g.fillRect(0, 0, W, H);
    noise(g, W, H, 18, 0);
    var L = 22.5, px = function (z) { return (z + 21.3) / L * H; }, mx = W / 3.05;
    g.fillStyle = 'rgba(255,255,255,.92)';
    [0, -20.12].forEach(function (z) { g.fillRect(W / 2 - 1.32 * mx, px(z) - 2, 2.64 * mx, 4); }); // bowling creases
    [-1.22, -18.9].forEach(function (z) { g.fillRect(0, px(z) - 2.5, W, 5); }); // popping creases
    [[0, -1.22], [-20.12, -18.9]].forEach(function (p) { [-1.32, 1.32].forEach(function (xm) { var a = px(p[0]), b = px(p[1]); g.fillRect(W / 2 + xm * mx - 2, Math.min(a, b) - 30, 4, Math.abs(a - b) + 60); }); }); // return creases
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
  }
  function grassTex(a, b) {
    var k = a + b; if (tex[k]) return tex[k];
    var S = 1024, c = cv(S, S), g = c.getContext('2d');
    for (var i = 0; i < 16; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * S / 16, 0, S / 16, S); }
    noise(g, S, S, 14, 0);
    g.globalCompositeOperation = 'destination-in';
    var r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.45, 'rgba(0,0,0,.9)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, S, S);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return (tex[k] = t);
  }
  function dotTex() { var c = cv(64, 64), g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }

  function init() {
    if (failed) return false; if (R) return true;
    try {
      if (!window.THREE) throw 0;
      var small = Math.min(screen.width || 9999, screen.height || 9999) < 700;
      R = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      R.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
      R.outputEncoding = THREE.sRGBEncoding; R.toneMapping = THREE.ACESFilmicToneMapping;
      R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
      R.setClearColor(0x000000, 0);
      init.shadow = small ? 1024 : 2048;
    } catch (e) { failed = true; document.documentElement.classList.add('no-webgl'); return false; }
    scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(32, 1, 0.05, 200); clock = new THREE.Clock();
    hemi = new THREE.HemisphereLight(0xffffff, 0x202018, 0.55); scene.add(hemi);
    key = new THREE.DirectionalLight(0xffffff, 2.4); key.castShadow = true; key.shadow.mapSize.set(init.shadow, init.shadow); key.shadow.bias = -0.0004; key.shadow.radius = 4; scene.add(key); scene.add(key.target);
    rim = new THREE.DirectionalLight(0xffffff, 2.2); scene.add(rim);
    flash = new THREE.PointLight(0xffffff, 0, 4, 2); scene.add(flash);
    ballG = new THREE.Group(); scene.add(ballG);
    mat = new THREE.MeshPhysicalMaterial({ roughness: 0.36, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.28, bumpScale: 0.012 });
    ball = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat); ball.castShadow = true; ballG.add(ball);
    rings = new THREE.Group();
    [1.3, 1.5, 1.7].forEach(function (r, i) { var m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006 + i * 0.002, 8, 240), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 - i * 0.12 })); m.rotation.x = Math.PI / 2 + (i - 1) * 0.22; m.rotation.y = (i - 1) * 0.3; rings.add(m); });
    scene.add(rings);
    shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.32 })); shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = -1.5; shadowPlane.receiveShadow = true; scene.add(shadowPlane);
    // the wicket: three stumps and two bails, pivoting at the base
    stumpsG = new THREE.Group(); scene.add(stumpsG);
    var wood = new THREE.MeshStandardMaterial({ color: 0xefe3c4, roughness: 0.42 });
    var sg = new THREE.CylinderGeometry(0.017, 0.017, 0.71, 24); sg.translate(0, 0.355, 0);
    var tip = new THREE.ConeGeometry(0.017, 0.06, 16); tip.rotateX(Math.PI); tip.translate(0, -0.03, 0);
    [-0.105, 0, 0.105].forEach(function (x) { var s = new THREE.Mesh(sg, wood); s.position.x = x; s.castShadow = true; s.add(new THREE.Mesh(tip, wood)); stumpsG.add(s); stumps.push(s); });
    var bg = new THREE.CylinderGeometry(0.0085, 0.0085, 0.11, 14); bg.rotateZ(Math.PI / 2);
    [-0.0525, 0.0525].forEach(function (x) { var b = new THREE.Mesh(bg, wood); b.userData.x0 = x; b.castShadow = true; stumpsG.add(b); bails.push(b); });
    pitch = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 22.5), new THREE.MeshStandardMaterial({ map: pitchTex(), roughness: 0.95 })); pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0.002, -10.05); pitch.receiveShadow = true; scene.add(pitch);
    grassMat = new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, depthWrite: false });
    grass = new THREE.Mesh(new THREE.CircleGeometry(30, 96), grassMat); grass.rotation.x = -Math.PI / 2; grass.position.z = -9; grass.receiveShadow = true; grass.renderOrder = -1; scene.add(grass);
    // floating motes or stars, and rain streaks
    var N = 700, pos = new Float32Array(N * 3); for (var i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 16; pos[i * 3 + 1] = Math.random() * 8 - 2; pos[i * 3 + 2] = -Math.random() * 22 + 3; }
    var dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.05, map: dotTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })); scene.add(dust);
    var M = 500, rp = new Float32Array(M * 6); for (i = 0; i < M; i++) { var x = (Math.random() - 0.5) * 12, y = Math.random() * 8 - 3, z = -Math.random() * 10 + 1.5; rp.set([x, y, z, x - 0.02, y - 0.32, z], i * 6); }
    var rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })); scene.add(rain);
    R.domElement.setAttribute('aria-hidden', 'true');
    if (window.ResizeObserver) ro = new ResizeObserver(resize);
    if (window.IntersectionObserver) io = new IntersectionObserver(function (e) { visible = e[0].isIntersecting; kick(); });
    return true;
  }

  function configure() {
    var g = P;
    var tx = ballTex(); mat.map = tx.map; mat.bumpMap = tx.bump; mat.roughness = g.wet ? 0.2 : 0.36; mat.clearcoat = g.wet ? 1 : 0.55; mat.needsUpdate = true;
    hemi.color.set(g.day ? 0xf4f7ff : 0xbfc6d8); hemi.groundColor.set(g.day ? 0x8a8a70 : 0x1a1a14); hemi.intensity = g.day ? 0.9 : 0.5;
    key.color.set(g.key); key.intensity = g.day ? 2.4 : (g.mode === 'spin' ? 2.2 : 1.5); rim.color.set(g.rim); flash.color.set(g.acc);
    rings.children.forEach(function (m) { m.material.color.set(g.rim); });
    R.toneMappingExposure = g.exp || 1;
    var field = g.mode !== 'spin';
    rings.visible = !!g.rings; shadowPlane.visible = !field; stumpsG.visible = pitch.visible = grass.visible = field;
    if (field) { grassMat.map = grassTex(g.grass[0], g.grass[1]); grassMat.needsUpdate = true; }
    dust.visible = g.parts === 'dust' || g.parts === 'stars'; rain.visible = g.parts === 'rain';
    dust.material.color.set(g.pc || '#ffffff'); dust.material.size = g.parts === 'stars' ? 0.035 : 0.05; rain.material.color.set(g.pc || '#ffffff');
    var sc = key.shadow.camera;
    if (g.mode === 'delivery') { key.position.set(3, 7, 1); key.target.position.set(0, 0, -8); sc.left = -6; sc.right = 6; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 30; rim.position.set(-3, 2.5, -8); }
    else if (g.mode === 'orbit') { key.position.set(2.5, 6, 2.5); key.target.position.set(0, 0, 0); sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3; sc.near = 1; sc.far = 20; rim.position.set(-4, 3, -4); }
    else { key.position.set(2.6, 6, 3.2); key.target.position.set(0, 0, 0); sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 20; rim.position.set(-4, 2.2, -3.5); }
    sc.updateProjectionMatrix();
    ballG.scale.setScalar(g.mode === 'spin' ? 1 : g.mode === 'orbit' ? 0.13 : 0.062);
    if (g.mode === 'delivery') T = 0;
    reset();
  }
  function reset() { stumps.forEach(function (s) { s.rotation.set(0, 0, 0); }); bails.forEach(function (b) { b.position.set(b.userData.x0, 0.7185, 0); b.rotation.set(0, 0, 0); }); flash.intensity = 0; }

  var EASE = function (u) { return 1 - Math.pow(1 - u, 3); };
  function wide() { return host && host.clientWidth > 760; }
  function update(dt) {
    var g = P, m = g.mode;
    if (dust.visible) { dust.rotation.y += dt * (g.parts === 'stars' ? 0.006 : 0.02); dust.position.y = Math.sin(T * 0.3) * 0.15; }
    if (rain.visible) { var a = rain.geometry.attributes.position, ar = a.array; for (var i = 0; i < ar.length; i += 6) { ar[i + 1] -= dt * 9; ar[i + 4] -= dt * 9; if (ar[i + 4] < -3.2) { var y = 5 + Math.random() * 2; ar[i + 1] = y; ar[i + 4] = y - 0.32; } } a.needsUpdate = true; }
    if (m === 'spin') {
      ballG.position.set(0, Math.sin(T * 1.1) * 0.07, 0); ballG.rotation.set(0.1, Math.sin(T * 0.32) * 0.28, Math.PI / 2 * 0.9);
      ball.rotation.y += dt * (g.wet ? 1.9 : 1.25);
      rings.position.copy(ballG.position); rings.rotation.y += dt * 0.12; rings.rotation.z = Math.sin(T * 0.25) * 0.15;
      shadowPlane.material.opacity = g.day ? 0.18 : 0.32;
      var d = 5.4 * (g.rings ? 1.12 : 1) * ((g.ox && wide()) ? 1.45 : 1); cam.position.set(Math.sin(T * 0.12) * 0.25, 0.35, d); cam.lookAt(0, -0.05, 0);
      R.domElement.style.opacity = 1;
    } else if (m === 'orbit') {
      var an = T * 0.16 + 0.6; cam.position.set(Math.sin(an) * 2.9, 1.05 + Math.sin(T * 0.2) * 0.08, Math.cos(an) * 2.9); cam.lookAt(0, 0.62, 0);
      ballG.position.set(0, 0.95 + Math.sin(T * 1.2) * 0.04, -0.35); ballG.rotation.set(0, T * 0.2, Math.PI / 2 * 0.85); ball.rotation.y += dt * 3;
      rings.visible = false; R.domElement.style.opacity = 1;
    } else { // delivery: bowled, bounces, hits the stumps in slow motion, the bails fly
      var L = 4.8, tau = T % L, s = tau < 1.15 ? tau : tau < 2.7 ? 1.15 + (tau - 1.15) * 0.3 : 1.615 + (tau - 2.7), r = 0.062, x, y, z;
      if (s < 1.2) { var u = s / 1.2; z = -18 + 13.5 * u; y = 2.15 * (1 - u) + r * u + 0.22 * Math.sin(Math.PI * u); x = 0.18 * (1 - u); }
      else if (s < 1.55) { var v = (s - 1.2) / 0.35; z = -4.5 + 4.5 * v; y = r + 0.36 * (1 - (1 - v) * (1 - v)); x = 0; }
      else { var q = s - 1.55; z = 1.1 * q; y = Math.max(r, 0.42 + 1.1 * q - 4.9 * q * q); x = 0.22 * q; }
      ballG.position.set(x, y, z); ballG.rotation.set(0, 0, Math.PI / 2 * 0.9); ball.rotation.y += dt * (s < 1.55 ? 26 : 8);
      var hd = s - 1.55;
      if (hd < 0) reset();
      else {
        var e = EASE(Math.min(1, hd / 0.35));
        stumps[1].rotation.x = 0.62 * e; stumps[2].rotation.x = 0.28 * e; stumps[2].rotation.z = -0.12 * e; stumps[0].rotation.z = 0.04 * e;
        bails.forEach(function (b, k) { var sd = k ? 1 : -1, by = 0.7185 + 2.1 * hd - 4.9 * hd * hd; b.position.set(b.userData.x0 + sd * 0.55 * hd, Math.max(by, 0.0085), 1.3 * hd); b.rotation.set(hd * 9 * sd, hd * 4, hd * 6); });
        flash.position.set(0, 0.45, 0.1); flash.intensity = 3.2 * Math.exp(-hd * 5);
      }
      var slow = tau > 1.15 && tau < 2.7;
      cam.position.set(1.15 + Math.sin(T * 0.2) * 0.06, 0.5, 2.35 - (slow ? 0.15 * Math.sin((tau - 1.15) / 1.55 * Math.PI) : 0)); cam.lookAt(0, 0.42, -2.6);
      R.domElement.style.opacity = tau < 0.3 ? tau / 0.3 : tau > L - 0.35 ? (L - tau) / 0.35 : 1;
    }
  }
  function view() {
    if (!host) return; var w = host.clientWidth || 1, h = host.clientHeight || 1;
    R.setSize(w, h, false); cam.aspect = w / h;
    var ox = (P && P.ox && w > 760) ? P.ox : 0;
    if (ox) cam.setViewOffset(w, h, -ox * w, 0, w, h); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
  function resize() { if (!R || !host) return; view(); if (reduce || !running()) renderOnce(); }
  function renderOnce() { update(0); R.render(scene, cam); }
  function running() { return !reduce && host && visible && !document.hidden; }
  function loop() { raf = requestAnimationFrame(loop); var dt = Math.min(clock.getDelta(), 0.05); T += dt; update(dt); R.render(scene, cam); }
  function kick() { cancelAnimationFrame(raf); raf = 0; if (!host) return; if (running()) { clock.getDelta(); loop(); } }
  function attach(el, params) {
    if (!init()) return;
    if (host && host !== el) { if (ro) ro.unobserve(host); if (io) io.unobserve(host); }
    host = el; P = params; el.appendChild(R.domElement);
    if (ro) ro.observe(el); if (io) io.observe(el);
    configure(); view();
    if (reduce) { T = P.mode === 'delivery' ? 1.35 : 2; renderOnce(); } else kick();
  }
  /** Show the scene in `el` with the given look; the latest call wins while three.js is still loading. */
  function mount(el, params) {
    want = { el: el, p: params };
    load().then(function () { if (want && want.el === el && want.p === params) attach(el, params); }, function () { failed = true; document.documentElement.classList.add('no-webgl'); });
  }
  /** Stop and take the scene off the page (a theme without a 3D scene is on). */
  function unmount() {
    want = null; cancelAnimationFrame(raf); raf = 0;
    if (host) { if (ro) ro.unobserve(host); if (io) io.unobserve(host); }
    if (R && R.domElement.parentNode) R.domElement.parentNode.removeChild(R.domElement);
    host = null;
  }
  document.addEventListener('visibilitychange', kick);
  // the ball and pitch maps are shared with the opening animation (intro3d.js), so both draw the same ball
  window.DajiScene = { mount: mount, unmount: unmount, textures: function () { return { ball: ballTex(), pitch: pitchTex() }; } };
  if (window.DajiScenePending) { var q = window.DajiScenePending; window.DajiScenePending = null; mount(q.el, q.p); }
})();
