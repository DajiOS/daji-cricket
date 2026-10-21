/* The opening animation in 3D, in the colours and weather of whichever look is on. A short film drawn live with three.js: the camera
   tracks the Daji ball down the pitch in slow motion, it bounces, hits the stumps and the bails fly in a burst of the look's colours,
   then the camera cranes up over the floodlit (or sunlit) ground and the logo settles in. Everything is drawn in code: the ball and
   pitch maps come from scene3d.js, the sky, grass, stands, floodlights and particles are made here. Festival looks add their own
   touch (Diwali sparks and fireworks, Holi colour clouds, Uttarayan kites, Christmas snow, marigold petals, tricolour confetti).
   DajiIntro3D.play(box, look, { onDone }) returns false when 3D is not possible, so the caller can use the flat intro (intro.js). */
(function () {
  'use strict';
  var SRC = 'vendor/three.min-r128.js', LEN = 7.4;

  function load() {
    if (window.THREE) return Promise.resolve();
    if (!window.DajiThreeLoading) window.DajiThreeLoading = new Promise(function (ok, no) { var s = document.createElement('script'); s.src = SRC; s.async = true; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    return window.DajiThreeLoading;
  }

  var FEST = {
    diwali: { colours: ['#ffb547', '#ffd98a', '#ff7a2f', '#fff1c9'], extra: 'fireworks', fall: 'sparks' },
    navratri: { colours: ['#ffb703', '#ff4fa3', '#8f5bff', '#29d3c2'], extra: 'fireworks', fall: 'dust' },
    ganesh: { colours: ['#ffa21a', '#ffcf3d', '#e8481c', '#fff0c2'], extra: 'none', fall: 'petals' },
    christmas: { colours: ['#d9b25e', '#e8433b', '#2fa36b', '#ffffff'], extra: 'fireworks', fall: 'snow' },
    holi: { colours: ['#ff3d8b', '#ffd23d', '#2fc4ff', '#7d4dff', '#3ddc84'], extra: 'clouds', fall: 'none' },
    tiranga: { colours: ['#ff8c1a', '#ffffff', '#138a36', '#1d4fb8'], extra: 'none', fall: 'confetti' },
    uttarayan: { colours: ['#d9461a', '#ffbf3c', '#2f7fd6', '#e0245e', '#2fa36b'], extra: 'kites', fall: 'none' }
  };

  function cv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function col(x) { return new THREE.Color(x); }
  function mix(a, b, t) { return col(a).lerp(col(b), t); }
  function lum(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
  function glowTex(soft) {
    var c = cv(128, 128), g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(soft ? 0.5 : 0.18, 'rgba(255,255,255,' + (soft ? 0.55 : 0.4) + ')'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
  }
  // mown outfield: alternate light and dark bands with fine noise, tiled across the ground
  function grassTex(a, b) {
    var S = 512, c = cv(S, S), g = c.getContext('2d');
    g.fillStyle = a; g.fillRect(0, 0, S, S / 2); g.fillStyle = b; g.fillRect(0, S / 2, S, S / 2);
    var d = g.getImageData(0, 0, S, S), p = d.data;
    for (var i = 0; i < p.length; i += 4) { var n = (Math.random() - 0.5) * 26; p[i] += n * 0.8; p[i + 1] += n; p[i + 2] += n * 0.6; }
    g.putImageData(d, 0, 0);
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 14); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
  }
  // the stands all round: tiers of seats with a crowd in many colours, darker towards the roof
  function standTex(night, tint) {
    var W = 2048, H = 256, c = cv(W, H), g = c.getContext('2d');
    var top = night ? '#07080b' : '#3c4048', bot = night ? '#14161c' : '#6c717a';
    var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (var y = 30; y < H - 10; y += 9) { g.fillStyle = night ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.12)'; g.fillRect(0, y, W, 2); }
    var crowd = ['#e8e2d6', '#c23a2b', '#2a62b8', '#e3b23c', '#1f8a5b', '#f2f2f2', '#d85a9a', tint];
    for (var i = 0; i < 9000; i++) {
      var x = Math.random() * W, yy = 40 + Math.random() * (H - 52);
      g.globalAlpha = (night ? 0.35 : 0.7) * (0.4 + yy / H);
      g.fillStyle = crowd[(Math.random() * crowd.length) | 0]; g.fillRect(x, yy, 2.4, 3.2);
    }
    g.globalAlpha = 1; g.fillStyle = night ? '#0b0c10' : '#e9e6df'; g.fillRect(0, H - 8, W, 8); // the boundary board
    var t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); t.encoding = THREE.sRGBEncoding; return t;
  }

  function play(box, look, opt) {
    opt = opt || {};
    var THREE = window.THREE; if (!THREE || !window.DajiScene || !window.DajiScene.textures) return false;
    var R;
    try {
      var small = Math.min(screen.width || 9999, screen.height || 9999) < 700;
      R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      R.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
      R.outputEncoding = THREE.sRGBEncoding; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 0.88;
      R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (e) { return false; }

    var night = !!look.dark, F = FEST[look.fest] || null, G = look.g || {};
    var acc = col(G.acc && G.acc !== '#ffffff' ? G.acc : look.acc), rimC = col(G.rim || look.acc), keyC = col(G.key || (night ? '#fff3dc' : '#fff8ee'));
    var palette = (F ? F.colours : [G.acc || look.acc, G.rim || look.acc, G.pc || '#ffffff', '#ffffff']).map(col);
    var bg = col(look.bg); if (night && lum(bg) > 0.35) bg = mix(look.acc, '#05070a', 0.9); if (!night && lum(bg) < 0.35) bg = col('#eef2f4');
    var sky = night
      ? { top: mix(bg, '#000000', 0.55), mid: mix(bg, rimC, 0.12), low: mix(bg, rimC, 0.28) }
      : { top: mix('#5c95d6', bg, 0.25), mid: mix('#a9cdf0', bg, 0.35), low: mix('#f6efe2', bg, 0.4) };
    var grassA = G.grass && night ? G.grass[0] : night ? '#163a24' : '#5f9a47', grassB = G.grass && night ? G.grass[1] : night ? '#1b4529' : '#6aa652';
    if (!night && G.grass && G.day) { grassA = G.grass[0]; grassB = G.grass[1]; }
    var fall = F ? F.fall : (G.parts === 'rain' ? 'rain' : G.parts === 'stars' ? (night ? 'fireflies' : 'dust') : 'dust');
    var extra = F ? F.extra : 'none';

    // ---------- the stage
    var root = document.createElement('div'); root.className = 'd3I';
    root.innerHTML = '<style>.d3I{position:absolute;inset:0;overflow:hidden;background:' + '#' + bg.getHexString() + '}.d3I canvas{position:absolute;inset:0;width:100%;height:100%;display:block}' +
      '.d3I-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,' + (night ? 0.55 : 0.22) + ') 100%)}' +
      '.d3I-logo{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 1s cubic-bezier(.2,.8,.2,1),transform 1.4s cubic-bezier(.2,.8,.2,1);transform:scale(.94)}' +
      '.d3I-logo::before{content:"";position:absolute;width:min(110vw,1100px);height:min(60vw,520px);background:radial-gradient(ellipse,' + (night ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.7)') + ',transparent 70%)}' +
      '.d3I-logo img{position:relative;width:min(76vw,780px);height:auto;filter:drop-shadow(0 6px 24px rgba(0,0,0,' + (night ? 0.5 : 0.18) + '))}' +
      '.d3I-logo.on{opacity:1;transform:scale(1)}' +
      '.d3I-skip{position:absolute;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:3;font:600 12px/1 Manrope,Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:' + (night ? '#f3eee3' : '#14201b') + ';background:' + (night ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.5)') + ';border:1px solid ' + (night ? 'rgba(255,255,255,.3)' : 'rgba(20,32,27,.25)') + ';border-radius:99px;padding:10px 16px;cursor:pointer;backdrop-filter:blur(6px)}' +
      '.d3I-skip:focus-visible{outline:2px solid #' + acc.getHexString() + ';outline-offset:2px}</style>';
    root.appendChild(R.domElement);
    var vig = document.createElement('div'); vig.className = 'd3I-vig'; root.appendChild(vig);
    var logo = document.createElement('div'); logo.className = 'd3I-logo'; var img = document.createElement('img'); img.alt = ''; img.src = look.logo; logo.appendChild(img); root.appendChild(logo);
    var skip = document.createElement('button'); skip.type = 'button'; skip.className = 'd3I-skip'; skip.textContent = 'Skip'; root.appendChild(skip);
    box.appendChild(root);

    var scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.02, 400);
    scene.fog = new THREE.FogExp2(night ? sky.low : mix(sky.mid, sky.low, 0.5), night ? 0.006 : 0.002);

    // sky dome: a vertical gradient, with stars by night or a soft sun by day
    var skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: sky.top }, mid: { value: sky.mid }, low: { value: sky.low } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0); }'
    });
    var skyM = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), skyMat); scene.add(skyM);

    // reflections: the sky and the lights, blurred into an environment map so the ball's lacquer catches them
    try {
      // an equirectangular picture of the surroundings: the sky's gradient with the floodlight heads (or the sun) as bright patches
      var ec = cv(512, 256), eg = ec.getContext('2d'), egr = eg.createLinearGradient(0, 0, 0, 256);
      egr.addColorStop(0, '#' + sky.top.getHexString()); egr.addColorStop(0.42, '#' + sky.mid.getHexString()); egr.addColorStop(0.5, '#' + sky.low.getHexString()); egr.addColorStop(0.55, night ? '#0c120c' : '#4f6b3a'); egr.addColorStop(1, night ? '#050805' : '#3b5230');
      eg.fillStyle = egr; eg.fillRect(0, 0, 512, 256);
      (night ? [64, 192, 320, 448] : [380]).forEach(function (x) { var y = night ? 92 : 60, r = night ? 16 : 34, gl = eg.createRadialGradient(x, y, 0, x, y, r); gl.addColorStop(0, '#ffffff'); gl.addColorStop(0.4, 'rgba(255,248,230,.85)'); gl.addColorStop(1, 'rgba(255,248,230,0)'); eg.fillStyle = gl; eg.fillRect(x - r, y - r, 2 * r, 2 * r); });
      var et = new THREE.CanvasTexture(ec); et.mapping = THREE.EquirectangularReflectionMapping; et.encoding = THREE.sRGBEncoding;
      var pm = new THREE.PMREMGenerator(R); scene.environment = pm.fromEquirectangular(et).texture; pm.dispose(); et.dispose();
    } catch (e) { /* plain lighting still works */ }

    var hemi = new THREE.HemisphereLight(night ? 0x9aa6c0 : 0xf2f6ff, night ? 0x10140e : 0x6d7a4c, night ? 0.35 : 0.75); scene.add(hemi);
    var key = new THREE.DirectionalLight(keyC, night ? 1.7 : 2.4); key.position.set(night ? 6 : 9, night ? 14 : 16, night ? 6 : -4); key.target.position.set(0, 0, -7);
    key.castShadow = true; key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.01; key.shadow.radius = 3;
    var sc = key.shadow.camera; sc.left = -5; sc.right = 5; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 50; scene.add(key); scene.add(key.target);
    var key2 = new THREE.DirectionalLight(keyC, night ? 0.6 : 0); key2.position.set(-8, 12, 8); scene.add(key2);
    var rim = new THREE.DirectionalLight(rimC, night ? 1.8 : 0.9); rim.position.set(-4, 3, -12); scene.add(rim);
    var flash = new THREE.PointLight(acc, 0, 5, 2); flash.position.set(0, 0.45, 0.15); scene.add(flash);

    // the ground: outfield, square and pitch
    var gt = grassTex(grassA, grassB);
    var ground = new THREE.Mesh(new THREE.CircleGeometry(64, 96), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95, envMapIntensity: 0.25 }));
    ground.rotation.x = -Math.PI / 2; ground.position.z = -10; ground.receiveShadow = true; scene.add(ground);
    var tx = window.DajiScene.textures();
    var pitch = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 22.5), new THREE.MeshStandardMaterial({ map: tx.pitch, roughness: 0.92, envMapIntensity: 0.25, color: night ? 0xc9c2b4 : 0xffffff }));
    pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0.003, -10.05); pitch.receiveShadow = true; scene.add(pitch);
    var rope = new THREE.Mesh(new THREE.TorusGeometry(52, 0.08, 6, 160), new THREE.MeshStandardMaterial({ color: acc, roughness: 0.5, emissive: acc, emissiveIntensity: night ? 0.5 : 0.1 }));
    rope.rotation.x = Math.PI / 2; rope.position.set(0, 0.05, -10); scene.add(rope);
    var stands = new THREE.Mesh(new THREE.CylinderGeometry(68, 60, 8, 96, 1, true), new THREE.MeshStandardMaterial({ map: standTex(night, '#' + acc.getHexString()), side: THREE.BackSide, roughness: 0.9, envMapIntensity: 0.15 }));
    stands.position.set(0, 4, -10); scene.add(stands);
    // the boundary boards glow in the look's colour, the way a stadium's LED hoardings carry the colours of the night
    var lc = cv(1024, 32), lg = lc.getContext('2d'); lg.fillStyle = '#' + mix(acc, '#000000', 0.55).getHexString(); lg.fillRect(0, 0, 1024, 32);
    for (var li = 0; li < 16; li++) { lg.fillStyle = '#' + (li % 2 ? acc : mix(acc, '#ffffff', 0.45)).getHexString(); lg.fillRect(li * 64 + 6, 8, 40, 16); }
    var lt = new THREE.CanvasTexture(lc); lt.wrapS = THREE.RepeatWrapping; lt.repeat.set(10, 1); lt.encoding = THREE.sRGBEncoding;
    var boards = new THREE.Mesh(new THREE.CylinderGeometry(57, 57, 1, 128, 1, true), new THREE.MeshBasicMaterial({ map: lt, side: THREE.BackSide, color: night ? 0xffffff : 0xdddddd }));
    boards.position.set(0, 0.5, -10); scene.add(boards);

    // floodlight towers by night: a lit head of lamps with a wide glow, the way a camera sees them
    var glowT = glowTex(false), softT = glowTex(true), glows = [];
    if (night) {
      var poleM = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.6 }), lampM = new THREE.MeshBasicMaterial({ color: 0xfffaf0 });
      [[-40, -44], [40, -44], [-40, 22], [40, 22]].forEach(function (p) {
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, 18, 10), poleM); pole.position.set(p[0], 9, p[1]); scene.add(pole);
        var head = new THREE.Group(); head.position.set(p[0], 18.5, p[1]); head.lookAt(0, 0, -10); scene.add(head);
        for (var i = 0; i < 4; i++) for (var j = 0; j < 6; j++) { var l = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), lampM); l.position.set((j - 2.5) * 1.0, (i - 1.5) * 1.0, 0.1); head.add(l); }
        var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: keyC, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.95 }));
        s.position.set(p[0], 18.5, p[1]); s.scale.set(16, 16, 1); scene.add(s); glows.push(s);
        var s2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: softT, color: rimC, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.35 }));
        s2.position.copy(s.position); s2.scale.set(46, 46, 1); scene.add(s2); glows.push(s2);
      });
    } else {
      var sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: softT, color: 0xfff4d6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.9 }));
      sun.position.set(90, 120, -160); sun.scale.set(120, 120, 1); scene.add(sun);
    }

    // the wickets at both ends
    var wood = new THREE.MeshPhysicalMaterial({ color: 0xf1e6c9, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.35 });
    var sg = new THREE.CylinderGeometry(0.018, 0.018, 0.71, 24); sg.translate(0, 0.355, 0);
    var bgeo = new THREE.CylinderGeometry(0.009, 0.009, 0.11, 14); bgeo.rotateZ(Math.PI / 2);
    function wicket(z) {
      var w = { g: new THREE.Group(), s: [], b: [] }; w.g.position.z = z; scene.add(w.g);
      [-0.11, 0, 0.11].forEach(function (x) { var s = new THREE.Mesh(sg, wood); s.position.x = x; s.castShadow = true; w.g.add(s); w.s.push(s); });
      [-0.055, 0.055].forEach(function (x) { var b = new THREE.Mesh(bgeo, wood); b.userData.x0 = x; b.position.set(x, 0.72, 0); b.castShadow = true; w.g.add(b); w.b.push(b); });
      return w;
    }
    var W1 = wicket(0); wicket(-20.12);

    // the ball, with a comet trail of the look's accent behind it
    var ballMat = new THREE.MeshPhysicalMaterial({ map: tx.ball.map, bumpMap: tx.ball.bump, bumpScale: 0.008, roughness: G.wet ? 0.18 : 0.32, clearcoat: G.wet ? 1 : 0.7, clearcoatRoughness: 0.18, envMapIntensity: 1.2 });
    var ballR = 0.036, ballG = new THREE.Group(), ball = new THREE.Mesh(new THREE.SphereGeometry(ballR, 96, 64), ballMat); ball.castShadow = true;
    ballG.add(ball); scene.add(ballG); ball.rotation.z = Math.PI / 2 * 0.86;
    var TR = 48, trail = [], trailPos = [];
    for (var ti = 0; ti < TR; ti++) {
      var tsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softT, color: ti % 3 ? acc : palette[1 % palette.length], transparent: true, blending: night ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, opacity: 0 }));
      tsp.scale.setScalar(0.05); scene.add(tsp); trail.push(tsp);
    }

    // particles: the look's weather, the impact burst and festival extras
    function points(n, size, blending, colours) {
      var g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), c = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) { var cc = colours[i % colours.length]; c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b; }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      var m = new THREE.PointsMaterial({ size: size, map: softT, vertexColors: true, transparent: true, depthWrite: false, blending: blending, sizeAttenuation: true });
      var p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p); return p;
    }
    var N = small ? 500 : 1100;
    var wx = points(N, fall === 'snow' ? 0.09 : fall === 'petals' || fall === 'confetti' ? 0.1 : fall === 'fireflies' ? 0.12 : fall === 'rain' ? 0.035 : 0.045,
      fall === 'petals' || fall === 'confetti' || (fall === 'snow' && !night) ? THREE.NormalBlending : THREE.AdditiveBlending,
      fall === 'dust' ? [col(G.pc || (night ? '#fff3d8' : '#ffffff'))] : fall === 'fireflies' ? [col(G.pc || '#e4ff6e')] : fall === 'rain' ? [col(G.pc || '#cfe8f0')] : fall === 'snow' ? [col('#ffffff')] : fall === 'sparks' ? palette : palette);
    wx.visible = fall !== 'none';
    var wv = new Float32Array(N * 3), wp = wx.geometry.attributes.position.array;
    for (var i = 0; i < N; i++) {
      wp[i * 3] = (Math.random() - 0.5) * 14; wp[i * 3 + 1] = Math.random() * 7; wp[i * 3 + 2] = 3 - Math.random() * 26;
      var fs = fall === 'rain' ? 7 : fall === 'snow' ? 0.5 : fall === 'petals' || fall === 'confetti' ? 0.7 : fall === 'sparks' ? -0.25 : 0.05;
      wv[i * 3] = (Math.random() - 0.5) * 0.3; wv[i * 3 + 1] = -fs * (0.7 + Math.random() * 0.6); wv[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    wx.material.opacity = fall === 'rain' ? 0.55 : 0.9;

    var B = small ? 260 : 520, burst = points(B, 0.045, night ? THREE.AdditiveBlending : THREE.NormalBlending, palette), bv = new Float32Array(B * 3), bp = burst.geometry.attributes.position.array;
    for (i = 0; i < B; i++) { var th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI, sp = 0.6 + Math.random() * 2.2; bv[i * 3] = Math.cos(th) * Math.sin(ph) * sp; bv[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 1.1 + 0.4; bv[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * sp + 0.6; }
    burst.visible = false;
    var dustB = points(80, 0.05, THREE.NormalBlending, [col('#b59a68'), col('#9c8457')]), dv = new Float32Array(240), dp = dustB.geometry.attributes.position.array; dustB.visible = false; dustB.material.opacity = 0.7;
    for (i = 0; i < 80; i++) { dv[i * 3] = (Math.random() - 0.5) * 0.8; dv[i * 3 + 1] = Math.random() * 0.7; dv[i * 3 + 2] = Math.random() * 0.9; }

    // Holi: soft clouds of colour that bloom from the stumps
    var clouds = [];
    if (extra === 'clouds') for (i = 0; i < 16; i++) { var cl = new THREE.Sprite(new THREE.SpriteMaterial({ map: softT, color: palette[i % palette.length], transparent: true, depthWrite: false, opacity: 0, fog: false })); cl.userData.v = new THREE.Vector3((Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 1.2, (Math.random() - 0.3) * 2); scene.add(cl); clouds.push(cl); }
    // Diwali, Navratri, New Year: fireworks over the stands
    var fw = [];
    if (extra === 'fireworks') for (i = 0; i < 5; i++) { var f = points(small ? 90 : 160, 1.3, THREE.AdditiveBlending, [palette[i % palette.length], palette[(i + 1) % palette.length]]); f.visible = false; f.userData = { t0: 3.4 + i * 0.55, at: new THREE.Vector3((i - 2) * 12 + (Math.random() - 0.5) * 6, 12 + Math.random() * 6, -46 - Math.random() * 8), v: [] }; for (var k = 0; k < f.geometry.attributes.position.count; k++) { var a1 = Math.random() * 6.283, a2 = Math.acos(2 * Math.random() - 1), s1 = 7 + Math.random() * 3; f.userData.v.push([Math.cos(a1) * Math.sin(a2) * s1, Math.cos(a2) * s1, Math.sin(a1) * Math.sin(a2) * s1]); } fw.push(f); }
    // Uttarayan: kites on the breeze above the ground
    var kites = [];
    if (extra === 'kites') {
      var kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1, 0, -0.75, 0, 0, 0, -1.1, 0, 0, 1, 0, 0, -1.1, 0, 0.75, 0, 0]), 3)); kg.computeVertexNormals();
      for (i = 0; i < 9; i++) { var km = new THREE.Mesh(kg, new THREE.MeshStandardMaterial({ color: palette[i % palette.length], side: THREE.DoubleSide, roughness: 0.6, emissive: palette[i % palette.length], emissiveIntensity: 0.15 })); km.position.set((Math.random() - 0.5) * 50, 7 + Math.random() * 8, -24 - Math.random() * 22); km.scale.setScalar(1 + Math.random()); km.userData.ph = Math.random() * 6; scene.add(km); kites.push(km); }
    }

    // ---------- the film
    function ease(u) { return u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u); }
    var tmp = new THREE.Vector3();
    function ballAt(s, out) { // s: 0 at release, 1 at the stumps
      var x, y, z;
      if (s < 0.74) { var k = s / 0.74; z = -17.6 + (17.6 - 3.1) * k; y = 2.05 * (1 - k) + ballR * k + 0.28 * Math.sin(Math.PI * k); x = 0.32 * (1 - k) + 0.04 * k; }
      else { var v = (s - 0.74) / 0.26; z = -3.1 + 3.1 * v; y = ballR + 0.62 * v - 0.24 * v * v; x = 0.04 * (1 - v); }
      return out.set(x, y, z);
    }
    var lastTrail = 0;
    // the film is framed for a wide screen; on a tall phone the view widens so the same width of the scene stays in shot
    function fov(v) { var a = cam.aspect; if (a >= 1.6) return v; var h = Math.atan(Math.tan(v * Math.PI / 360) * 1.6); return Math.min(84, Math.atan(Math.tan(h) / a) * 360 / Math.PI); }
    function frame(T, dt) {
      var s, hd = -1, p = tmp;
      if (T < 2.6) { s = Math.min(1, T / 2.6); ballAt(s, p); }
      else { hd = T < 3.8 ? (T - 2.6) * 0.32 : 0.384 + (T - 3.8) * 0.9; ballAt(1, p); p.set(p.x + 0.35 * hd, Math.max(ballR, p.y + 0.9 * hd - 4.9 * hd * hd), p.z + 1.4 * hd); }
      ballG.position.copy(p); ball.rotation.x -= dt * (hd < 0 ? 15 : hd < 0.4 ? 3 : 9);

      // the trail follows the ball's path
      if (T - lastTrail > 0.008) { lastTrail = T; trailPos.unshift(p.clone()); if (trailPos.length > TR) trailPos.pop(); }
      trail.forEach(function (sp, i) { var q = trailPos[i]; if (!q || T > 4.2) { sp.material.opacity = 0; return; } sp.position.copy(q); var f = 1 - i / TR; sp.material.opacity = (night ? 0.5 : 0.35) * f * f * Math.min(1, T * 2); sp.scale.setScalar(0.05 * f + 0.008); });

      // the bounce kicks up a little dust from the pitch
      var bt = T - 2.6 * 0.74;
      if (bt > 0 && bt < 2) { dustB.visible = true; for (var i = 0; i < 80; i++) { dp[i * 3] = dv[i * 3] * bt; dp[i * 3 + 1] = Math.max(0, dv[i * 3 + 1] * bt - 0.6 * bt * bt); dp[i * 3 + 2] = -3.1 + dv[i * 3 + 2] * bt; } dustB.geometry.attributes.position.needsUpdate = true; dustB.material.opacity = 0.7 * Math.max(0, 1 - bt / 1.4); } else dustB.visible = false;

      // the wicket goes over: middle stump back, off stump twisting, the bails spinning away
      if (hd < 0) { W1.s.forEach(function (x) { x.rotation.set(0, 0, 0); }); W1.b.forEach(function (b) { b.position.set(b.userData.x0, 0.72, 0); b.rotation.set(0, 0, 0); }); flash.intensity = 0; }
      else {
        var e = 1 - Math.pow(1 - Math.min(1, hd / 0.4), 3);
        W1.s[1].rotation.x = 0.7 * e; W1.s[2].rotation.x = 0.32 * e; W1.s[2].rotation.z = -0.16 * e; W1.s[0].rotation.z = 0.05 * e;
        W1.b.forEach(function (b, k) { var sd = k ? 1 : -1, by = 0.72 + 2.3 * hd - 4.9 * hd * hd; b.position.set(b.userData.x0 + sd * 0.6 * hd, Math.max(by, 0.009), 1.4 * hd); b.rotation.set(hd * 10 * sd, hd * 4, hd * 7); });
        flash.intensity = 6 * Math.exp(-hd * 4);
        burst.visible = true; burst.material.opacity = Math.max(0, 1 - hd / 1.6);
        for (i = 0; i < B; i++) { bp[i * 3] = bv[i * 3] * hd; bp[i * 3 + 1] = 0.45 + bv[i * 3 + 1] * hd - 2.2 * hd * hd; bp[i * 3 + 2] = bv[i * 3 + 2] * hd; }
        burst.geometry.attributes.position.needsUpdate = true;
        clouds.forEach(function (c, k) { var u = Math.max(0, hd - k * 0.012); c.position.set(c.userData.v.x * u * 1.3, 0.4 + c.userData.v.y * u, c.userData.v.z * u); c.scale.setScalar(0.3 + u * 3); c.material.opacity = Math.min(0.6, u * 3) * Math.max(0, 1 - (u - 0.6) / 1.6); });
      }

      // weather
      if (wx.visible) {
        for (i = 0; i < N; i++) {
          var j = i * 3; wp[j] += (wv[j] + (fall === 'petals' || fall === 'confetti' || fall === 'snow' ? Math.sin(T * 1.3 + i) * 0.25 : 0)) * dt; wp[j + 1] += wv[j + 1] * dt; wp[j + 2] += wv[j + 2] * dt;
          if (fall === 'fireflies') { wp[j] += Math.sin(T * 0.9 + i * 1.7) * 0.004; wp[j + 1] += Math.cos(T * 1.1 + i) * 0.003; }
          if (wp[j + 1] < 0) wp[j + 1] += 7; if (wp[j + 1] > 7) wp[j + 1] -= 7;
        }
        wx.geometry.attributes.position.needsUpdate = true;
        if (fall === 'fireflies') wx.material.opacity = 0.6 + 0.4 * Math.sin(T * 3);
      }
      fw.forEach(function (f) { var u = T - f.userData.t0; if (u < 0 || u > 2.4) { f.visible = false; return; } f.visible = true; var a = f.geometry.attributes.position.array; for (var k = 0; k < f.userData.v.length; k++) { var v = f.userData.v[k], d = 1 - Math.exp(-u * 1.6); a[k * 3] = f.userData.at.x + v[0] * d; a[k * 3 + 1] = f.userData.at.y + v[1] * d - 2.2 * u * u; a[k * 3 + 2] = f.userData.at.z + v[2] * d; } f.geometry.attributes.position.needsUpdate = true; f.material.opacity = Math.max(0, 1 - u / 2.4); });
      kites.forEach(function (k) { k.rotation.set(Math.sin(T * 0.8 + k.userData.ph) * 0.25, Math.sin(T * 0.5 + k.userData.ph) * 0.4, Math.sin(T * 1.1 + k.userData.ph) * 0.3); k.position.y += Math.sin(T * 0.9 + k.userData.ph) * 0.01; });
      glows.forEach(function (g, k) { g.material.opacity = (k % 2 ? 0.35 : 0.95) * (0.92 + 0.08 * Math.sin(T * 7 + k)); });

      // camera: track beside the ball, swing round the wicket for the slow motion, then crane up over the ground
      if (T < 2.6) {
        var u = T / 2.6, off = new THREE.Vector3(0.62 - 0.2 * u, 0.12 + 0.12 * (1 - u), 0.85 + 0.5 * (1 - u));
        cam.position.copy(p).add(off); cam.lookAt(p.x, p.y + 0.02, p.z - 0.25);
        cam.fov = fov(30);
      } else if (T < 3.8) {
        var a = 0.9 + 0.7 * ease((T - 2.6) / 1.2), rr = 1.35;
        cam.position.set(Math.sin(a) * rr, 0.42 + 0.08 * Math.sin((T - 2.6) * 2), Math.cos(a) * rr * 0.9 + 0.2); cam.lookAt(0, 0.4, 0);
        cam.fov = fov(30);
      } else {
        var c = ease((T - 3.8) / 2.6), a2 = 1.6 * (1 - c), r2 = 1.35 + c * 9;
        cam.position.set(Math.sin(a2) * r2, 0.42 + c * 3.6, Math.cos(a2) * r2 * 0.9 + 0.2); cam.lookAt(0, 0.4 + 1.6 * c, -16 * c);
        cam.fov = fov(30 + c * 14);
      }
      cam.updateProjectionMatrix();
    }

    // ---------- run
    var raf = 0, t0 = 0, last = 0, done = false, shownLogo = false;
    function size() { var w = box.clientWidth || window.innerWidth, h = box.clientHeight || window.innerHeight; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    size(); window.addEventListener('resize', size);
    function finish() {
      if (done) return; done = true; cancelAnimationFrame(raf); window.removeEventListener('resize', size);
      root.style.transition = 'opacity .6s ease'; root.style.opacity = '0';
      setTimeout(function () {
        scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
        if (scene.environment) scene.environment.dispose(); R.dispose(); if (R.forceContextLoss) try { R.forceContextLoss(); } catch (e) { /* ignore */ }
        if (root.parentNode) root.remove(); if (opt.onDone) opt.onDone();
      }, 620);
    }
    skip.addEventListener('click', finish);
    function tick(now) {
      if (done) return;
      raf = requestAnimationFrame(tick);
      if (!t0) { t0 = now; last = now; }
      var T = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (T > 4.7 && !shownLogo) { shownLogo = true; logo.classList.add('on'); }
      frame(Math.min(T, 6.6), dt);
      R.render(scene, cam);
      if (T > LEN) finish();
    }
    root.style.opacity = '0'; root.style.transition = 'opacity .5s ease';
    frame(0, 0); R.render(scene, cam);
    if (opt.paused) root.style.opacity = '1'; // for the screenshot check: frames are drawn one by one with frame(T)
    else requestAnimationFrame(function () { root.style.opacity = '1'; raf = requestAnimationFrame(tick); });
    return { scene: scene, renderer: R, stop: finish, frame: function (T) { frame(T, 1 / 60); if (T > 4.7) logo.classList.add('on'); R.render(scene, cam); } };
  }

  window.DajiIntro3D = { load: load, play: play, length: LEN };
})();
