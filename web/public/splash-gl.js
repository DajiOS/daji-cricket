/* Real-time 3D for the opening animation, drawn in WebGL as a hand-inked cartoon: the stumps, bails and ball are true 3D shapes lit
   in flat bands, with an ink outline that wobbles at 12 frames a second and a little paper grain over the top.
   It does no timing of its own. app.js animates plain page elements and this file reads where each one is every frame,
   so the 3D scene follows the same story. If WebGL is missing, app.js keeps the plain version. */
(function () {
  'use strict';
  function mat(tx, ty, tz, rz, ry, sx, sy, sz) { // translate * rotateZ * rotateY * scale, column-major
    var cz = Math.cos(rz), sZ = Math.sin(rz), cy = Math.cos(ry), sY = Math.sin(ry);
    // R = Rz * Ry
    var r00 = cz * cy, r01 = -sZ, r02 = cz * sY, r10 = sZ * cy, r11 = cz, r12 = sZ * sY, r20 = -sY, r21 = 0, r22 = cy;
    return new Float32Array([r00 * sx, r10 * sx, r20 * sx, 0, r01 * sy, r11 * sy, r21 * sy, 0, r02 * sz, r12 * sz, r22 * sz, 0, tx, ty, tz, 1]);
  }
  function sphere(n, m) {
    var p = [], q = [], idx = [];
    for (var i = 0; i <= n; i++) for (var j = 0; j <= m; j++) {
      var a = Math.PI * i / n, b = 2 * Math.PI * j / m, x = Math.sin(a) * Math.cos(b), y = Math.cos(a), z = Math.sin(a) * Math.sin(b);
      p.push(x, y, z); q.push(x, y, z);
    }
    for (var i2 = 0; i2 < n; i2++) for (var j2 = 0; j2 < m; j2++) { var a0 = i2 * (m + 1) + j2, b0 = a0 + m + 1; idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); }
    return { p: p, n: q, i: idx };
  }
  function cylinder(m) { // radius 1, from y = 0 (bottom) to y = 1 (top), with a slightly domed top
    var p = [], q = [], idx = [], k;
    for (k = 0; k <= m; k++) { var a = 2 * Math.PI * k / m, x = Math.cos(a), z = Math.sin(a); p.push(x, 0, z, x, 1, z); q.push(x, 0, z, x, 0, z); }
    for (k = 0; k < m; k++) { var s = k * 2; idx.push(s, s + 1, s + 2, s + 1, s + 3, s + 2); }
    var base = p.length / 3; p.push(0, 1.0, 0); q.push(0, 1, 0);
    for (k = 0; k <= m; k++) { var a2 = 2 * Math.PI * k / m; p.push(Math.cos(a2), 1, Math.sin(a2)); q.push(0, 1, 0); }
    for (k = 0; k < m; k++) idx.push(base, base + 1 + k, base + 2 + k);
    return { p: p, n: q, i: idx };
  }
  var VS = 'attribute vec3 aP;attribute vec3 aN;uniform mat4 uM;uniform vec2 uRes;uniform float uZ;varying vec3 vN;varying vec3 vO;'
    + 'void main(){vec4 w=uM*vec4(aP,1.0);vN=normalize(mat3(uM[0].xyz,uM[1].xyz,uM[2].xyz)*aN);vO=aP;'
    + 'gl_Position=vec4(w.x/uRes.x*2.0-1.0,1.0-w.y/uRes.y*2.0,-(w.z+uZ)/2000.0,1.0);}';
  var FS = 'precision mediump float;varying vec3 vN;varying vec3 vO;uniform vec3 uCol;uniform vec3 uShade;uniform float uInk;uniform float uBall;uniform float uAlpha;uniform float uSeed;'
    + 'float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}'
    + 'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}'
    + 'void main(){'
    + 'vec3 n=normalize(vN);' // clay: thumbprint dents and soft lumps bend the normal a little
    + 'float b1=vn(vO.xy*7.0+vO.z*5.0),b2=vn(vO.zx*17.0+vO.y*3.0);n=normalize(n+vec3(b1-0.5,b2-0.5,(b1+b2)*0.5-0.5)*0.32);'
    + 'vec3 L=normalize(vec3(-0.6,-0.55,0.62));float d=dot(n,L)*0.5+0.5;' // wrapped light, matte
    + 'vec3 c=mix(uShade,uCol,smoothstep(0.12,0.85,d));'
    + 'c+=vec3(0.07,0.05,0.04)*pow(max(dot(n,normalize(L+vec3(0.0,0.0,1.0))),0.0),14.0);' // a faint waxy sheen, never a hard shine
    + 'if(uBall>0.5){float s=abs(vO.y);float g=smoothstep(0.075,0.05,s);c=mix(c,uShade*0.55,g);float st=step(0.5,fract(vO.x*9.0+vO.z*9.0));if(s<0.19&&s>0.11&&st>0.5)c=mix(c,uShade*0.6,0.8);}'
    + 'float rim=pow(1.0-max(n.z,0.0),2.5);c=mix(c,uCol*1.12,rim*0.25);'
    + 'float g2=(h(gl_FragCoord.xy*0.7+uSeed)-0.5)*0.05;gl_FragColor=vec4(c+g2,uAlpha);}';

  function start(scene, vw, vh, getParts) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cv = document.createElement('canvas'); cv.id = 'sp-gl';
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.cssText = 'position:absolute;left:0;top:0;width:' + vw + 'px;height:' + vh + 'px;pointer-events:none';
    var gl = cv.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return null;
    function sh(t, s) { var o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
    var pr;
    try { pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link'); } catch (e) { return null; }
    gl.useProgram(pr);
    var U = {}; ['uM', 'uRes', 'uZ', 'uCol', 'uShade', 'uInk', 'uBall', 'uAlpha', 'uSeed'].forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });
    var aP = gl.getAttribLocation(pr, 'aP'), aN = gl.getAttribLocation(pr, 'aN');
    function mesh(g) {
      var pb = gl.createBuffer(), nb = gl.createBuffer(), ib = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.p), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.n), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.i), gl.STATIC_DRAW);
      return { pb: pb, nb: nb, ib: ib, n: g.i.length };
    }
    var SPH = mesh(sphere(28, 40)), CYL = mesh(cylinder(32));
    function draw(m, M, col, shade, ink, ball, alpha, z, seed) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.enableVertexAttribArray(aN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
      gl.uniformMatrix4fv(U.uM, false, M); gl.uniform3fv(U.uCol, col); gl.uniform3fv(U.uShade, shade);
      gl.uniform1f(U.uInk, ink); gl.uniform1f(U.uBall, ball); gl.uniform1f(U.uAlpha, alpha); gl.uniform1f(U.uZ, z); gl.uniform1f(U.uSeed, seed);
      gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
    }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, cv.width, cv.height); gl.uniform2f(U.uRes, vw, vh);
    scene.insertBefore(cv, scene.firstChild);

    var GOLD = [0.96, 0.74, 0.30], GOLD_S = [0.72, 0.42, 0.14], RED = [0.88, 0.24, 0.17], RED_S = [0.52, 0.10, 0.08];
    var raf = 0, alive = true, t0 = performance.now();
    var lastF = -1, snap = [];
    function jit(f, k) { var v = Math.abs(Math.sin(f * 12.9898 + k * 78.233) * 43758.5453); return (v % 1) - 0.5; }
    function frame(now) {
      if (!alive) return;
      var f = Math.floor((now - t0) / 83);                 // stop-motion: the scene is photographed 12 times a second
      if (f !== lastF) { lastF = f; snap = getParts(); }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      var k = 0;
      snap.forEach(function (p) {
        if (p.alpha <= 0.01) return; k++;
        var jx = jit(f, k) * 2.4, jy = jit(f, k + 40) * 2.0, jr = jit(f, k + 80) * 0.05, js = 1 + jit(f, k + 120) * 0.045; // hands moving the clay between shots
        if (p.kind === 'ball') {
          var r = p.r * js; draw(SPH, mat(p.x + jx, p.y + jy, 0, p.rot + jr, p.rot * 0.8, r, r * (2 - js), r), RED, RED_S, 0, 1, p.alpha, 0, f);
        } else if (p.kind === 'stump') {
          draw(CYL, mat(p.x + jx, p.y + jy, 0, p.rot + jr, 0, p.w / 2 * js, -p.h, p.w / 2 * js), GOLD, GOLD_S, 0, 0, p.alpha, 0, f);
        } else {
          var len = p.w, rad = p.t / 2, ang = p.rot + jr + Math.PI / 2, M = mat(p.x + jx, p.y + jy, 0, ang, 0, rad * js, len, rad * js);
          M[12] = p.x + jx + Math.cos(ang) * len / 2 * -1 * -1; M[13] = p.y + jy + Math.sin(ang) * len / 2 * -1 * -1;
          M[12] = p.x + jx - (-Math.sin(ang)) * 0 + (Math.cos(ang + Math.PI / 2) * 0); M[13] = p.y + jy;
          // centre the cylinder on (x, y): its base is at y = 0 and its length runs along the turned axis
          var ax = -Math.sin(ang), ay = Math.cos(ang); M[12] = p.x + jx - ax * len / 2; M[13] = p.y + jy - ay * len / 2;
          draw(CYL, M, GOLD, GOLD_S, 0, 0, p.alpha, 0, f);
        }
      });
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return { dispose: function () { alive = false; cancelAnimationFrame(raf); if (cv.parentNode) cv.remove(); } };
  }
  window.DajiSplashGL = { start: start };
})();
