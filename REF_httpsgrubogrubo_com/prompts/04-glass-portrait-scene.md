# Prompt 04: Glass portrait scene (green wall, 2.5D portrait, sideways glass shards)

> Give this to an AI coding tool to rebuild, port or extend the current version of the Scroll Hero Frame backdrop.
> Working implementation: `../scroll-hero-frame/scroll-hero-glass.js` (WebGL2, no dependencies).
> Explained with diagrams: `../docs/Report-03-Glass-Build.pdf`. Base frame (text, scroll, reveals): `01-build-scroll-hero-frame.md`.
> The older card version is `03-card-orbit-engine.md` / `scroll-hero-cards.js`.

---

## Goal
Inside the pinned backdrop of the Scroll Hero Frame, render one WebGL2 canvas showing:
1. a **green pebbled-leather wall** (tiled texture) with a soft spotlight behind the subject and a vignette;
2. a **cut-out portrait** that stands grounded at the bottom edge (it does **not** float), with a **2.5D depth effect**;
3. **few glass shards** (6 near, 5 far; phones 4 + 3) made from real shard meshes, **refracting** what is behind them, travelling **sideways** (left to right) with scroll;
4. a filmic finish (bloom, tone, grade, grain, dither).

Do not change the portrait's features: only alpha is added; lighting on it stays subtle.

## Inputs (HTML contract)
```html
<div class="shf-backdrop">
  <div class="shf-scene"
       data-portrait="assets/subject/portrait.png"          (RGBA cut-out)
       data-depth-map="assets/subject/portrait-depth.png"   (grey, white = near)
       data-background="assets/bg/green-leather.jpg"        (seamless tile)
       data-shards="assets/glass/shards.glb"                (meshes Shard_01..07, BG_Shard_01..09)
       data-frost="assets/glass/frost.jpg"                  (grey crack texture)
       data-frost-normal="assets/glass/frost-normal.png"    (normal map)
       data-front="6" data-back="5" data-subject-x="0.36">
    <img src="...">   <!-- optional: images shown inside every other near shard -->
  </div>
  <img class="shf-portrait-fallback" src="assets/subject/portrait.png" alt="">   <!-- no-WebGL fallback -->
  <div class="shf-shade"></div><div class="shf-progress"><span></span></div>
</div>
```
Progress comes from `section._shf.progress()` (scroll-hero.js). Insert `<canvas class="shf-canvas">` before `.shf-shade` and add
`.shf-has-gl` to the section when running. Options: front 6, back 5, subject-x 0.36, portrait-height 1.04, depth 1, speed 1,
tile 360, bloom 0.7, grain 0.03, seed 5.

## Passes per frame
1. **Backdrop → A.** Tile the texture in screen pixels (tile 360px × DPR, REPEAT, mip bias 0.8), shifted by `(-camX*0.02, camY*0.015)`.
   Light: `c *= (0.42 + 0.45*fall) + 0.75*spot` with `spot = exp(-d²/r²)` at (subject-x + 0.05, 0.38), r 0.48 (0.55 phone);
   `fall` = vignette `1 - smoothstep(0.3, 1.25, dist from (0.5, 0.45))`. Cast shadow: sample the portrait alpha at mip 5.5,
   offset (+0.022, +0.018) in screen uv; `c *= 1 - 0.55*shadow`.
2. **Far shards: A → B** via the glass pass (below), softer settings.
3. **Portrait over B** (premultiplied). Rect: height 1.04 of the frame (1.0 on phones), width by image aspect, centred at
   subject-x (0.5 on phones), bottom edge at the frame bottom. Per pixel, 4 iterations of
   `p = focus + (uv - focus)/(1 + push*(0.4 + 0.6*d)) - par*(d - 0.35)` with `d = depth(p)`, focus (0.52, 0.42),
   `push = 0.06*smooth(P)*depth`, `par = (camX*0.012, camY*0.008)*depth`. Rim light: `rim = a - a(p + L*0.014)` × warm white × 0.55
   (L = (-0.7, -0.7)); faint green bounce on the opposite edge; `col *= 0.9 + 0.1*d`.
   Then optional images: draw each near shard's mesh with the atlas image planar-projected from the mesh bbox (alpha 0.78, soft edges).
4. **Near shards: B → C** via the glass pass.
5. **Post:** 13-tap soft-knee bright pass (0.7 / 0.3) → 4 dual-Kawase downsamples → 3 upsamples → composite (bloom tint
   (0.95, 1, 0.95) × 0.7, filmic shoulder/toe, exposure 1.05, S-curve 0.16, grade shadows (0.06, 0.12, 0.09) / highlights
   (1, 0.97, 0.9) at 0.35, vignette 0.3, grain 0.03, dither 1.5).

## Glass pass (port of THE DAY GlassShardPass)
- **Mask:** draw the layer's shards (depth-tested, double-sided) into an RGBA8 target with depth: `rgb = (n_view.xy*0.5 + 0.5, fract(uv))`
  (flip the normal on back faces).
- **Composite:** where the mask is empty, copy the source. Else:
  `nxy = mask.rg*2-1`; `fn = frostNormal(uv)*2-1`; `nd = nxy + fn.xy*k*0.18`; `nz = sqrt(1-|nd|²)`; `rm = frost(uv).r`.
  Offset `= nxy*refraction + fn.xy*k*0.02 + (rm-0.5)*mapStrength*0.012*nxy` (keep it smooth: the noisy normal map must not
  drive large offsets, or the fine wall texture scatters into rainbow noise).
  Sample R/G/B at `offset*(1-disp)`, `offset`, `offset*(1+disp)`; tint; add fresnel `0.04 + 0.96*(1-nz)^power` × pale green-white;
  add frost cracks `smoothstep(0.55, 0.95, rm) × frost`; add sparkle `pow(N·H, 120)` toward light (-0.55, 0.6, 0.6);
  add edge highlight from neighbouring mask normals (`smoothstep(0.02, 0.15, |ΔnX| + |ΔnY|)`). Far layer mixes 18% back to the source (fog).
- Values: near refraction 0.14, dispersion 0.12, mapStrength 2, fresnel 5, edge 0.22, frost 0.22, sparkle 0.7, normal k 0.6;
  far 0.08 / 0.08 / 1 / 6 / 0.10 / 0.12 / 0.25 / 0.5.

## Shard motion (sideways)
Camera at the origin looking down -z, fov 40°. Per shard (seeded): z (near -0.78..-1.23, far -1.9..-2.8), scale
(near (1.0..1.45)×1.275, far 1.15..1.9), speed (near 0.55..0.9, far 0.32..0.5), phase `i/n + jitter`, poses r0, r1, wobble
(amplitude 0.07..0.21 rad, 0.15..0.45 Hz).
- `u = fract(phase + Ps*speed*optSpeed + T*0.012*speed)` (Ps = scroll damped with tau 0.3 s; T = ambient seconds).
- `x = (2u - 1) * (halfWidth(z)*1.25 + 0.25*scale)` so wrap-around happens off-screen; rotation = `mix(r0, r1, u)` + wobble sines.
- **Lanes:** far shards spread over ±0.75 of half-height; near shards use lanes `[0.88, -0.42, 0.8, -0.68, -0.9, 0.96, -0.55, 0.84]`
  of half-height so they pass above the head and across the chest, never over the face.
- Pointer parallax: x -= pointer.x*|z|*0.05, y += pointer.y*|z|*0.035.
- Portrait camera: `camX = (Ps-0.5)*0.9 + pointer.x*0.55 + fbm(T*0.08)*0.12`, `camY = -pointer.y*0.35 + fbm(T*0.07)*0.08`.

## GLB reader
Parse the binary glTF yourself (JSON chunk + BIN chunk): for each node with a mesh, read POSITION / NORMAL / TEXCOORD_0 /
indices through accessors and bufferViews (handle byteStride), apply node scale, keep the bounding box (for image projection).
Meshes named `Shard_*` are near, `BG_Shard_*` far.

## Portrait preparation (tools/cutout_portrait.py)
OpenCV GrabCut seeded by a sharpness map (in-focus subject, blurred background) plus sure-foreground seeds for face, hair core,
ears, chest and shoulders; keep the largest component, fill holes; guided-filter matting; tighten `alpha = smoothstep((a-0.3)/0.55)`;
edge colour decontamination `F = (I - (1-a)B)/a` with B = blurred background estimate. Depth map = sqrt(distance transform) + face dome +
nose bump, blurred. Interior pixels must stay the original photo.

## Acceptance tests
1. Shards visibly refract the wall and the portrait, with colour fringing at the edges; no rainbow pixel noise.
2. Scrolling down moves the shards left to right; stopping leaves a slow sideways drift.
3. The face is never covered by a near shard; far shards pass behind the portrait.
4. Moving the mouse or scrolling makes the portrait read as 3D (near parts shift more), without warping features.
5. The portrait is grounded at the bottom edge with a soft shadow on the wall.
6. Phone layout: portrait centred in the panel, fewer shards, no horizontal scroll. No console errors.
