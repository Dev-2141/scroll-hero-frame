/* ==========================================================================
   Scroll Hero Frame — Card Orbit engine  v1.0
   Live WebGL2 layer: the subject video + image-slot cards that orbit it.

   - Cards are real image slots (any <img> inside .shf-cards), printed-photo look:
     white border, rounded corners, paper back face, slight paper flex.
   - Lighting per card: warm key + cool fill, glossy sheen that sweeps as cards
     turn, fresnel rim, golden edge glow, depth fog, depth-of-field blur.
   - Cards pass in front of AND behind the subject. With a packed clip
     (<video class="shf-video is-packed">: colour left half, white matte right
     half) the matte decides; with normal footage, "behind" cards are hidden
     wherever the subject is lit (luminance matte, works for dark studios).
   - Golden light ribbons + bokeh dust, then a post chain modelled on THE DAY:
     soft-knee bloom with a dual-Kawase blur chain, filmic toe/shoulder,
     teal/cream grade, vignette, mid-tone grain, triangular dither.
   - Motion is a pure function of a *damped* scroll progress plus slow ambient
     time, with layered value-noise (fbm) on every card: inertia, drift and
     tumble instead of rigid circles.

   Needs scroll-hero.js (for the scrubbed video + progress). No other deps.
   Auto-attaches to every [data-scroll-hero] that contains .shf-cards.
   API: ScrollHeroCards.attach(section, options?) -> { destroy(), state() }
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------- utilities */
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function smoothstep(a, b, x) { return smooth((x - a) / (b - a)); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function damp(dt, tau) { return 1 - Math.exp(-dt / Math.max(tau, 1e-4)); }

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
  /** Smooth 1D value noise, -1..1. */
  function vnoise(x, seed) {
    var i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10);
    return (hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u) * 2 - 1;
  }
  /** Three octaves, roughly -1..1: organic, never repeating. */
  function fbm(x, seed) {
    return vnoise(x, seed) * 0.6 + vnoise(x * 2.03 + 17.1, seed + 31) * 0.28 + vnoise(x * 4.11 + 3.7, seed + 67) * 0.12;
  }

  /* --- tiny mat4 (column-major, like WebGL) --- */
  function m4() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
    return out;
  }
  function lookAt(out, eye, target, up) {
    var zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    var l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  }
  function mul(out, a, b) {
    var r = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var rr = 0; rr < 4; rr++) {
      r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
    }
    out.set(r); return out;
  }
  /** R = Ry(yaw) * Rx(pitch) * Rz(roll), as three columns in a 9-array. */
  function rotYXZ(yaw, pitch, roll) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(roll), sz = Math.sin(roll);
    var a00 = cy, a01 = sy * sx, a02 = sy * cx;
    var a10 = 0, a11 = cx, a12 = -sx;
    var a20 = -sy, a21 = cy * sx, a22 = cy * cx;
    return [
      a00 * cz + a01 * sz, a10 * cz + a11 * sz, a20 * cz + a21 * sz,
      -a00 * sz + a01 * cz, -a10 * sz + a11 * cz, -a20 * sz + a21 * cz,
      a02, a12, a22
    ];
  }

  /* --------------------------------------------------------------- shaders */
  var HEAD = '#version 300 es\nprecision highp float;\n';
  var COMMON = [
    'float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0; }',
    'float gnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);',
    '  float a = dot(hash22(i), f), b = dot(hash22(i+vec2(1,0)), f-vec2(1,0)), c = dot(hash22(i+vec2(0,1)), f-vec2(0,1)), d = dot(hash22(i+vec2(1,1)), f-vec2(1,1));',
    '  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y); }',
    'float fbm3(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<3;i++){ s += a*gnoise(p); p = p*2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }',
    // Subject mapping: screen uv (top-left origin) -> video uv. uPacked = 1: colour left half, matte right half.
    'uniform sampler2D uSubject; uniform vec4 uSubjectMap; uniform vec4 uSubjectFocus; uniform vec2 uMatte; uniform vec2 uRes; uniform float uPacked;',
    'vec2 subjectUV(vec2 s){ vec2 uv = uSubjectMap.zw + s * uSubjectMap.xy; return uSubjectFocus.xy + (uv - uSubjectFocus.xy) / uSubjectFocus.z; }',
    'vec3 subjectColor(vec2 uv){ uv = clamp(uv, vec2(0.0015), vec2(0.9985)); return texture(uSubject, uPacked > 0.5 ? vec2(uv.x * 0.5, uv.y) : uv).rgb; }',
    'float subjectCover(){ vec2 s = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y); vec2 uv = clamp(subjectUV(s), vec2(0.0015), vec2(0.9985));',
    '  if (uPacked > 0.5) return smoothstep(0.2, 0.8, texture(uSubject, vec2(0.5 + uv.x * 0.5, uv.y)).r);',
    '  return smoothstep(uMatte.x, uMatte.y, luma(texture(uSubject, uv).rgb)); }'
  ].join('\n');

  var QUAD_VS = HEAD + 'layout(location=0) in vec2 aPos; out vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';

  var SUBJECT_FS = HEAD + COMMON + '\n' + [
    'in vec2 vUv; out vec4 o;',
    'uniform vec4 uSubjectGrade; // exposure, warmth, -, -',
    'void main(){',
    '  vec2 s = vec2(vUv.x, 1.0 - vUv.y);',
    '  vec3 c = subjectColor(subjectUV(s));',
    '  c *= uSubjectGrade.x;',
    '  c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.94), uSubjectGrade.y);',
    '  o = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var CARD_VS = HEAD + [
    'layout(location=0) in vec2 aPos;',
    'layout(location=1) in vec4 aM0; layout(location=2) in vec4 aM1; layout(location=3) in vec4 aM2; layout(location=4) in vec4 aM3;',
    'layout(location=5) in vec4 aRect;  // atlas rect (w <= 0: empty slot)',
    'layout(location=6) in vec4 aP;     // bend, alpha, blur, behind',
    'layout(location=7) in vec4 aQ;     // seed, aspect, light, -',
    'uniform mat4 uViewProj; uniform vec2 uLens;',
    'out vec2 vUv; out vec3 vN; out vec3 vWorld; out vec4 vRect; out vec4 vP; out vec4 vQ;',
    'void main(){',
    '  mat4 M = mat4(aM0, aM1, aM2, aM3);',
    '  vec2 p = aPos;',
    '  float bend = aP.x;',
    '  float z = bend * (p.x * p.x * 4.0 - 0.33) + bend * 0.35 * (p.y * p.y * 4.0 - 0.33) * sign(bend);',
    '  vec3 nl = vec3(-bend * 8.0 * p.x, -bend * 0.35 * 8.0 * p.y * sign(bend), 1.0);',
    '  float sw = dot(aM0.xyz, aM0.xyz), sh = dot(aM1.xyz, aM1.xyz);',
    '  vN = normalize(mat3(M) * vec3(nl.x / sw, nl.y / sh, nl.z));',
    '  vec4 world = M * vec4(p, z, 1.0);',
    '  vWorld = world.xyz; vUv = p + 0.5; vRect = aRect; vP = aP; vQ = aQ;',
    '  vec4 clip = uViewProj * world; clip.xy += uLens * clip.w;',
    '  gl_Position = clip;',
    '}'
  ].join('\n');

  var CARD_FS = HEAD + COMMON + '\n' + [
    'in vec2 vUv; in vec3 vN; in vec3 vWorld; in vec4 vRect; in vec4 vP; in vec4 vQ; out vec4 o;',
    'uniform sampler2D uAtlas;',
    'uniform vec3 uCamPos; uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uFillDir; uniform vec3 uFillCol; uniform vec3 uFogCol;',
    'uniform vec4 uScene;  // light ramp, time, fog start, fog range',
    'uniform vec4 uLook;   // sheen, rim, edge glow, border',
    'float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }',
    'void main(){',
    '  float aspect = vQ.y; vec2 size = vec2(aspect, 1.0);',
    '  vec2 p = (vUv - 0.5) * size;',
    '  float blur = vP.z;',
    '  float d = sdRound(p, size * 0.5, 0.03);',
    '  float aa = fwidth(d) * 1.25 + blur * 0.03;',
    '  float shape = 1.0 - smoothstep(-aa, aa, d);',
    '  if (shape <= 0.003) discard;',
    '  float border = uLook.w;',
    '  float di = sdRound(p, size * 0.5 - border, 0.012);',
    '  float inImg = 1.0 - smoothstep(-aa, aa, di);',
    '  bool empty = vRect.z <= 0.0;',
    '  float fib = fbm3(vUv * vec2(aspect, 1.0) * 38.0 + vQ.x * 13.0);',
    '  vec3 paper = vec3(0.93, 0.905, 0.85) * (0.96 + 0.08 * fib);',
    '  vec3 img = paper;',
    '  vec2 iuv = (p + size * 0.5 - border) / (size - 2.0 * border);',
    '  iuv = vec2(iuv.x, 1.0 - iuv.y);',
    '  if (!empty) {',
    '    vec2 auv = vRect.xy + clamp(iuv, 0.0, 1.0) * vRect.zw;',
    '    float lod = blur * 3.2;',
    '    vec3 s = texture(uAtlas, auv, lod).rgb * 0.3;',
    '    float rad = blur * 0.018;',
    '    for (int k = 0; k < 6; k++) { float a = float(k) * 1.0472 + 0.4; s += texture(uAtlas, auv + vec2(cos(a), sin(a)) * rad * vRect.zw / size, lod).rgb * 0.1166; }',
    '    img = s;',
    '    img = mix(img, img * 0.94 + 0.03, 0.6) + (hash12(iuv * 900.0 + vQ.x) - 0.5) * 0.025;',
    '  } else {',
    '    vec2 q = abs(iuv - 0.5);',
    '    float plus = (1.0 - smoothstep(0.004, 0.012, min(q.x, q.y))) * step(max(q.x, q.y), 0.08);',
    '    img = vec3(0.05, 0.045, 0.06) + 0.25 * plus + 0.05 * (1.0 - smoothstep(0.0, 0.5, length(iuv - 0.5)));',
    '  }',
    '  vec3 albedo = mix(paper, img, inImg);',
    '  vec3 N = normalize(vN);',
    '  vec3 V = normalize(uCamPos - vWorld);',
    '  if (!gl_FrontFacing) { N = -N; albedo = vec3(0.80, 0.77, 0.72) * (0.94 + 0.1 * fib); }',
    '  vec3 L = normalize(uKeyDir), F = normalize(uFillDir);',
    '  float ndl = dot(N, L);',
    '  float key = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);',
    '  float fill = clamp((dot(N, F) + 0.5) / 1.5, 0.0, 1.0);',
    '  vec3 H = normalize(L + V);',
    '  float nh = max(dot(N, H), 0.0);',
    '  float gloss = mix(0.55, 1.0, inImg);',
    '  float spec = (pow(nh, 90.0) * 1.7 + pow(nh, 14.0) * 0.2) * gloss * uLook.x;',
    '  float nv = abs(dot(N, V));',
    '  float rim = pow(1.0 - nv, 3.0) * uLook.y;',
    '  float edge = (1.0 - smoothstep(0.0, 0.035, abs(d + 0.006))) * (0.35 + 0.65 * max(ndl, 0.0)) * uLook.z;',
    '  vec3 col = albedo * (vec3(0.13, 0.115, 0.12) + uKeyCol * key + uFillCol * fill * 0.5);',
    '  col += uKeyCol * spec + vec3(1.0, 0.72, 0.42) * rim * (0.4 + 0.6 * key) + vec3(1.0, 0.68, 0.36) * edge;',
    '  col *= uScene.x * vQ.z;',
    '  float dist = length(uCamPos - vWorld);',
    '  float fog = smoothstep(uScene.z, uScene.z + uScene.w, dist);',
    '  col = mix(col, uFogCol, fog * 0.85);',
    '  float alpha = shape * vP.y;',
    '  alpha *= 1.0 - subjectCover() * vP.w;',
    '  o = vec4(col * alpha, alpha);',
    '}'
  ].join('\n');

  var RIBBON_VS = HEAD + [
    'layout(location=0) in vec2 aPos; layout(location=1) in vec4 aD; // u, side, alpha, behind',
    'out vec4 vD; void main(){ vD = aD; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');
  var RIBBON_FS = HEAD + COMMON + '\n' + [
    'in vec4 vD; out vec4 o; uniform vec3 uColor; uniform float uStrength;',
    'void main(){',
    '  float side = vD.y;',
    '  float core = exp(-side * side * 22.0);',
    '  float glow = exp(-side * side * 3.0) * 0.35;',
    '  float along = smoothstep(0.0, 0.85, vD.x) * (1.0 - smoothstep(0.97, 1.0, vD.x));',
    '  float a = (core + glow) * along * vD.z * uStrength;',
    '  a *= 1.0 - subjectCover() * vD.w;',
    '  vec3 c = mix(uColor, vec3(1.0, 0.95, 0.85), core * 0.6);',
    '  o = vec4(c * a, 0.0);',
    '}'
  ].join('\n');

  var DUST_VS = HEAD + [
    'layout(location=0) in vec2 aPos; layout(location=1) in vec4 aD; // size px, alpha, behind, bokeh',
    'out vec4 vD; void main(){ vD = aD; gl_PointSize = aD.x; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');
  var DUST_FS = HEAD + COMMON + '\n' + [
    'in vec4 vD; out vec4 o; uniform vec3 uColor;',
    'void main(){',
    '  vec2 q = gl_PointCoord * 2.0 - 1.0; float r = length(q);',
    '  if (r > 1.0) discard;',
    '  float disc = 1.0 - smoothstep(0.55, 1.0, r);',
    '  float ring = smoothstep(0.6, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));',
    '  float a = mix(disc, disc * 0.55 + ring * 0.6, vD.w) * vD.y;',
    '  a *= 1.0 - subjectCover() * vD.z;',
    '  o = vec4(uColor * a, 0.0);',
    '}'
  ].join('\n');

  /* --- post (after THE DAY's PostProcessor) --- */
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
    'uniform sampler2D uScene; uniform sampler2D uBloom;',
    'uniform vec4 uBloomCol;   // tint, strength',
    'uniform vec4 uTone;       // exposure, filmic, contrast, saturation',
    'uniform vec3 uShadows; uniform vec3 uHighlights; uniform float uGrade;',
    'uniform vec4 uFinish;     // vignette, grain, dither, seed',
    'vec3 shoulder(vec3 x){ vec3 over = max(x - 0.8, 0.0); return min(x, 0.8) + 0.2 * (1.0 - exp(-over / 0.2)); }',
    'vec3 toe(vec3 x){ vec3 inv = 1.0 - clamp(x, 0.0, 1.0); return x - x * inv * inv * inv * 0.9; }',
    'void main(){',
    '  vec2 px = gl_FragCoord.xy;',
    '  vec3 c = texture(uScene, vUv).rgb;',
    '  vec3 bloom = texture(uBloom, vUv).rgb * uBloomCol.rgb * uBloomCol.a;',
    '  c = 1.0 - (1.0 - clamp(c, 0.0, 1.5)) * (1.0 - clamp(bloom, 0.0, 1.0));',
    '  vec3 e = c * uTone.x;',
    '  c = mix(c, toe(shoulder(e)), uTone.y);',
    '  c = clamp(c, 0.0, 1.0);',
    '  c = mix(c, c * c * (3.0 - 2.0 * c), uTone.z);',
    '  float l = luma(c);',
    '  c += (uShadows - vec3(luma(uShadows))) * (1.0 - l) * (1.0 - l) * uGrade * 0.5;',
    '  c += (uHighlights - vec3(luma(uHighlights))) * l * l * uGrade * 0.35;',
    '  c = mix(vec3(luma(c)), c, uTone.w);',
    '  vec2 v = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);',
    '  c *= 1.0 - smoothstep(0.5, 1.35, length(v) * 1.1) * uFinish.x;',
    '  float g = hash12(px + uFinish.w * 17.0) - 0.5;',
    '  c += g * uFinish.y * (0.4 + 0.6 * (1.0 - abs(2.0 * luma(c) - 1.0)));',
    '  float dither = hash12(px + uFinish.w * 3.1 + 11.0) + hash12(px.yx + uFinish.w * 5.7 + 23.0) - 1.0;',
    '  c += dither * uFinish.z / 255.0;',
    '  o = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------- GL helpers */
  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('Shader: ' + log); }
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
  function target(gl, w, h, fmt) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, gl.RGBA, fmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fb: f, w: w, h: h };
  }
  function freeTarget(gl, t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

  /* ---------------------------------------------------------------- defaults */
  var DEFAULTS = {
    count: 34,                 // cards on desktop (mobile uses ~60%)
    subjectX: 0.40,            // where the orbit centres on screen (0..1)
    subjectY: 0.46,
    matte: [0.07, 0.24],       // luma range treated as "subject" (plain, unpacked footage)
    subjectPush: 0.05,         // extra camera push on the video (0 = none)
    ambient: 1,                // slow drift when not scrolling
    seed: 7,
    bloom: 0.9,
    grain: 0.035,
    maxDpr: 1.5
  };

  function readOptions(el, opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    var d = el ? el.dataset : {};
    if (d.count) o.count = parseInt(d.count, 10);
    if (d.subjectX) o.subjectX = parseFloat(d.subjectX);
    if (d.subjectY) o.subjectY = parseFloat(d.subjectY);
    if (d.matte) o.matte = d.matte.split(',').map(parseFloat);
    if (d.subjectPush) o.subjectPush = parseFloat(d.subjectPush);
    if (d.ambient) o.ambient = parseFloat(d.ambient);
    if (d.seed) o.seed = parseInt(d.seed, 10);
    if (d.bloom) o.bloom = parseFloat(d.bloom);
    if (d.grain) o.grain = parseFloat(d.grain);
    if (opts) for (k in opts) o[k] = opts[k];
    return o;
  }

  /* ------------------------------------------------------------------ engine */
  function attach(section, userOpts) {
    var backdrop = section.querySelector('.shf-backdrop');
    var holder = section.querySelector('.shf-cards');
    var video = section.querySelector('.shf-video');
    if (!backdrop) return null;
    var opts = readOptions(holder, userOpts);
    var reduced = global.matchMedia('(prefers-reduced-motion: reduce)');
    var mobileQ = global.matchMedia('(max-width: 820px)');

    var canvas = document.createElement('canvas');
    canvas.className = 'shf-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) return null;   // no WebGL2: the plain scrubbed video stays visible
    backdrop.insertBefore(canvas, backdrop.querySelector('.shf-shade'));

    var floatExt = gl.getExtension('EXT_color_buffer_float');
    var FMT = floatExt ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic');

    var P;
    try {
      P = {
        subject: program(gl, QUAD_VS, SUBJECT_FS),
        card: program(gl, CARD_VS, CARD_FS),
        ribbon: program(gl, RIBBON_VS, RIBBON_FS),
        dust: program(gl, DUST_VS, DUST_FS),
        bright: program(gl, QUAD_VS, BRIGHT_FS),
        down: program(gl, QUAD_VS, DOWN_FS),
        up: program(gl, QUAD_VS, UP_FS),
        comp: program(gl, QUAD_VS, COMPOSITE_FS)
      };
    } catch (err) {
      console.warn('[ScrollHeroCards] WebGL setup failed, keeping the plain video.', err);
      canvas.remove(); return null;
    }

    /* --- geometry --- */
    var quadVAO = gl.createVertexArray(); gl.bindVertexArray(quadVAO);
    var qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // card: subdivided sheet so it can flex
    var GX = 14, GY = 8, verts = [], idx = [];
    for (var gy = 0; gy <= GY; gy++) for (var gx = 0; gx <= GX; gx++) verts.push(gx / GX - 0.5, gy / GY - 0.5);
    for (gy = 0; gy < GY; gy++) for (gx = 0; gx < GX; gx++) {
      var a = gy * (GX + 1) + gx, b = a + 1, c = a + GX + 1, d2 = c + 1;
      idx.push(a, b, c, b, d2, c);
    }
    var cardVAO = gl.createVertexArray(); gl.bindVertexArray(cardVAO);
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    var INST = 28; // floats per instance
    var MAXC = 80;
    var instData = new Float32Array(MAXC * INST);
    var sorted = new Float32Array(MAXC * INST);
    var instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
    for (var loc = 1; loc <= 7; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, INST * 4, (loc - 1) * 16);
      gl.vertexAttribDivisor(loc, 1);
    }

    // ribbons + dust: dynamic 2D buffers (x, y, d0..d3)
    var RIB = 7, RSEG = 56;
    var ribData = new Float32Array(RIB * (RSEG + 1) * 2 * 6);
    var ribVAO = gl.createVertexArray(); gl.bindVertexArray(ribVAO);
    var rbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, rbuf); gl.bufferData(gl.ARRAY_BUFFER, ribData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

    var DUSTN = 150;
    var dustData = new Float32Array(DUSTN * 6);
    var dustVAO = gl.createVertexArray(); gl.bindVertexArray(dustVAO);
    var dbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, dustData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    gl.bindVertexArray(null);

    /* --- textures --- */
    function blankTex(rgba) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    var subjectTex = blankTex([5, 5, 6, 255]);
    var subjectSize = [16, 9];
    var subjectDirty = false;
    var packed = !!(video && video.classList.contains('is-packed'));
    var subjectIsPacked = false;
    var atlasTex = blankTex([0, 0, 0, 255]);
    var slots = [];
    var alive = true;

    function uploadSubject(source, w, h) {
      if (!w || !h) return;
      try {
        gl.bindTexture(gl.TEXTURE_2D, subjectTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        subjectIsPacked = packed && source === video;
        subjectSize = [subjectIsPacked ? w / 2 : w, h];
      } catch (e) {
        if (!uploadSubject.warned) { uploadSubject.warned = true; console.warn('[ScrollHeroCards] Cannot read the video into WebGL (serve the page over http, same origin).', e); }
      }
    }
    var videoShown = false;
    // poster first, so there is a subject before the video decodes (poster = colour frame only)
    if (video && video.poster) {
      var poster = new Image();
      poster.onload = function () { if (!videoShown) uploadSubject(poster, poster.naturalWidth, poster.naturalHeight); };
      poster.src = video.poster;
    }
    function markDirty() { subjectDirty = true; }
    if (video) {
      ['loadeddata', 'seeked', 'canplay'].forEach(function (ev) { video.addEventListener(ev, markDirty); });
      if (video.requestVideoFrameCallback) {
        var onFrame = function () { subjectDirty = true; if (alive) video.requestVideoFrameCallback(onFrame); };
        video.requestVideoFrameCallback(onFrame);
      }
    }

    function buildAtlas() {
      var imgs = holder ? Array.prototype.slice.call(holder.querySelectorAll('img')) : [];
      var n = Math.max(1, imgs.length);
      var cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      var maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
      var cell = Math.min(640, Math.floor(maxTex / Math.max(cols, rows)));
      var cv = document.createElement('canvas'); cv.width = cols * cell; cv.height = rows * cell;
      var cx = cv.getContext('2d');
      cx.fillStyle = '#111'; cx.fillRect(0, 0, cv.width, cv.height);
      return Promise.all(imgs.map(function (im) {
        var src = im.currentSrc || im.src || im.dataset.src;
        return new Promise(function (res) {
          if (im.complete && im.naturalWidth) return res(im);
          var t = new Image(); t.onload = function () { res(t); }; t.onerror = function () { res(null); }; t.src = src;
        });
      })).then(function (loaded) {
        slots = [];
        loaded.forEach(function (im, i) {
          var col = i % cols, row = Math.floor(i / cols);
          if (!im || !im.naturalWidth) { slots.push({ rect: [0, 0, 0, 0], aspect: 1.5 }); return; }
          var ar = im.naturalWidth / im.naturalHeight;
          var w = ar >= 1 ? cell : Math.round(cell * ar), h = ar >= 1 ? Math.round(cell / ar) : cell;
          var x = col * cell + (cell - w) / 2, y = row * cell + (cell - h) / 2;
          cx.drawImage(im, x, y, w, h);
          slots.push({ rect: [(x + 1) / cv.width, (y + 1) / cv.height, (w - 2) / cv.width, (h - 2) / cv.height], aspect: clamp(ar, 0.55, 1.9) });
        });
        if (!slots.length) slots.push({ rect: [0, 0, 0, 0], aspect: 1.5 });
        try {
          gl.bindTexture(gl.TEXTURE_2D, atlasTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        } catch (e) {
          console.warn('[ScrollHeroCards] Card images could not be uploaded (serve over http, same origin). Showing empty slots.', e);
          slots = slots.map(function (s) { return { rect: [0, 0, 0, 0], aspect: s.aspect }; });
        }
        assignCards();
      });
    }

    /* --- card definitions (seeded) --- */
    var cards = [];
    function assignCards() {
      var rnd = mulberry32(opts.seed * 9973 + 11);
      var count = Math.min(MAXC, Math.round(opts.count * (mobileQ.matches ? 0.62 : 1)));
      var order = slots.map(function (_, i) { return i; });
      cards = [];
      for (var i = 0; i < count; i++) {
        if (i % order.length === 0) for (var s = order.length - 1; s > 0; s--) { var j = Math.floor(rnd() * (s + 1)); var t = order[s]; order[s] = order[j]; order[j] = t; }
        var slot = slots[order[i % order.length]];
        var far = rnd();
        cards.push({
          slot: slot,
          a0: i / count * TAU * 2.618 + rnd() * 0.7,
          r: mix(1.45, 3.4, Math.pow(far, 0.85)),
          y0: (rnd() - 0.5) * 2.7,
          speed: 0.55 + rnd() * 0.65,
          size: 0.48 + rnd() * 0.34,
          appear: rnd() * 0.42,
          roll0: (rnd() - 0.5) * 0.9,
          yawBias: (rnd() - 0.5) * 0.8,
          light: 0.82 + rnd() * 0.3,
          seed: i * 7 + 3
        });
      }
    }

    var ribbons = [];
    (function () {
      var rnd = mulberry32(opts.seed * 31 + 5);
      for (var i = 0; i < RIB; i++) ribbons.push({ a0: rnd() * TAU, r: mix(1.6, 3.5, rnd()), y0: (rnd() - 0.5) * 1.8, speed: 0.6 + rnd() * 0.6, len: 0.9 + rnd() * 1.4, width: 1.6 + rnd() * 2.6, appear: 0.08 + rnd() * 0.35, seed: 400 + i * 13 });
    })();
    var dust = [];
    (function () {
      var rnd = mulberry32(opts.seed * 53 + 9);
      for (var i = 0; i < DUSTN; i++) dust.push({ x: (rnd() - 0.5) * 8, y: (rnd() - 0.5) * 4.6, z: (rnd() - 0.5) * 7 - 0.5, s: 0.5 + rnd(), seed: 900 + i });
    })();

    /* --- render targets --- */
    var W = 1, H = 1, RT = null, renderScale = 1;
    function makeTargets() {
      if (RT) { freeTarget(gl, RT.scene); freeTarget(gl, RT.bright); RT.downs.forEach(function (t) { freeTarget(gl, t); }); RT.ups.forEach(function (t) { freeTarget(gl, t); }); }
      var bw = Math.max(1, W >> 1), bh = Math.max(1, H >> 1);
      RT = { scene: target(gl, W, H, FMT), bright: target(gl, bw, bh, FMT), downs: [], ups: [] };
      var w = bw, h = bh;
      for (var i = 0; i < 4; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); RT.downs.push(target(gl, w, h, FMT)); }
      for (i = 0; i < 3; i++) RT.ups.push(target(gl, RT.downs[i].w, RT.downs[i].h, FMT));
    }
    function resize() {
      var r = backdrop.getBoundingClientRect();
      var dpr = Math.min(global.devicePixelRatio || 1, mobileQ.matches ? 1.25 : opts.maxDpr) * renderScale;
      var w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
      if (w === W && h === H && RT) return;
      W = w; H = h; canvas.width = W; canvas.height = H;
      makeTargets();
    }
    var ro = global.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(backdrop); else global.addEventListener('resize', resize);

    /* --- input: damped scroll, swirl, pointer parallax --- */
    var Pt = 0, Ps = -1, Pprev = 0, swirl = 0, ambientT = 0;
    var pointer = { tx: 0, ty: 0, x: 0, y: 0 };
    function onPointer(e) { if (e.pointerType !== 'mouse') return; pointer.tx = e.clientX / global.innerWidth * 2 - 1; pointer.ty = e.clientY / global.innerHeight * 2 - 1; }
    global.addEventListener('pointermove', onPointer, { passive: true });

    function rawProgress() {
      if (section._shf && section._shf.progress) return section._shf.progress();
      var vh = global.innerHeight, rect = section.getBoundingClientRect();
      return clamp((vh - rect.top) / Math.max(1, rect.height), 0, 1);
    }

    /* --- per-frame state --- */
    var view = m4(), proj = m4(), viewProj = m4();
    var cam = [0, 0, 7], camTarget = [0, 0, 0];
    var lens = [0, 0];

    function project(x, y, z, out) {
      var m = viewProj;
      var cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      var cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      var cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      cx += lens[0] * cw; cy += lens[1] * cw;
      out[0] = cx / cw; out[1] = cy / cw; out[2] = cw; return out;
    }

    // the orbit ring is tilted toward the camera and rolled a little, like the reference shot
    var ringTilt = -0.32, ringRoll = 0.16;
    var cR = Math.cos(ringRoll), sR = Math.sin(ringRoll), cT = Math.cos(ringTilt), sT = Math.sin(ringTilt);
    function ringPoint(rr, th, y, out) {
      var lx = rr * Math.cos(th), ly = y, lz = rr * Math.sin(th) * 0.85;
      var y1 = ly * cT - lz * sT, z1 = ly * sT + lz * cT;
      out[0] = lx * cR - y1 * sR; out[1] = lx * sR + y1 * cR; out[2] = z1;
      return out;
    }

    var tmp = [0, 0, 0], tmp2 = [0, 0, 0], tmpP = [0, 0, 0], tmpQ = [0, 0, 0];
    var order = [];
    var frameNo = 0;

    function update(dt) {
      Pt = rawProgress();
      if (Ps < 0) { Ps = Pt; Pprev = Pt; }
      Ps += (Pt - Ps) * damp(dt, 0.32);                                // inertia
      var vel = (Ps - Pprev) / Math.max(dt, 1e-3); Pprev = Ps;
      swirl += (clamp(vel, -2, 2) * 0.55 - swirl) * damp(dt, 0.6);     // leans into fast scrolls, settles back
      if (!reduced.matches) ambientT += dt * opts.ambient;
      pointer.x += (pointer.tx - pointer.x) * damp(dt, 0.7);
      pointer.y += (pointer.ty - pointer.y) * damp(dt, 0.7);
    }

    function frame(dt) {
      update(dt);
      var p = Ps, T = ambientT;
      var aspect = W / H;
      var mobile = mobileQ.matches;
      var orbitScale = clamp(aspect / 1.78, mobile ? 0.62 : 0.72, 1.0);

      // camera: push-in + handheld drift (fbm) + pointer parallax
      var push = smooth(p);
      var hx = fbm(T * 0.11, 3) * 0.06 + pointer.x * 0.16, hy = fbm(T * 0.09, 5) * 0.045 - pointer.y * 0.1;
      cam[0] = hx; cam[1] = hy; cam[2] = 7.4 - 1.35 * push;
      camTarget[0] = hx * 0.35; camTarget[1] = hy * 0.35; camTarget[2] = 0;
      var fov = 33 * Math.PI / 180;
      perspective(proj, fov, aspect, 0.1, 60);
      lookAt(view, cam, camTarget, [fbm(T * 0.07, 9) * 0.012, 1, 0]);
      mul(viewProj, proj, view);
      lens[0] = opts.subjectX * 2 - 1; lens[1] = (1 - opts.subjectY) * 2 - 1;
      var focus = cam[2];
      var focalPx = H / (2 * Math.tan(fov / 2));
      var lightRamp = 0.38 + 0.62 * smooth(Math.min(1, p * 1.35));

      /* ---- subject mapping (object-fit: cover + push + drift) ---- */
      var vA = subjectSize[0] / subjectSize[1];
      var sx = 1, sy = 1;
      if (aspect > vA) sy = vA / aspect; else sx = aspect / vA;
      var pos = mobile ? [0.42, 0.5] : [0.5, 0.42];
      var sPush = 1 + opts.subjectPush * push;
      var drift = [-hx * 0.012, hy * 0.012];
      var map = [sx, sy, (1 - sx) * pos[0] + drift[0], (1 - sy) * pos[1] + drift[1]];
      var focusUV = [map[2] + opts.subjectX * sx, map[3] + opts.subjectY * sy, sPush, 0];

      /* ---- cards ---- */
      var n = cards.length, i;
      order.length = 0;
      for (i = 0; i < n; i++) {
        var c = cards[i];
        var vis = smoothstep(c.appear, c.appear + 0.14, p + 0.04);
        if (vis <= 0.002) continue;
        var th = c.a0 + p * TAU * 0.62 * c.speed + T * 0.022 * c.speed + swirl * c.speed;
        var rr = c.r * (1.14 - 0.24 * push) + fbm(p * 1.8 + T * 0.03, c.seed) * 0.28;
        var y = c.y0 + 0.28 * Math.sin(th * 0.7 + c.seed) + fbm(p * 1.4 + T * 0.04, c.seed + 50) * 0.3;
        ringPoint(rr, th, y, tmp);
        var wx = tmp[0] * orbitScale, wy = tmp[1] * orbitScale, wz = tmp[2] * orbitScale;
        wx += fbm(p * 2.2 + T * 0.05, c.seed + 70) * 0.18;
        wy += fbm(p * 2.0 + T * 0.05, c.seed + 80) * 0.14;
        // mostly facing the camera, swinging as they travel round; now and then one shows its back
        var yaw = 0.55 * Math.sin(th) + c.yawBias + fbm(p * 1.6 + T * 0.035, c.seed + 90) * 0.95;
        var pitch = fbm(p * 1.3 + T * 0.03, c.seed + 120) * 0.75 - 0.08;
        var roll = c.roll0 + fbm(p * 2.1 + T * 0.04, c.seed + 150) * 0.55 + swirl * 0.25;
        var bend = fbm(p * 3.1 + T * 0.09, c.seed + 180) * 0.11;
        var R = rotYXZ(yaw, pitch, roll);
        var hgt = c.size * orbitScale * (0.75 + 0.25 * vis), wid = hgt * c.slot.aspect;
        var dx = wx - cam[0], dy = wy - cam[1], dz = wz - cam[2];
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var blur = clamp(Math.abs(dist - focus) * 0.36 - 0.1, 0, 1) * (dist < focus ? 1.25 : 1);
        var behind = smoothstep(0.15, -0.45, wz);
        var o = order.length * INST;
        order.push({ d: dist, i: o });
        var D = instData;
        D[o] = R[0] * wid; D[o + 1] = R[1] * wid; D[o + 2] = R[2] * wid; D[o + 3] = 0;
        D[o + 4] = R[3] * hgt; D[o + 5] = R[4] * hgt; D[o + 6] = R[5] * hgt; D[o + 7] = 0;
        D[o + 8] = R[6]; D[o + 9] = R[7]; D[o + 10] = R[8]; D[o + 11] = 0;
        D[o + 12] = wx; D[o + 13] = wy; D[o + 14] = wz; D[o + 15] = 1;
        var rc = c.slot.rect;
        D[o + 16] = rc[0]; D[o + 17] = rc[1]; D[o + 18] = rc[2]; D[o + 19] = rc[3];
        D[o + 20] = bend; D[o + 21] = vis; D[o + 22] = clamp(blur, 0, 1); D[o + 23] = behind;
        D[o + 24] = c.seed; D[o + 25] = c.slot.aspect; D[o + 26] = c.light; D[o + 27] = 0;
      }
      order.sort(function (a, b) { return b.d - a.d; });   // back to front
      for (i = 0; i < order.length; i++) sorted.set(instData.subarray(order[i].i, order[i].i + INST), i * INST);

      /* ---- ribbons ---- */
      var rv = 0, ribRanges = [];
      for (var r = 0; r < ribbons.length; r++) {
        var rb = ribbons[r];
        var ra = smoothstep(rb.appear, rb.appear + 0.2, p) * (0.55 + 0.45 * smooth((Math.sin(T * 0.21 + rb.seed) + 1) / 2));
        var start = rv;
        var head = rb.a0 + p * TAU * 0.62 * rb.speed + T * 0.03 * rb.speed + swirl * rb.speed;
        for (var k = 0; k <= RSEG; k++) {
          var u = k / RSEG;
          var a1 = head - rb.len * (1 - u);
          var rr2 = rb.r * (1.12 - 0.22 * push) + fbm(a1 * 0.6 + rb.seed, rb.seed) * 0.12;
          ringPoint(rr2, a1, rb.y0 + 0.25 * Math.sin(a1 * 0.7 + rb.seed), tmp);
          project(tmp[0] * orbitScale, tmp[1] * orbitScale, tmp[2] * orbitScale, tmpP);
          var a2 = a1 + rb.len / RSEG;
          ringPoint(rr2, a2, rb.y0 + 0.25 * Math.sin(a2 * 0.7 + rb.seed), tmp2);
          project(tmp2[0] * orbitScale, tmp2[1] * orbitScale, tmp2[2] * orbitScale, tmpQ);
          var ddx = (tmpQ[0] - tmpP[0]) * aspect, ddy = tmpQ[1] - tmpP[1];
          var len = Math.hypot(ddx, ddy) || 1;
          var nx = -ddy / len / aspect, ny = ddx / len;
          var widthPx = rb.width * (focalPx / Math.max(tmpP[2], 0.5)) * 0.0068 * (0.25 + 0.75 * u);
          var wN = widthPx / H * 2;
          var beh = smoothstep(0.15, -0.45, tmp[2] * orbitScale);
          for (var sd = -1; sd <= 1; sd += 2) {
            var q = rv * 6;
            ribData[q] = tmpP[0] + nx * wN * sd; ribData[q + 1] = tmpP[1] + ny * wN * sd;
            ribData[q + 2] = u; ribData[q + 3] = sd; ribData[q + 4] = ra * lightRamp; ribData[q + 5] = beh;
            rv++;
          }
        }
        ribRanges.push([start, rv - start]);
      }

      /* ---- dust ---- */
      for (i = 0; i < DUSTN; i++) {
        var ds = dust[i];
        var px = ds.x + fbm(T * 0.05 + ds.seed, ds.seed) * 0.5;
        var py = ((ds.y + T * 0.03 * ds.s + p * 0.8 + 2.3) % 4.6 + 4.6) % 4.6 - 2.3;
        var pz = ds.z + fbm(T * 0.04 + ds.seed, ds.seed + 1) * 0.5;
        project(px * orbitScale, py, pz, tmpP);
        var dd = Math.max(0.3, tmpP[2]);
        var near = smoothstep(focus * 0.75, focus * 0.35, dd);
        var size = (0.018 * ds.s * focalPx / dd) * (1 + near * 9);
        var q2 = i * 6;
        dustData[q2] = tmpP[0]; dustData[q2 + 1] = tmpP[1];
        dustData[q2 + 2] = clamp(size, 1, 140 * (H / 900));
        dustData[q2 + 3] = (0.25 + 0.5 * ds.s) * lightRamp * (1 - near * 0.8) * (0.6 + 0.4 * Math.sin(T * 0.7 + ds.seed));
        dustData[q2 + 4] = smoothstep(0.15, -0.45, pz);
        dustData[q2 + 5] = near;
      }

      /* ================= draw ================= */
      gl.viewport(0, 0, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, RT.scene.fb);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

      if (video && subjectDirty && video.readyState >= 2 && video.videoWidth) {
        uploadSubject(video, video.videoWidth, video.videoHeight); subjectDirty = false; videoShown = true;
      }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, subjectTex);
      gl.activeTexture(gl.TEXTURE0);

      function subjectUniforms(prog) {
        gl.uniform1i(prog.u.uSubject, 1);
        gl.uniform4fv(prog.u.uSubjectMap, map);
        gl.uniform4fv(prog.u.uSubjectFocus, focusUV);
        gl.uniform2f(prog.u.uMatte, opts.matte[0], opts.matte[1]);
        gl.uniform2f(prog.u.uRes, W, H);
        gl.uniform1f(prog.u.uPacked, subjectIsPacked ? 1 : 0);
      }

      // 1. subject
      gl.useProgram(P.subject.p); subjectUniforms(P.subject);
      gl.uniform4f(P.subject.u.uSubjectGrade, 1.0, 0.4, 0, 0);
      gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 2. ribbons (additive)
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.ribbon.p); subjectUniforms(P.ribbon);
      gl.uniform3f(P.ribbon.u.uColor, 1.0, 0.66, 0.32); gl.uniform1f(P.ribbon.u.uStrength, 1.5);
      gl.bindVertexArray(ribVAO); gl.bindBuffer(gl.ARRAY_BUFFER, rbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, ribData.subarray(0, rv * 6));
      ribRanges.forEach(function (rg) { gl.drawArrays(gl.TRIANGLE_STRIP, rg[0], rg[1]); });

      // 3. cards (premultiplied, back to front)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P.card.p); subjectUniforms(P.card);
      gl.uniformMatrix4fv(P.card.u.uViewProj, false, viewProj);
      gl.uniform2fv(P.card.u.uLens, lens);
      gl.uniform3fv(P.card.u.uCamPos, cam);
      gl.uniform3f(P.card.u.uKeyDir, 0.75, 0.42, 0.62);
      gl.uniform3f(P.card.u.uKeyCol, 1.38, 1.02, 0.74);
      gl.uniform3f(P.card.u.uFillDir, -0.8, 0.1, 0.5);
      gl.uniform3f(P.card.u.uFillCol, 0.32, 0.36, 0.5);
      gl.uniform3f(P.card.u.uFogCol, 0.02, 0.018, 0.024);
      gl.uniform4f(P.card.u.uScene, lightRamp, T, focus + 1.2, 6.0);
      gl.uniform4f(P.card.u.uLook, 1.0, 0.9, 0.55, 0.045);
      gl.uniform1i(P.card.u.uAtlas, 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.bindVertexArray(cardVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sorted.subarray(0, order.length * INST));
      if (order.length) gl.drawElementsInstanced(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0, order.length);

      // 4. dust (additive)
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.dust.p); subjectUniforms(P.dust);
      gl.uniform3f(P.dust.u.uColor, 1.0, 0.74, 0.46);
      gl.bindVertexArray(dustVAO); gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, dustData);
      gl.drawArrays(gl.POINTS, 0, DUSTN);
      gl.disable(gl.BLEND);

      /* ---- post ---- */
      gl.bindVertexArray(quadVAO);
      function pass(prog, tgt) { gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null); gl.viewport(0, 0, tgt ? tgt.w : W, tgt ? tgt.h : H); gl.useProgram(prog.p); }
      function bindTex(unit, tex, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }

      pass(P.bright, RT.bright);
      bindTex(0, RT.scene.tex, P.bright.u.uSrc);
      gl.uniform2f(P.bright.u.uTexel, 1 / W, 1 / H); gl.uniform2f(P.bright.u.uThreshold, 0.62, 0.32);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      var src = RT.bright;
      for (i = 0; i < RT.downs.length; i++) {
        pass(P.down, RT.downs[i]); bindTex(0, src.tex, P.down.u.uSrc);
        gl.uniform2f(P.down.u.uTexel, 1 / src.w, 1 / src.h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        src = RT.downs[i];
      }
      for (i = RT.ups.length - 1; i >= 0; i--) {
        pass(P.up, RT.ups[i]); bindTex(0, src.tex, P.up.u.uSrc); bindTex(1, RT.downs[i].tex, P.up.u.uDetail);
        gl.uniform2f(P.up.u.uTexel, 1 / src.w, 1 / src.h); gl.uniform1f(P.up.u.uSpread, 0.72);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        src = RT.ups[i];
      }
      pass(P.comp, null);
      bindTex(0, RT.scene.tex, P.comp.u.uScene); bindTex(1, src.tex, P.comp.u.uBloom);
      gl.uniform2f(P.comp.u.uRes, W, H);
      gl.uniform4f(P.comp.u.uBloomCol, 1.0, 0.8, 0.6, opts.bloom);
      gl.uniform4f(P.comp.u.uTone, 1.04, 0.85, 0.18, 0.96);
      gl.uniform3f(P.comp.u.uShadows, 0.08, 0.13, 0.15);
      gl.uniform3f(P.comp.u.uHighlights, 1.0, 0.93, 0.8);
      gl.uniform1f(P.comp.u.uGrade, 0.55);
      gl.uniform4f(P.comp.u.uFinish, 0.35, opts.grain, 1.5, (frameNo++ % 4096));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /* --- loop: only while on screen --- */
    var visible = false, raf = 0, last = 0;
    var perf = { sum: 0, n: 0 };
    function loop(now) {
      raf = 0;
      if (!alive || !visible || document.hidden) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      try { frame(dt); } catch (e) { console.error('[ScrollHeroCards]', e); destroy(); return; }
      // adaptive quality: drop the render scale if frames are slow
      perf.sum += dt; perf.n++;
      if (perf.n >= 90) {
        var avg = perf.sum / perf.n; perf.sum = perf.n = 0;
        if (avg > 1 / 40 && renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.15); W = 0; resize(); }
      }
      raf = global.requestAnimationFrame(loop);
    }
    function start() { if (!raf && alive) { last = 0; raf = global.requestAnimationFrame(loop); } }
    var io = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) start();
    }, { rootMargin: '200px 0px' });
    io.observe(section);
    function onVis() { if (!document.hidden) start(); }
    document.addEventListener('visibilitychange', onVis);

    resize();
    buildAtlas().then(function () {
      if (!alive) return;
      section.classList.add('shf-has-gl');
      start();
    });

    function destroy() {
      if (!alive) return;
      alive = false;
      if (raf) global.cancelAnimationFrame(raf);
      io.disconnect(); if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
      global.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVis);
      section.classList.remove('shf-has-gl');
      canvas.remove();
      var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    }
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); destroy(); });
    var api = {
      destroy: destroy,
      // debug / tuning hook
      state: function () { return { progress: Ps, cards: order.length, slots: slots.length, packed: subjectIsPacked, size: [W, H], scale: renderScale }; }
    };
    section._shfCards = api;
    return api;
  }

  /* ------------------------------------------------------------------- boot */
  var attached = new WeakMap();
  function attachAll(scope) {
    var list = (scope || document).querySelectorAll('[data-scroll-hero]');
    Array.prototype.forEach.call(list, function (s) {
      if (attached.has(s) || !s.querySelector('.shf-cards')) return;
      var api = attach(s);
      if (api) attached.set(s, api);
    });
  }
  global.ScrollHeroCards = { attach: attach, attachAll: attachAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { attachAll(); });
  else attachAll();
})(window);
