/* ==========================================================================
   Scroll Hero Frame — Glass engine  v1.0
   One WebGL2 canvas behind the frame's text:
     1. green textured backdrop with a spotlight and the portrait's cast shadow
     2. far glass shards refracting the backdrop
     3. a cut-out portrait with 2.5D depth (parallax from a depth map, dolly
        push, rim light) — grounded, it does not float
     4. near glass shards refracting everything (optional images inside)
     5. bloom + filmic finish
   Glass recipe follows THE DAY's GlassShardPass: shards are drawn as
   view-space normals + UVs into a mask, then a composite refracts the frame
   through it (chromatic dispersion, frost refraction map, fresnel, edge
   highlight) — here with the frost normal map for surface detail and sparkle.
   Shards travel sideways (left -> right) with scroll, tumbling slowly.

   Needs scroll-hero.js for progress. No other dependencies.
   Auto-attaches to every [data-scroll-hero] containing .shf-scene.
   API: ScrollHeroGlass.attach(section, options?) -> { destroy(), state() }
   ========================================================================== */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function damp(dt, tau) { return 1 - Math.exp(-dt / Math.max(tau, 1e-4)); }
  function fract(x) { return x - Math.floor(x); }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash1(i, seed) {
    var h = Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, seed) {
    var i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10);
    return (hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u) * 2 - 1;
  }
  function fbm(x, seed) { return vnoise(x, seed) * 0.6 + vnoise(x * 2.03 + 17.1, seed + 31) * 0.28 + vnoise(x * 4.11 + 3.7, seed + 67) * 0.12; }

  /* --- mat4 helpers (column-major) --- */
  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf; return out;
  }
  function mul(out, a, b) {
    var r = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var rr = 0; rr < 4; rr++) r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
    out.set(r); return out;
  }
  function modelMatrix(out, x, y, z, rx, ry, rz, s) {
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Rz * Ry * Rx
    var m00 = cz * cy, m01 = cz * sy * sx - sz * cx, m02 = cz * sy * cx + sz * sx;
    var m10 = sz * cy, m11 = sz * sy * sx + cz * cx, m12 = sz * sy * cx - cz * sx;
    var m20 = -sy, m21 = cy * sx, m22 = cy * cx;
    out[0] = m00 * s; out[1] = m10 * s; out[2] = m20 * s; out[3] = 0;
    out[4] = m01 * s; out[5] = m11 * s; out[6] = m21 * s; out[7] = 0;
    out[8] = m02 * s; out[9] = m12 * s; out[10] = m22 * s; out[11] = 0;
    out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
    return out;
  }

  /* ------------------------------------------------------------ GLB reader */
  function parseGLB(buf) {
    var dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB');
    var jsonLen = dv.getUint32(12, true);
    var json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    var off = 20 + jsonLen, binLen = dv.getUint32(off, true);
    var bin = buf.slice(off + 8, off + 8 + binLen);
    var COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    var TYPES = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
    function accessor(i) {
      var a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = COMP[a.type], T = TYPES[a.componentType];
      var start = (bv.byteOffset || 0) + (a.byteOffset || 0), el = T.BYTES_PER_ELEMENT;
      var stride = bv.byteStride || n * el;
      var out = new T(a.count * n);
      if (stride === n * el) { out.set(new T(bin.slice(start, start + a.count * n * el))); return out; }
      var src = new DataView(bin);
      for (var k = 0; k < a.count; k++) for (var c = 0; c < n; c++) {
        var o = start + k * stride + c * el;
        out[k * n + c] = T === Float32Array ? src.getFloat32(o, true) : T === Uint32Array ? src.getUint32(o, true) : T === Uint16Array ? src.getUint16(o, true) : src.getUint8(o);
      }
      return out;
    }
    var meshes = {};
    (json.nodes || []).forEach(function (node) {
      if (node.mesh === undefined) return;
      var prim = json.meshes[node.mesh].primitives[0], at = prim.attributes;
      var pos = accessor(at.POSITION), nrm = at.NORMAL !== undefined ? accessor(at.NORMAL) : null;
      var uv = at.TEXCOORD_0 !== undefined ? accessor(at.TEXCOORD_0) : null;
      var idx = prim.indices !== undefined ? accessor(prim.indices) : null;
      var s = node.scale || [1, 1, 1];
      var count = pos.length / 3, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      var data = new Float32Array(count * 8);
      for (var v = 0; v < count; v++) {
        var x = pos[v * 3] * s[0], y = pos[v * 3 + 1] * s[1], z = pos[v * 3 + 2] * s[2];
        data[v * 8] = x; data[v * 8 + 1] = y; data[v * 8 + 2] = z;
        data[v * 8 + 3] = nrm ? nrm[v * 3] : 0; data[v * 8 + 4] = nrm ? nrm[v * 3 + 1] : 0; data[v * 8 + 5] = nrm ? nrm[v * 3 + 2] : 1;
        data[v * 8 + 6] = uv ? uv[v * 2] : x * 4; data[v * 8 + 7] = uv ? uv[v * 2 + 1] : y * 4;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      meshes[node.name || ('mesh' + node.mesh)] = { data: data, index: idx, count: idx ? idx.length : count, bbox: [minX, minY, maxX, maxY] };
    });
    return meshes;
  }

  /* --------------------------------------------------------------- shaders */
  var HEAD = '#version 300 es\nprecision highp float;\n';
  var COMMON = [
    'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }'
  ].join('\n');
  var QUAD_VS = HEAD + 'layout(location=0) in vec2 aPos; out vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';

  // Screen space below uses s = top-left uv (0..1).
  var BG_FS = HEAD + COMMON + '\n' + [
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uBg; uniform sampler2D uPortrait;',
    'uniform vec2 uRes; uniform float uTile; uniform vec2 uShift;',
    'uniform vec4 uRect;      // portrait rect in screen uv (x, y, w, h)',
    'uniform vec2 uShadow;    // cast-shadow offset in screen uv',
    'uniform vec4 uSpot;      // spotlight x, y, radius, strength',
    'uniform float uBgBlur;',
    'void main(){',
    '  vec2 s = vec2(vUv.x, 1.0 - vUv.y);',
    '  vec2 px = s * uRes;',
    '  vec3 c = texture(uBg, (px + uShift * uRes.y) / uTile, uBgBlur).rgb;',
    '  vec2 q = (s - uSpot.xy) * vec2(uRes.x / uRes.y, 1.0);',
    '  float spot = exp(-dot(q, q) / (uSpot.z * uSpot.z));',
    '  float fall = 1.0 - smoothstep(0.3, 1.25, length((s - vec2(0.5, 0.45)) * vec2(uRes.x / uRes.y, 1.0)));',
    '  c *= (0.42 + 0.45 * fall) + uSpot.w * spot;',
    '  c += vec3(0.010, 0.030, 0.018) * spot;',
    '  // soft cast shadow of the portrait on the wall behind (light from the upper left)',
    '  vec2 pu = (s - uShadow - uRect.xy) / uRect.zw;',
    '  float sh = 0.0;',
    '  if (pu.x > 0.0 && pu.x < 1.0 && pu.y > 0.0 && pu.y < 1.0) sh = textureLod(uPortrait, pu, 5.5).a;',
    '  c *= 1.0 - 0.55 * sh;',
    '  o = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var PORTRAIT_FS = HEAD + COMMON + '\n' + [
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uPortrait; uniform sampler2D uDepth;',
    'uniform vec4 uRect; uniform vec2 uPar; uniform float uPush; uniform vec2 uFocus; uniform vec2 uLight; uniform vec4 uRim;',
    'void main(){',
    '  vec2 s = vec2(vUv.x, 1.0 - vUv.y);',
    '  vec2 uv = (s - uRect.xy) / uRect.zw;',
    '  // dolly push: near parts (high depth) grow more than far parts -> real volume',
    '  vec2 p = uv;',
    '  for (int i = 0; i < 4; i++) {',
    '    float d = texture(uDepth, p).r;',
    '    p = uFocus + (uv - uFocus) / (1.0 + uPush * (0.4 + 0.6 * d)) - uPar * (d - 0.35);',
    '  }',
    '  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;',
    '  vec4 c = texture(uPortrait, p);            // premultiplied on upload',
    '  if (c.a < 0.003) discard;',
    '  float d = texture(uDepth, p).r;',
    '  vec3 col = c.rgb;',
    '  // rim light where the silhouette edge faces the light, plus a faint green bounce on the far side',
    '  float aL = texture(uPortrait, p + uLight * 0.014).a;',
    '  float aG = texture(uPortrait, p - uLight * 0.012).a;',
    '  float rim = clamp(c.a - aL, 0.0, 1.0);',
    '  float bounce = clamp(c.a - aG, 0.0, 1.0);',
    '  col += uRim.rgb * rim * uRim.a;',
    '  col += vec3(0.12, 0.26, 0.16) * bounce * 0.3;',
    '  col *= 0.9 + 0.1 * d;                        // gentle volume, features untouched',
    '  o = vec4(col, c.a);',
    '}'
  ].join('\n');

  var MASK_VS = HEAD + [
    'layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;',
    'uniform mat4 uModel; uniform mat4 uProj; uniform vec2 uLens;',
    'out vec3 vN; out vec2 vUv;',
    'void main(){',
    '  vN = mat3(uModel) * aNrm; vUv = aUv;',
    '  vec4 clip = uProj * (uModel * vec4(aPos, 1.0)); clip.xy += uLens * clip.w;',
    '  gl_Position = clip;',
    '}'
  ].join('\n');
  var MASK_FS = HEAD + [
    'in vec3 vN; in vec2 vUv; out vec4 o; uniform float uDim;',
    'void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;',
    '  o = vec4(n.xy * 0.5 * uDim + 0.5, fract(vUv)); }'
  ].join('\n');

  // Overlay image inside a shard (drawn into the frame before that layer's glass composite).
  var OVERLAY_VS = HEAD + [
    'layout(location=0) in vec3 aPos;',
    'uniform mat4 uModel; uniform mat4 uProj; uniform vec2 uLens; uniform vec4 uBox;',
    'out vec2 vL;',
    'void main(){ vL = (aPos.xy - uBox.xy) / (uBox.zw - uBox.xy);',
    '  vec4 clip = uProj * (uModel * vec4(aPos, 1.0)); clip.xy += uLens * clip.w; gl_Position = clip; }'
  ].join('\n');
  var OVERLAY_FS = HEAD + [
    'in vec2 vL; out vec4 o; uniform sampler2D uAtlas; uniform vec4 uRect; uniform float uAlpha;',
    'void main(){ vec2 c = clamp(vL, 0.0, 1.0); vec3 col = texture(uAtlas, uRect.xy + vec2(c.x, 1.0 - c.y) * uRect.zw).rgb;',
    '  float edge = smoothstep(0.0, 0.12, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));',
    '  float a = uAlpha * (0.35 + 0.65 * edge); o = vec4(col * a, a); }'
  ].join('\n');

  var GLASS_FS = HEAD + COMMON + '\n' + [
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uScene; uniform sampler2D uMask; uniform sampler2D uFrost; uniform sampler2D uFrostN;',
    'uniform vec4 uGlass;   // refraction, dispersion, map strength, fresnel power',
    'uniform vec4 uGlass2;  // edge highlight, frost amount, sparkle, normal-map strength',
    'uniform vec3 uTint; uniform vec2 uPx; uniform vec2 uMapScale; uniform vec3 uLightDir; uniform float uFog;',
    'void main(){',
    '  vec4 live = texture(uScene, vUv);',
    '  vec4 m = texture(uMask, vUv);',
    '  if (m.r + m.g < 0.01) { o = live; return; }',
    '  vec2 nxy = m.rg * 2.0 - 1.0;',
    '  vec3 fn = texture(uFrostN, m.ba * uMapScale).rgb * 2.0 - 1.0;',
    '  vec2 nd = nxy + fn.xy * uGlass2.w * 0.18;',
    '  float nz = sqrt(max(0.0, 1.0 - dot(nd, nd)));',
    '  float rm = texture(uFrost, m.ba * uMapScale).r;',
    '  // refraction follows the smooth facet normal; the frost only nudges it',
    '  vec2 off = nxy * uGlass.x + fn.xy * uGlass2.w * 0.02 + (rm - 0.5) * uGlass.z * 0.012 * nxy;',
    '  vec3 glass;',
    '  if (uGlass.y < 0.001) glass = texture(uScene, vUv + off).rgb;',
    '  else glass = vec3(texture(uScene, vUv + off * (1.0 - uGlass.y)).r, texture(uScene, vUv + off).g, texture(uScene, vUv + off * (1.0 + uGlass.y)).b);',
    '  glass *= uTint;',
    '  float fres = 0.04 + 0.96 * pow(1.0 - nz, uGlass.w);',
    '  glass += vec3(0.92, 0.97, 0.95) * fres;',
    '  // frost: the crack network catches light',
    '  glass += vec3(0.86, 0.97, 0.92) * smoothstep(0.55, 0.95, rm) * uGlass2.y * (0.45 + 0.55 * fres);',
    '  // sparkle: sharp highlight from the key light on the facets',
    '  vec3 N = normalize(vec3(nd, nz)); vec3 H = normalize(normalize(uLightDir) + vec3(0.0, 0.0, 1.0));',
    '  glass += vec3(1.0, 0.98, 0.92) * pow(max(dot(N, H), 0.0), 120.0) * uGlass2.z;',
    '  // edges',
    '  vec2 nL = texture(uMask, vUv + vec2(-uPx.x, 0.0)).rg, nR = texture(uMask, vUv + vec2(uPx.x, 0.0)).rg;',
    '  vec2 nT = texture(uMask, vUv + vec2(0.0, uPx.y)).rg, nB = texture(uMask, vUv + vec2(0.0, -uPx.y)).rg;',
    '  float dN = length(nR - nL) + length(nT - nB);',
    '  glass += vec3(0.95, 1.0, 0.97) * smoothstep(0.02, 0.15, dN) * uGlass2.x;',
    '  glass = mix(glass, live.rgb, uFog);',
    '  o = vec4(glass, 1.0);',
    '}'
  ].join('\n');

  /* --- post (THE DAY) --- */
  var BRIGHT_FS = HEAD + COMMON + '\n' + [
    'in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uThreshold;',
    'vec3 tap(vec2 off){ return texture(uSrc, vUv + off * uTexel).rgb; }',
    'void main(){',
    '  vec3 a = tap(vec2(-2,-2)), b = tap(vec2(0,-2)), c = tap(vec2(2,-2)), d = tap(vec2(-1,-1)), e = tap(vec2(1,-1));',
    '  vec3 f = tap(vec2(-2,0)), g = tap(vec2(0,0)), h = tap(vec2(2,0)), i = tap(vec2(-1,1)), j = tap(vec2(1,1));',
    '  vec3 k = tap(vec2(-2,2)), l = tap(vec2(0,2)), m = tap(vec2(2,2));',
    '  vec3 col = (d+e+i+j)*0.125 + (a+b+f+g)*0.03125 + (b+c+g+h)*0.03125 + (f+g+k+l)*0.03125 + (g+h+l+m)*0.03125;',
    '  float br = max(col.r, max(col.g, col.b)); float knee = max(uThreshold.y, 1e-4);',
    '  float soft = clamp(br - uThreshold.x + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee);',
    '  o = vec4(col * max(soft, br - uThreshold.x) / max(br, 1e-4), 1.0);',
    '}'
  ].join('\n');
  var DOWN_FS = HEAD + [
    'in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform vec2 uTexel;',
    'void main(){ vec2 h = uTexel; vec3 s = texture(uSrc, vUv).rgb * 4.0;',
    '  s += texture(uSrc, vUv + vec2(-h.x,-h.y)).rgb + texture(uSrc, vUv + vec2(h.x,-h.y)).rgb + texture(uSrc, vUv + vec2(-h.x,h.y)).rgb + texture(uSrc, vUv + vec2(h.x,h.y)).rgb;',
    '  o = vec4(s / 8.0, 1.0); }'
  ].join('\n');
  var UP_FS = HEAD + [
    'in vec2 vUv; out vec4 o; uniform sampler2D uSrc; uniform sampler2D uDetail; uniform vec2 uTexel; uniform float uSpread;',
    'void main(){ vec2 h = uTexel;',
    '  vec3 s = texture(uSrc, vUv + vec2(-2.0*h.x, 0)).rgb + texture(uSrc, vUv + vec2(2.0*h.x, 0)).rgb + texture(uSrc, vUv + vec2(0, -2.0*h.y)).rgb + texture(uSrc, vUv + vec2(0, 2.0*h.y)).rgb;',
    '  s += (texture(uSrc, vUv + vec2(-h.x,-h.y)).rgb + texture(uSrc, vUv + vec2(h.x,-h.y)).rgb + texture(uSrc, vUv + vec2(-h.x,h.y)).rgb + texture(uSrc, vUv + vec2(h.x,h.y)).rgb) * 2.0;',
    '  o = vec4(mix(texture(uDetail, vUv).rgb, s / 12.0, uSpread), 1.0); }'
  ].join('\n');
  var COMPOSITE_FS = HEAD + COMMON + '\n' + [
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uScene; uniform sampler2D uBloom; uniform vec2 uRes;',
    'uniform vec4 uBloomCol; uniform vec4 uTone; uniform vec3 uShadows; uniform vec3 uHighlights; uniform float uGrade; uniform vec4 uFinish;',
    'vec3 shoulder(vec3 x){ vec3 over = max(x - 0.8, 0.0); return min(x, 0.8) + 0.2 * (1.0 - exp(-over / 0.2)); }',
    'vec3 toe(vec3 x){ vec3 inv = 1.0 - clamp(x, 0.0, 1.0); return x - x * inv * inv * inv * 0.9; }',
    'void main(){',
    '  vec2 px = gl_FragCoord.xy;',
    '  vec3 c = texture(uScene, vUv).rgb;',
    '  vec3 bloom = texture(uBloom, vUv).rgb * uBloomCol.rgb * uBloomCol.a;',
    '  c = 1.0 - (1.0 - clamp(c, 0.0, 1.5)) * (1.0 - clamp(bloom, 0.0, 1.0));',
    '  c = mix(c, toe(shoulder(c * uTone.x)), uTone.y);',
    '  c = clamp(c, 0.0, 1.0);',
    '  c = mix(c, c * c * (3.0 - 2.0 * c), uTone.z);',
    '  float l = luma(c);',
    '  c += (uShadows - vec3(luma(uShadows))) * (1.0 - l) * (1.0 - l) * uGrade * 0.5;',
    '  c += (uHighlights - vec3(luma(uHighlights))) * l * l * uGrade * 0.35;',
    '  c = mix(vec3(luma(c)), c, uTone.w);',
    '  vec2 v = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);',
    '  c *= 1.0 - smoothstep(0.5, 1.35, length(v) * 1.1) * uFinish.x;',
    '  c += (hash12(px + uFinish.w * 17.0) - 0.5) * uFinish.y * (0.4 + 0.6 * (1.0 - abs(2.0 * luma(c) - 1.0)));',
    '  c += (hash12(px + uFinish.w * 3.1 + 11.0) + hash12(px.yx + uFinish.w * 5.7 + 23.0) - 1.0) * uFinish.z / 255.0;',
    '  o = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------- GL helpers */
  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(s); throw new Error('Shader: ' + log); }
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }
  function target(gl, w, h, fmt, depth) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format || gl.RGBA, fmt.type, null);
    var filt = fmt.nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    var rb = null;
    if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
    return { tex: t, fb: f, rb: rb, w: w, h: h };
  }
  function freeTarget(gl, t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); if (t.rb) gl.deleteRenderbuffer(t.rb); } }
  function loadImage(src) {
    return new Promise(function (res) { if (!src) return res(null); var im = new Image(); im.decoding = 'async'; im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = src; });
  }

  var DEFAULTS = {
    front: 6, back: 5,               // fewer pieces: 6 near shards, 5 far shards
    subjectX: 0.36, subjectY: 0.0,   // portrait centre x (0..1); y offset
    portraitHeight: 1.04,            // portrait height as a fraction of the frame height (desktop)
    depth: 1.0,                      // 2.5D parallax strength
    tile: 360,                       // background tile size in px (at 1x)
    speed: 1.0,                      // sideways travel speed
    bloom: 0.7, grain: 0.03, maxDpr: 1.5, seed: 5,
    grade: 0.35,                     // teal/cream grade strength (lower it for colour portraits)
    saturation: 1.0                  // final saturation
  };
  function readOptions(el, opts) {
    var o = {}, k, d = el ? el.dataset : {};
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    ['front', 'back', 'seed'].forEach(function (n) { if (d[n]) o[n] = parseInt(d[n], 10); });
    ['subjectX', 'subjectY', 'portraitHeight', 'depth', 'tile', 'speed', 'bloom', 'grain', 'grade', 'saturation'].forEach(function (n) { if (d[n]) o[n] = parseFloat(d[n]); });
    if (opts) for (k in opts) o[k] = opts[k];
    return o;
  }

  /* ------------------------------------------------------------------ engine */
  function attach(section, userOpts) {
    var backdrop = section.querySelector('.shf-backdrop');
    var scene = section.querySelector('.shf-scene');
    if (!backdrop || !scene) return null;
    var opts = readOptions(scene, userOpts);
    var D = scene.dataset;
    var reduced = global.matchMedia('(prefers-reduced-motion: reduce)');
    var mobileQ = global.matchMedia('(max-width: 820px)');

    var canvas = document.createElement('canvas');
    canvas.className = 'shf-canvas'; canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) return null;
    var floatExt = gl.getExtension('EXT_color_buffer_float');
    var HDR = floatExt ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    var LDR = { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE, nearest: true };
    var P;
    try {
      P = {
        bg: program(gl, QUAD_VS, BG_FS), portrait: program(gl, QUAD_VS, PORTRAIT_FS),
        mask: program(gl, MASK_VS, MASK_FS), overlay: program(gl, OVERLAY_VS, OVERLAY_FS), glass: program(gl, QUAD_VS, GLASS_FS),
        bright: program(gl, QUAD_VS, BRIGHT_FS), down: program(gl, QUAD_VS, DOWN_FS), up: program(gl, QUAD_VS, UP_FS), comp: program(gl, QUAD_VS, COMPOSITE_FS)
      };
    } catch (err) { console.warn('[ScrollHeroGlass] WebGL setup failed; showing the fallback.', err); return null; }
    backdrop.insertBefore(canvas, backdrop.querySelector('.shf-shade'));

    var quadVAO = gl.createVertexArray(); gl.bindVertexArray(quadVAO);
    var qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    function tex(img, opt) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!opt.premultiply);
      if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(opt.fill || [0, 0, 0, 0]));
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      var wrap = opt.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (img && opt.mips !== false) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      return t;
    }
    var T = {
      bg: tex(null, { fill: [30, 46, 34, 255] }), portrait: tex(null, {}), depth: tex(null, { fill: [128, 128, 128, 255] }),
      frost: tex(null, { fill: [128, 128, 128, 255] }), frostN: tex(null, { fill: [128, 128, 255, 255] }), atlas: tex(null, {})
    };
    var portraitAspect = 0.75;
    var shardMeshes = {};
    var slots = [];
    var alive = true;

    /* --- shard definitions: sideways travel --- */
    var shards = [];
    function buildShards() {
      var rnd = mulberry32(opts.seed * 7919 + 3);
      var names = Object.keys(shardMeshes);
      var front = names.filter(function (n) { return /^Shard_/.test(n); }).sort();
      var back = names.filter(function (n) { return /^BG_Shard_/.test(n); }).sort();
      if (!front.length) front = names; if (!back.length) back = names;
      shards = [];
      var nf = mobileQ.matches ? Math.max(3, Math.round(opts.front * 0.7)) : opts.front;
      var nb = mobileQ.matches ? Math.max(2, Math.round(opts.back * 0.6)) : opts.back;
      function add(i, n, list, isBack) {
        var lane = n > 1 ? i / (n - 1) : 0.5;
        // near shards keep the face clear: lanes above the head and across the chest/shoulders
        var FRONT_LANES = [0.88, -0.42, 0.8, -0.68, -0.9, 0.96, -0.55, 0.84];
        var laneY = isBack ? (lane - 0.5) * 1.5 + (rnd() - 0.5) * 0.18 : FRONT_LANES[i % FRONT_LANES.length] + (rnd() - 0.5) * 0.08;
        shards.push({
          mesh: shardMeshes[list[i % list.length]], back: isBack,
          z: isBack ? -(1.9 + rnd() * 0.9) : -(0.78 + rnd() * 0.45),
          lane: laneY,
          phase: i / n + rnd() * 0.5 / n,
          speed: (isBack ? 0.32 + rnd() * 0.18 : 0.55 + rnd() * 0.35),
          scale: (isBack ? 1.15 + rnd() * 0.75 : 1.0 + rnd() * 0.45) * (isBack ? 1 : 1.275),
          r0: [(rnd() - 0.5) * 0.9, (rnd() - 0.5) * 1.1, (rnd() - 0.5) * 1.4],
          r1: [(rnd() - 0.5) * 0.9, (rnd() - 0.5) * 1.6, (rnd() - 0.5) * 2.2],
          wob: [0.07 + rnd() * 0.14, 0.07 + rnd() * 0.14, 0.07 + rnd() * 0.14, 0.15 + rnd() * 0.3, 0.15 + rnd() * 0.3, 0.15 + rnd() * 0.3, rnd() * TAU, rnd() * TAU, rnd() * TAU],
          slot: null, seed: 30 + i * 11 + (isBack ? 500 : 0)
        });
      }
      for (var i = 0; i < nb; i++) add(i, nb, back, true);
      for (i = 0; i < nf; i++) add(i, nf, front, false);
      // images (optional): inside every other near shard
      var k = 0;
      shards.forEach(function (s) { if (!s.back && slots.length && (k++ % 2 === 0)) s.slot = slots[(k >> 1) % slots.length]; });
    }

    function uploadMesh(m) {
      m.vao = gl.createVertexArray(); gl.bindVertexArray(m.vao);
      var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      if (m.index) {
        var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        var idx = m.index instanceof Uint32Array ? m.index : new Uint32Array(m.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); m.idxType = gl.UNSIGNED_INT;
      }
      gl.bindVertexArray(null);
    }

    function buildAtlas(imgs) {
      var n = Math.max(1, imgs.length), cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), cell = 512;
      var cv = document.createElement('canvas'); cv.width = cols * cell; cv.height = rows * cell;
      var cx = cv.getContext('2d');
      slots = [];
      imgs.forEach(function (im, i) {
        if (!im) return;
        var col = i % cols, row = Math.floor(i / cols), ar = im.naturalWidth / im.naturalHeight;
        var w = ar >= 1 ? cell : Math.round(cell * ar), h = ar >= 1 ? Math.round(cell / ar) : cell;
        var x = col * cell + (cell - w) / 2, y = row * cell + (cell - h) / 2;
        cx.drawImage(im, x, y, w, h);
        slots.push([(x + 1) / cv.width, (y + 1) / cv.height, (w - 2) / cv.width, (h - 2) / cv.height]);
      });
      if (slots.length) { gl.deleteTexture(T.atlas); T.atlas = tex(cv, {}); }
    }

    // load everything
    var imgEls = Array.prototype.slice.call(scene.querySelectorAll('img'));
    var ready = Promise.all([
      loadImage(D.background), loadImage(D.portrait), loadImage(D.depthMap), loadImage(D.frost), loadImage(D.frostNormal),
      D.shards ? fetch(D.shards).then(function (r) { return r.arrayBuffer(); }).then(parseGLB).catch(function (e) { console.warn('[ScrollHeroGlass] shards', e); return {}; }) : Promise.resolve({}),
      Promise.all(imgEls.map(function (im) { return loadImage(im.currentSrc || im.src); }))
    ]).then(function (r) {
      if (!alive) return;
      try {
        if (r[0]) { gl.deleteTexture(T.bg); T.bg = tex(r[0], { repeat: true }); }
        if (r[1]) { gl.deleteTexture(T.portrait); T.portrait = tex(r[1], { premultiply: true }); portraitAspect = r[1].naturalWidth / r[1].naturalHeight; }
        if (r[2]) { gl.deleteTexture(T.depth); T.depth = tex(r[2], { mips: false }); }
        if (r[3]) { gl.deleteTexture(T.frost); T.frost = tex(r[3], { repeat: true }); }
        if (r[4]) { gl.deleteTexture(T.frostN); T.frostN = tex(r[4], { repeat: true }); }
      } catch (e) { console.warn('[ScrollHeroGlass] textures need http(s), same origin.', e); }
      shardMeshes = r[5] || {};
      Object.keys(shardMeshes).forEach(function (k) { uploadMesh(shardMeshes[k]); });
      buildAtlas(r[6] || []);
      buildShards();
    });

    /* --- targets --- */
    var W = 1, H = 1, RT = null, renderScale = 1;
    function makeTargets() {
      if (RT) { ['a', 'b', 'c', 'mask', 'bright'].forEach(function (k) { freeTarget(gl, RT[k]); }); RT.downs.concat(RT.ups).forEach(function (t) { freeTarget(gl, t); }); }
      RT = { a: target(gl, W, H, HDR), b: target(gl, W, H, HDR), c: target(gl, W, H, HDR), mask: target(gl, W, H, LDR, true), downs: [], ups: [] };
      var bw = Math.max(1, W >> 1), bh = Math.max(1, H >> 1); RT.bright = target(gl, bw, bh, HDR);
      var w = bw, h = bh;
      for (var i = 0; i < 4; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); RT.downs.push(target(gl, w, h, HDR)); }
      for (i = 0; i < 3; i++) RT.ups.push(target(gl, RT.downs[i].w, RT.downs[i].h, HDR));
    }
    function resize() {
      var r = backdrop.getBoundingClientRect();
      var dpr = Math.min(global.devicePixelRatio || 1, mobileQ.matches ? 1.25 : opts.maxDpr) * renderScale;
      var w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
      if (w === W && h === H && RT) return;
      W = w; H = h; canvas.width = W; canvas.height = H; makeTargets();
    }
    var ro = global.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(backdrop); else global.addEventListener('resize', resize);

    /* --- input --- */
    var Ps = -1, ambient = 0, pointer = { tx: 0, ty: 0, x: 0, y: 0 };
    function onPointer(e) { if (e.pointerType !== 'mouse') return; pointer.tx = e.clientX / global.innerWidth * 2 - 1; pointer.ty = e.clientY / global.innerHeight * 2 - 1; }
    global.addEventListener('pointermove', onPointer, { passive: true });
    function rawProgress() {
      if (section._shf && section._shf.progress) return section._shf.progress();
      var rect = section.getBoundingClientRect(); return clamp((global.innerHeight - rect.top) / Math.max(1, rect.height), 0, 1);
    }

    var proj = new Float32Array(16), model = new Float32Array(16), lens = [0, 0];
    var frameNo = 0;
    var FOV = 40 * Math.PI / 180;

    function placeShards(p, t, aspect) {
      var th = Math.tan(FOV / 2);
      var list = [];
      for (var i = 0; i < shards.length; i++) {
        var s = shards[i];
        if (!s.mesh) continue;
        var hw = th * -s.z * aspect, hh = th * -s.z;
        var u = fract(s.phase + p * s.speed * opts.speed + t * 0.012 * s.speed);
        var x = (u * 2 - 1) * (hw * 1.25 + 0.25 * s.scale);
        var y = s.lane * hh + fbm(t * 0.05 + p * 0.8, s.seed) * hh * 0.06;
        // near shards curve away from the head as they pass it (up when above, down when below)
        if (!s.back) {
          var su = ((x / (hw * 1.25)) + 1) / 2, sxNow = mobileQ.matches ? 0.5 : opts.subjectX;
          var near = 1 - smooth(Math.abs(su - sxNow) / 0.22);
          y += (s.lane > 0 ? 1 : -1) * near * hh * 0.22;
        }
        var w = s.wob;
        var rx = mix(s.r0[0], s.r1[0], u) + Math.sin(t * w[3] + w[6]) * w[0];
        var ry = mix(s.r0[1], s.r1[1], u) + Math.sin(t * w[4] + w[7]) * w[1];
        var rz = mix(s.r0[2], s.r1[2], u) + Math.sin(t * w[5] + w[8]) * w[2];
        // pointer parallax by depth (THE DAY: |z| x 0.15)
        x += -pointer.x * Math.abs(s.z) * 0.05; y += pointer.y * Math.abs(s.z) * 0.035;
        list.push({ s: s, m: modelMatrix(new Float32Array(16), x, y, s.z, rx, ry, rz, s.scale) });
      }
      return list;
    }

    function drawMasks(list, wantBack) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, RT.mask.fb); gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(P.mask.p);
      gl.uniformMatrix4fv(P.mask.u.uProj, false, proj); gl.uniform2fv(P.mask.u.uLens, lens);
      var any = false;
      list.forEach(function (e) {
        if (e.s.back !== wantBack) return;
        any = true;
        gl.uniformMatrix4fv(P.mask.u.uModel, false, e.m); gl.uniform1f(P.mask.u.uDim, 1.0);
        gl.bindVertexArray(e.s.mesh.vao);
        if (e.s.mesh.index) gl.drawElements(gl.TRIANGLES, e.s.mesh.count, e.s.mesh.idxType, 0); else gl.drawArrays(gl.TRIANGLES, 0, e.s.mesh.count);
      });
      gl.disable(gl.DEPTH_TEST);
      return any;
    }

    function glassPass(src, dst, back) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, W, H);
      gl.useProgram(P.glass.p);
      bind(0, src.tex, P.glass.u.uScene); bind(1, RT.mask.tex, P.glass.u.uMask); bind(2, T.frost, P.glass.u.uFrost); bind(3, T.frostN, P.glass.u.uFrostN);
      // THE DAY values (refraction .25, dispersion .15, map 2, fresnel 10, edge .15), softened for the far layer
      if (back) { gl.uniform4f(P.glass.u.uGlass, 0.08, 0.08, 1.0, 6.0); gl.uniform4f(P.glass.u.uGlass2, 0.1, 0.12, 0.25, 0.5); gl.uniform1f(P.glass.u.uFog, 0.18); gl.uniform3f(P.glass.u.uTint, 0.92, 1.0, 0.95); }
      else { gl.uniform4f(P.glass.u.uGlass, 0.14, 0.12, 2.0, 5.0); gl.uniform4f(P.glass.u.uGlass2, 0.22, 0.22, 0.7, 0.6); gl.uniform1f(P.glass.u.uFog, 0.0); gl.uniform3f(P.glass.u.uTint, 0.97, 1.02, 0.99); }
      gl.uniform2f(P.glass.u.uPx, 1 / W, 1 / H); gl.uniform2f(P.glass.u.uMapScale, 1.0, 1.0);
      gl.uniform3f(P.glass.u.uLightDir, -0.55, 0.6, 0.6);
      gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function bind(unit, t, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }

    function frame(dt) {
      var raw = rawProgress();
      if (Ps < 0) Ps = raw;
      Ps += (raw - Ps) * damp(dt, 0.3);
      if (!reduced.matches) ambient += dt;
      pointer.x += (pointer.tx - pointer.x) * damp(dt, 0.8); pointer.y += (pointer.ty - pointer.y) * damp(dt, 0.8);
      var p = Ps, t = ambient, aspect = W / H, mobile = mobileQ.matches;

      perspective(proj, FOV, aspect, 0.05, 50);
      var sx = mobile ? 0.5 : opts.subjectX;
      lens[0] = 0; lens[1] = 0;

      // portrait rect (screen uv, top-left origin): grounded at the bottom edge
      var ph = mobile ? 1.0 : opts.portraitHeight, pw = ph * portraitAspect / aspect;
      var rect = [sx - pw / 2, 1 - ph + 0.02 + opts.subjectY, pw, ph];
      // camera for the 2.5D portrait: slow sideways pan with scroll + pointer + hand-held drift
      var camX = (p - 0.5) * 0.9 + pointer.x * 0.55 + fbm(t * 0.08, 3) * 0.12;
      var camY = -pointer.y * 0.35 + fbm(t * 0.07, 5) * 0.08;
      var par = [camX * 0.012 * opts.depth, camY * 0.008 * opts.depth];
      var push = 0.06 * smooth(p) * opts.depth;

      /* ---- 1. background into A ---- */
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, RT.a.fb); gl.viewport(0, 0, W, H);
      gl.useProgram(P.bg.p);
      bind(0, T.bg, P.bg.u.uBg); bind(1, T.portrait, P.bg.u.uPortrait);
      gl.uniform2f(P.bg.u.uRes, W, H);
      gl.uniform1f(P.bg.u.uTile, opts.tile * (W / Math.max(1, backdrop.clientWidth)));
      gl.uniform2f(P.bg.u.uShift, -camX * 0.02, camY * 0.015);
      gl.uniform4f(P.bg.u.uRect, rect[0] - par[0] * 0.6, rect[1], rect[2], rect[3]);
      gl.uniform2f(P.bg.u.uShadow, 0.022 + camX * 0.004, 0.018);
      gl.uniform4f(P.bg.u.uSpot, sx + 0.05, 0.38, mobile ? 0.55 : 0.48, 0.75);
      gl.uniform1f(P.bg.u.uBgBlur, 0.8);
      gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      var list = placeShards(p, t, aspect);

      /* ---- 2. far shards: A -> B ---- */
      var src = RT.a;
      if (drawMasks(list, true)) { glassPass(RT.a, RT.b, true); src = RT.b; }

      /* ---- 3. portrait (+ images inside near shards) over src ---- */
      gl.bindFramebuffer(gl.FRAMEBUFFER, src.fb); gl.viewport(0, 0, W, H);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P.portrait.p);
      bind(0, T.portrait, P.portrait.u.uPortrait); bind(1, T.depth, P.portrait.u.uDepth);
      gl.uniform4fv(P.portrait.u.uRect, rect);
      gl.uniform2f(P.portrait.u.uPar, par[0], par[1]);
      gl.uniform1f(P.portrait.u.uPush, push);
      gl.uniform2f(P.portrait.u.uFocus, 0.52, 0.42);
      gl.uniform2f(P.portrait.u.uLight, -0.7, -0.7);
      gl.uniform4f(P.portrait.u.uRim, 1.0, 0.97, 0.9, 0.26);
      gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      var withImg = list.filter(function (e) { return !e.s.back && e.s.slot; });
      if (withImg.length) {
        gl.useProgram(P.overlay.p);
        gl.uniformMatrix4fv(P.overlay.u.uProj, false, proj); gl.uniform2fv(P.overlay.u.uLens, lens);
        bind(0, T.atlas, P.overlay.u.uAtlas); gl.uniform1f(P.overlay.u.uAlpha, 0.78);
        withImg.forEach(function (e) {
          var b = e.s.mesh.bbox;
          gl.uniformMatrix4fv(P.overlay.u.uModel, false, e.m);
          gl.uniform4f(P.overlay.u.uBox, b[0], b[1], b[2], b[3]);
          gl.uniform4fv(P.overlay.u.uRect, e.s.slot);
          gl.bindVertexArray(e.s.mesh.vao);
          if (e.s.mesh.index) gl.drawElements(gl.TRIANGLES, e.s.mesh.count, e.s.mesh.idxType, 0); else gl.drawArrays(gl.TRIANGLES, 0, e.s.mesh.count);
        });
      }
      gl.disable(gl.BLEND);

      /* ---- 4. near shards: src -> C ---- */
      var fin = src;
      if (drawMasks(list, false)) { glassPass(src, RT.c, false); fin = RT.c; }

      /* ---- 5. bloom + finish ---- */
      gl.bindVertexArray(quadVAO);
      function pass(prog, tgt) { gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null); gl.viewport(0, 0, tgt ? tgt.w : W, tgt ? tgt.h : H); gl.useProgram(prog.p); }
      pass(P.bright, RT.bright); bind(0, fin.tex, P.bright.u.uSrc);
      gl.uniform2f(P.bright.u.uTexel, 1 / W, 1 / H); gl.uniform2f(P.bright.u.uThreshold, 0.7, 0.3);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      var b2 = RT.bright, i;
      for (i = 0; i < RT.downs.length; i++) { pass(P.down, RT.downs[i]); bind(0, b2.tex, P.down.u.uSrc); gl.uniform2f(P.down.u.uTexel, 1 / b2.w, 1 / b2.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); b2 = RT.downs[i]; }
      for (i = RT.ups.length - 1; i >= 0; i--) { pass(P.up, RT.ups[i]); bind(0, b2.tex, P.up.u.uSrc); bind(1, RT.downs[i].tex, P.up.u.uDetail); gl.uniform2f(P.up.u.uTexel, 1 / b2.w, 1 / b2.h); gl.uniform1f(P.up.u.uSpread, 0.7); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); b2 = RT.ups[i]; }
      pass(P.comp, null);
      bind(0, fin.tex, P.comp.u.uScene); bind(1, b2.tex, P.comp.u.uBloom);
      gl.uniform2f(P.comp.u.uRes, W, H);
      gl.uniform4f(P.comp.u.uBloomCol, 0.95, 1.0, 0.95, opts.bloom);
      gl.uniform4f(P.comp.u.uTone, 1.05, 0.8, 0.16, opts.saturation);
      gl.uniform3f(P.comp.u.uShadows, 0.06, 0.12, 0.09); gl.uniform3f(P.comp.u.uHighlights, 1.0, 0.97, 0.9); gl.uniform1f(P.comp.u.uGrade, opts.grade);
      gl.uniform4f(P.comp.u.uFinish, 0.3, opts.grain, 1.5, (frameNo++ % 4096));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /* --- loop --- */
    var visible = false, raf = 0, last = 0, perf = { sum: 0, n: 0 };
    function loop(now) {
      raf = 0;
      if (!alive || !visible || document.hidden) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60; last = now;
      try { frame(dt); } catch (e) { console.error('[ScrollHeroGlass]', e); destroy(); return; }
      perf.sum += dt; perf.n++;
      if (perf.n >= 90) { var avg = perf.sum / perf.n; perf.sum = perf.n = 0; if (avg > 1 / 40 && renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.15); W = 0; resize(); } }
      raf = global.requestAnimationFrame(loop);
    }
    function start() { if (!raf && alive) { last = 0; raf = global.requestAnimationFrame(loop); } }
    var io = new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); }, { rootMargin: '200px 0px' });
    io.observe(section);
    function onVis() { if (!document.hidden) start(); }
    document.addEventListener('visibilitychange', onVis);
    mobileQ.addEventListener && mobileQ.addEventListener('change', function () { if (Object.keys(shardMeshes).length) buildShards(); });

    resize();
    ready.then(function () { if (!alive) return; section.classList.add('shf-has-gl'); start(); });

    function destroy() {
      if (!alive) return; alive = false;
      if (raf) global.cancelAnimationFrame(raf);
      io.disconnect(); if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
      global.removeEventListener('pointermove', onPointer); document.removeEventListener('visibilitychange', onVis);
      section.classList.remove('shf-has-gl'); canvas.remove();
      var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    }
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); destroy(); });
    var api = { destroy: destroy, state: function () { return { progress: Ps, shards: shards.length, meshes: Object.keys(shardMeshes).length, images: slots.length, size: [W, H], scale: renderScale }; } };
    section._shfGlass = api;
    return api;
  }

  var attached = new WeakMap();
  function attachAll(scope) {
    Array.prototype.forEach.call((scope || document).querySelectorAll('[data-scroll-hero]'), function (s) {
      if (attached.has(s) || !s.querySelector('.shf-scene')) return;
      var api = attach(s); if (api) attached.set(s, api);
    });
  }
  global.ScrollHeroGlass = { attach: attach, attachAll: attachAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { attachAll(); });
  else attachAll();
})(window);
