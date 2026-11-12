# Prompt 03: Card Orbit engine (live lit cards around a scroll-scrubbed subject)

> Give this to an AI coding tool to rebuild, port (React / Three.js / Unity) or extend the Card Orbit layer.
> The working reference implementation is `../scroll-hero-frame/scroll-hero-cards.js` (WebGL2, no dependencies).
> Human-readable explanation with diagrams: `../docs/Report-02-Build-Card-Orbit.pdf`.
> It sits on top of the frame described in `01-build-scroll-hero-frame.md`.

---

## Goal
Inside the pinned backdrop of the Scroll Hero Frame, render one WebGL2 canvas that shows:
1. the **subject video** (scrubbed by scroll elsewhere), cover-fitted, and
2. **30-40 photo-print cards** that orbit and drift around the subject. Each card is an **image slot**, they are **lit like real
   glossy prints**, and they pass **in front of and behind** the subject,
3. golden **light ribbons** and **bokeh dust**, then
4. a cinematic **post chain**: bloom, filmic tone, grade, vignette, grain, dither.

The motion must feel organic and weighty, never like objects locked to a scroll bar.

## Inputs (HTML contract)
```html
<div class="shf-backdrop">
  <video class="shf-video is-packed" src="assets/scroll.mp4" poster="assets/poster.jpg" muted playsinline preload="auto"></video>
  <div class="shf-cards" data-count="34" data-subject-x="0.40" data-subject-y="0.46">
    <img src="assets/cards/a.jpg" alt=""> ...   <!-- every img = one card face; cards cycle through them -->
  </div>
  <div class="shf-shade"></div> <div class="shf-progress"><span></span></div>
</div>
```
- `is-packed`: the video is 2x wide: colour on the left half, the subject's white-on-black matte on the right half.
- Progress comes from `section._shf.progress()` (0..1), published by `scroll-hero.js`. Do not measure scroll separately.
- Insert `<canvas class="shf-canvas">` before `.shf-shade`; add `.shf-has-gl` to the section when running (CSS hides the video
  with opacity 0, so it keeps decoding).

Options (data attributes on `.shf-cards`): count 34, subject-x 0.40, subject-y 0.46, subject-push 0.05,
matte "0.07,0.24" (luma range for unpacked footage), bloom 0.9, grain 0.035, ambient 1, seed 7.

## Motion model (the "non-robotic" part)
- `Ps` = damped progress: `Ps += (P - Ps) * (1 - exp(-dt / 0.32))`.
- `swirl` += `(clamp(dPs/dt, -2, 2) * 0.55 - swirl) * (1 - exp(-dt / 0.6))`. It is added to every card's orbit angle.
- `T` = ambient seconds (0 under prefers-reduced-motion).
- `fbm(x, seed)` = 3-octave 1D value noise (quintic fade, hash-based), range about -1..1.
- Per card (seeded RNG): `a0`, radius `r` in 1.45..3.4, height `y0` in ±1.35, `speed` 0.55..1.2, `size` 0.48..0.82,
  `appear` 0..0.42, `roll0`, `yawBias`, `light` 0.82..1.12.
  - `th = a0 + Ps*TAU*0.62*speed + T*0.022*speed + swirl*speed`
  - `rr = r*(1.14 - 0.24*smooth(Ps)) + fbm(Ps*1.8 + T*0.03, seed)*0.28`
  - `y = y0 + 0.28*sin(th*0.7 + seed) + fbm(Ps*1.4 + T*0.04, seed+50)*0.3`
  - Ring point `(rr cos th, y, rr sin th * 0.85)`, rotated by tilt -0.32 rad about x, then roll 0.16 rad about z; scaled by
    `orbitScale = clamp(aspect/1.78, 0.72 desktop | 0.62 mobile, 1)`; plus `fbm` wander 0.18 (x) / 0.14 (y).
  - `yaw = 0.55*sin(th) + yawBias + fbm(...)*0.95`, `pitch = fbm(...)*0.75 - 0.08`, `roll = roll0 + fbm(...)*0.55 + swirl*0.25`,
    `bend = fbm(Ps*3.1 + T*0.09, seed+180)*0.11`. Never use the raw cumulative angle for yaw (cards would face away).
  - Fade/scale in: `vis = smoothstep(appear, appear + 0.14, Ps + 0.04)`.
- Camera: fov 33°, position `(hx, hy, 7.4 - 1.35*smooth(Ps))` where `hx/hy` = fbm hand-held drift (0.06/0.045) + smoothed
  pointer parallax (0.16/0.1). Look at `(0.35hx, 0.35hy, 0)`. Apply a lens shift so world origin lands at (subject-x, subject-y)
  on screen: `clip.xy += lens * clip.w`, `lens = (2sx-1, 1-2sy)`.

## Card rendering
- Mesh: 14x8 grid quad, instanced. Per instance: model matrix (rotation × size, card aspect = image aspect clamped 0.55..1.9),
  atlas rect, (bend, alpha, blur, behind), (seed, aspect, light).
- Vertex: bend z = `bend*(4x²-0.33) + 0.35*bend*(4y²-0.33)*sign(bend)` with matching normal; normal via inverse-scale.
- Fragment, in order:
  1. Rounded-rect SDF (r 0.03), white border 0.045 of height, AA widened by blur.
  2. Paper colour (0.93, 0.905, 0.85) × fibre fbm; back face (gl_FrontFacing false) = warm grey paper, flipped normal.
  3. Image from atlas with LOD bias `blur*3.2` + 6-tap disc (radius `blur*0.018`); slight black lift + print grain.
     Empty slot (rect width 0) = dark glass + faint "+".
  4. Light: key dir (0.75, 0.42, 0.62) colour (1.38, 1.02, 0.74), wrapped `(n·l+0.3)/1.3`; fill dir (-0.8, 0.1, 0.5) colour
     (0.32, 0.36, 0.5) × 0.5; ambient (0.13, 0.115, 0.12).
  5. Specular `pow(n·h, 90)*1.7 + pow(n·h, 14)*0.2`, ×0.55 on the border; fresnel rim `pow(1-|n·v|, 3)*0.9` warm;
     golden edge band `(1 - smoothstep(0, 0.035, |d+0.006|)) * (0.35 + 0.65*max(n·l, 0)) * 0.55`.
  6. Multiply by light ramp `0.38 + 0.62*smooth(min(1, Ps*1.35))` and per-card `light`; fog to (0.02, 0.018, 0.024) from
     focus+1.2 over 6 units (max 0.85).
  7. Alpha × `vis` × `(1 - subjectCover * behind)`, where `behind = smoothstep(0.15, -0.45, worldZ)`; output premultiplied.
- Depth of field: `blur = clamp(|dist - focus|*0.36 - 0.1, 0, 1)`, ×1.25 for cards nearer than focus (focus = camera z).
- Sort back to front each frame; blend ONE, ONE_MINUS_SRC_ALPHA; no depth test.

## Subject + occlusion
- Cover-fit the colour half (packed) or full frame into the canvas, object-position (0.5, 0.42) desktop / (0.42, 0.5) mobile, slow
  extra push `1 + subjectPush*smooth(Ps)` around the subject point, tiny drift opposite the camera.
- `subjectCover()` at a fragment = matte value (packed: right half, smoothstep 0.2..0.8) or `smoothstep(matte.lo, matte.hi, luma)`.
- Upload video frames only when they change (`requestVideoFrameCallback`, `seeked`, `loadeddata`). Use the poster until then.

## Ribbons and dust
- 7 ribbons: orbit arcs (length 0.9-2.3 rad, 56 segments) on the same ring, projected on the CPU, extruded in screen space
  (width tapers to the tail), shaded `exp(-22s²)` core + `exp(-3s²)*0.35` glow, colour (1, 0.66, 0.32), additive, masked by the subject.
- 150 dust points drifting up with fbm; near ones (closer than 0.75×focus) grow to bokeh discs with a ring; additive, masked.

## Post (port of THE DAY)
Scene to RGBA16F (if EXT_color_buffer_float, else RGBA8) → 13-tap soft-knee bright pass at 1/2 (threshold 0.62, knee 0.32)
→ 4 dual-Kawase downsamples → 3 upsamples (spread 0.72) → composite: screen-blend bloom tinted (1, 0.8, 0.6)×0.9, filmic
shoulder (above 0.8) + toe, exposure 1.04, filmic mix 0.85, S-curve 0.18, saturation 0.96, grade (shadows (0.08, 0.13, 0.15),
highlights (1, 0.93, 0.8), strength 0.55), vignette 0.35, mid-tone grain 0.035, triangular dither 1.5/255.

## Runtime rules
- Render only while the section intersects the viewport (IntersectionObserver, 200px margin) and the tab is visible.
- DPR cap 1.5 desktop, 1.25 mobile; if the average frame time over 90 frames is above 25 ms, drop render scale by 0.15 (min 0.6).
- Mobile (≤820px): ~60% of the cards.
- No WebGL2 or a setup error: remove the canvas and leave the plain video. Pages must be served over http(s) (WebGL cannot read
  file:// media).
- Expose `ScrollHeroCards.attach(section) -> { destroy(), state() }` and auto-attach to `[data-scroll-hero]` that contain `.shf-cards`.

## Acceptance tests
1. At progress 0.33 / 0.52 / 0.61 / 0.75 / 0.99 the layout matches the grubogrubo reference frames (cards gathering, dense around the subject at the end).
2. Cards visibly pass behind the subject (hidden by the matte) and in front of it.
3. A quick scroll flick makes the card cloud lean and settle; stopping leaves a slow drift, never a frozen frame.
4. Highlights glint and bloom as cards rotate; near and far cards are softer than mid-distance cards.
5. Replacing the `<img>` list changes the card faces with no code change; an empty list shows empty slots.
6. No console errors; phone layout has no horizontal scroll.
