# Prompt 01: Build the "Scroll Hero Frame" (scroll-scrubbed cinematic section)

> Paste this whole file into an AI coding tool. It is self-contained: every measurement below was taken from the
> reference site (grubogrubo.com, section `#team.founder-cinematic`) at a 1600 x 832 viewport.
> Companion reading for humans: `../docs/Report-01-Analysis-Scroll-Hero-Frame.pdf`.

---

> **Status (Report 02):** built in `../scroll-hero-frame/`. This prompt covers the base frame (text layer, video scrub,
> reveals). The live orbiting cards are a separate layer specified in `03-card-orbit-engine.md`. For it, `scroll-hero.js`
> must also publish `section._shf = { progress: () => fraction() }`.

## Role and goal

You are a senior front-end engineer. Build a **reusable, dependency-free web section** ("frame") in which:

1. A full-screen background **video is pinned** (sticky) behind the content and **never plays on its own**. The page's
   scroll position sets `video.currentTime`, so scrolling down advances the film and scrolling up rewinds it.
2. A giant two-line headline, a lead paragraph, a frosted-glass profile card and a signature row **scroll over** the video.
3. Each text block **reveals once** with a fade + 27px rise + 5px blur clearing, staggered 75 ms apart.
4. A **3px progress bar** on the bottom edge of the video shows scroll progress.

Pixel-match the specs below. Do not add features that are not listed.

## Hard constraints

- Plain HTML + CSS + vanilla JavaScript. **No libraries** (no GSAP, no ScrollTrigger, no jQuery, no frameworks).
- All classes prefixed `shf-`. No IDs are required by the CSS/JS (several frames per page must work).
- Theme through CSS custom properties on `.shf` (listed below).
- System fonts only: `"Arial Black", Impact, Arial, sans-serif` (display) and `Arial, Helvetica, sans-serif` (body).
- Placeholder copy only. Do not use real people's names, awards, photos or footage.
- Honour `prefers-reduced-motion: reduce`.
- Must work in current Chrome, Edge, Firefox, Safari (macOS + iOS).

## Deliverables

```
scroll-hero-frame/
  scroll-hero.css
  scroll-hero.js
  index.html        demo: simple fixed header + 100vh spacer + the frame + 100vh spacer
  README.md         usage, customisation variables, video encoding command
  assets/           (empty; user adds scroll.mp4 + poster.jpg)
```

## Markup (use exactly this structure)

```html
<section class="shf" data-scroll-hero aria-labelledby="shf-title-1">
  <div class="shf-backdrop" aria-hidden="true">
    <video class="shf-video" src="assets/scroll.mp4" poster="assets/poster.jpg"
           preload="auto" muted playsinline webkit-playsinline
           disablepictureinpicture disableremoteplayback></video>
    <div class="shf-shade"></div>
    <div class="shf-progress"><span></span></div>
  </div>

  <div class="shf-content">
    <div class="shf-heading">
      <h2 id="shf-title-1">IDEAS ARE<br><em>HUMAN.</em></h2>
      <p class="shf-lead">Creative experience across brands, products, films and technology — connected by the belief that every great execution begins with an idea.</p>
    </div>

    <div class="shf-grid">
      <div class="shf-card">
        <div class="shf-kicker">FOUNDER / CREATIVE DIRECTOR</div>
        <h3>Your Name<span class="shf-dot">.</span></h3>
        <div class="shf-counter"><strong>20<span>+</span></strong><span>YEARS OF CREATIVE EXPERIENCE</span></div>
        <p class="shf-bio">Two-to-three line biography goes here …</p>
        <p class="shf-bio shf-bio-2">One-to-two line follow-up statement goes here …</p>
        <div class="shf-awards">
          <div class="shf-awards-label">SELECTED RECOGNITION</div>
          <div class="shf-award"><span>01</span><p>Award one — detail, year</p></div>
          <div class="shf-award"><span>02</span><p>Award two — detail</p></div>
          <div class="shf-award"><span>03</span><p>Award three — detail, years</p></div>
          <p class="shf-note">Short fine-print note about credits.</p>
        </div>
      </div>
    </div>

    <div class="shf-signature"><span>YOUR NAME / BRAND</span>
      <div class="shf-social">
        <a class="shf-social-icon" href="#" aria-label="LinkedIn"><!-- 24x24 stroke svg --></a>
        <a class="shf-social-icon" href="#" aria-label="Facebook"><!-- 24x24 fill svg --></a>
        <a class="shf-social-icon" href="#" aria-label="Behance"><!-- 24x24 fill svg --></a>
      </div>
    </div>
  </div>
</section>
```

## CSS variables (defaults)

| Variable | Default |
|---|---|
| `--shf-accent` | `#4C0AAF` |
| `--shf-bg` | `#060508` |
| `--shf-text` | `#F5F3F6` |
| `--shf-min-height` | `175vh` |
| `--shf-max-width` | `1600px` |
| `--shf-pad-x` | `6.5vw` |
| `--shf-font-display` | `"Arial Black", Impact, Arial, sans-serif` |
| `--shf-font-body` | `Arial, Helvetica, sans-serif` |
| `--shf-video-position` | `center 42%` |

## Desktop CSS spec (> 820px)

**Section** `.shf`: `position: relative; min-height: var(--shf-min-height); background: var(--shf-bg); color: var(--shf-text);
isolation: isolate; overflow: clip; font-family: var(--shf-font-body);`

**Backdrop** `.shf-backdrop`: `position: sticky; top: 0; height: 100vh; width: 100%; margin-bottom: -100vh; z-index: 0;
overflow: hidden; pointer-events: none; background: #050506;`
(The negative margin is essential: it lets the content start at the section top and scroll over the pinned video.)

**Video** `.shf-video`: `position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
object-position: var(--shf-video-position); filter: contrast(1.05) saturate(.88); display: block;`

**Shade** `.shf-shade`: `position: absolute; inset: 0; z-index: 1;` background:
```css
linear-gradient(90deg, rgba(5,4,9,.77) 0%, rgba(5,4,9,.46) 43%, rgba(5,4,9,.21) 76%, rgba(5,4,9,.46) 100%),
linear-gradient(0deg, rgba(5,4,9,.78), transparent 28%, transparent 68%, rgba(5,4,9,.44));
```

**Progress** `.shf-progress`: `position: absolute; left: 0; right: 0; bottom: 0; height: 3px; z-index: 2; background: rgba(255,255,255,.15); overflow: hidden;`
`.shf-progress > span`: `display: block; height: 100%; width: 0; background: var(--shf-accent);` (no transition).

**Content** `.shf-content`: `position: relative; z-index: 3; min-height: var(--shf-min-height); padding: 15vh var(--shf-pad-x) 14vh;
display: flex; flex-direction: column; justify-content: space-between; pointer-events: none;`
`.shf-content a { pointer-events: auto; }`
`.shf-heading, .shf-grid { width: 100%; max-width: var(--shf-max-width); margin-inline: auto; }`
`.shf-heading { margin-bottom: 8vh; }`

**Headline** `h2`: `font-family: var(--shf-font-display); font-size: clamp(66px, 9.4vw, 175px); line-height: .9;
letter-spacing: -.086em; margin: 35px 0 28px;` — `h2 em { color: var(--shf-accent); font-style: normal; }`

**Lead** `.shf-lead`: `max-width: 660px; margin: 0 0 75px auto; color: #E0DCE4; font-size: clamp(18px, 1.5vw, 24px);
line-height: 1.5; text-shadow: 0 2px 25px rgba(0,0,0,.667);`

**Grid** `.shf-grid`: `display: flex; justify-content: flex-end; align-items: flex-start;`

**Card** `.shf-card`: `width: min(100%, 620px); padding: clamp(24px, 3.2vw, 54px); background: rgba(7,6,12,.52);
border: 1px solid rgba(255,255,255,.11); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-radius: 2px;`

**Kicker / labels** `.shf-kicker, .shf-awards-label`: `font-size: 10px; letter-spacing: .18em; color: #C3A0EC;`

**Name** `.shf-card h3`: `font-family: var(--shf-font-display); font-size: clamp(44px, 5.7vw, 94px); letter-spacing: -.07em;
line-height: .96; margin: 20px 0 22px;` — `.shf-dot { color: var(--shf-accent); }`

**Counter** `.shf-counter`: `display: flex; align-items: flex-end; gap: 23px; padding-bottom: 32px; border-bottom: 1px solid #3C393F;`
`.shf-counter strong`: `font-family: var(--shf-font-display); font-size: clamp(110px, 14vw, 220px); line-height: .8;
letter-spacing: -.1em; color: #fff;` — `strong span { color: var(--shf-accent); }`
`.shf-counter > span`: `font-size: 10px; letter-spacing: .14em; color: #9D989E; max-width: 145px; line-height: 1.5; padding-bottom: 10px;`

**Bio** `.shf-bio`: `font-size: clamp(16px, 1.35vw, 21px); line-height: 1.6; color: #D2CCD5; margin: 34px 0 0; max-width: 660px;`
`.shf-bio-2`: `font-size: clamp(15px, 1.2vw, 19px); color: #979198; margin-top: 20px;`

**Awards** `.shf-awards { margin-top: 42px; }` `.shf-awards-label { margin-bottom: 18px; }`
`.shf-award`: `display: grid; grid-template-columns: 40px 1fr; gap: 12px; align-items: start; border-top: 1px solid #3D3840; padding: 22px 0;`
`.shf-award > span`: `font-size: 10px; color: #9165CA; letter-spacing: .08em; margin-top: 5px;`
`.shf-award p`: `margin: 0; font-size: clamp(14px, 1.2vw, 18px); line-height: 1.45; color: #E7E4E8;`
`.shf-note`: `color: #8E898F; font-size: 11px; line-height: 1.65; max-width: 510px; margin: 22px 0 0;`

**Signature** `.shf-signature`: `display: flex; align-items: center; gap: 24px; margin: 12vh auto 0; width: 100%;
max-width: var(--shf-max-width); font-size: 10px; letter-spacing: .17em; color: #EEE; pointer-events: auto;`
`.shf-social { display: flex; gap: 9px; }`
`.shf-social-icon`: `width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.65);
border-radius: 50%; background: rgba(9,9,11,.76); color: #fff; backdrop-filter: blur(9px); transition: background .2s, border-color .2s, transform .2s;`
`:hover` → `background: var(--shf-accent); border-color: var(--shf-accent); transform: translateY(-3px);`
`svg`: `width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;`
(Facebook and Behance icons use `fill: currentColor; stroke: none`.)

**Reveal states**
```css
.shf-content .shf-reveal {
  opacity: 0; transform: translate3d(0, 27px, 0); filter: blur(5px);
  transition: opacity .9s ease, transform 1s cubic-bezier(.16, 1, .3, 1), filter .9s ease;
  transition-delay: var(--reveal-delay, 0ms);
}
.shf-content .shf-reveal.is-visible { opacity: 1; transform: none; filter: blur(0); }
@media (prefers-reduced-motion: reduce) {
  .shf-content .shf-reveal { opacity: 1; transform: none; filter: none; transition: none; }
}
```

## Responsive spec

**≤ 820px (stacked layout)**
- `.shf`: `display: flex; flex-direction: column; min-height: 0; overflow: visible; padding: 0 0 72px; background: #070608;`
- `.shf-content, .shf-heading { display: contents; }` so children can be ordered.
- Order: `h2` (1) → `.shf-backdrop` (2) → `.shf-lead` (3) → `.shf-grid` (4) → `.shf-signature` (5).
- `h2`: `margin: 26px 0 0; padding: 86px 7vw 32px; font-size: clamp(39px, 9.4vw, 74px); line-height: 1.08; letter-spacing: -.012em;`
  and `h2 em { display: block; line-height: 1.1; }`
- `.shf-backdrop`: `position: relative; top: auto; margin: 0; height: min(77svh, 750px); min-height: 375px; z-index: 1;`
- `.shf-video`: `object-position: 42% center; filter: contrast(1.04) saturate(.93);`
- `.shf-shade`: `background: linear-gradient(0deg, rgba(0,0,0,.32), transparent 24%);`
- `.shf-lead`: `padding: 38px 7vw 0; margin: 0 0 48px; max-width: none; color: #E4DFE7; font-size: clamp(17px, 4.25vw, 20px); line-height: 1.55; text-shadow: none;`
- `.shf-grid`: `display: block; padding: 0 7vw; max-width: none;`
- `.shf-card`: `width: 100%; max-width: none; padding: 0; background: transparent; border: none; backdrop-filter: none;` `h3 { margin-top: 18px; }`
- `.shf-awards { margin-top: 45px; }`
- `.shf-signature`: `padding: 0 7vw; margin: 54px 0 0; max-width: none; flex-wrap: wrap;`

**≤ 750px**: `h3 { font-size: clamp(35px, 9.1vw, 51px); line-height: 1.08; letter-spacing: -.018em; }`
`.shf-counter strong { font-size: 118px; letter-spacing: -.035em; line-height: .95; }`

**≤ 550px**: `h2 { font-size: clamp(38px, 9.2vw, 55px); padding-top: 88px; padding-bottom: 27px; }`
`.shf-backdrop { height: 68svh; min-height: 330px; }` `.shf-video { object-position: 40% center; }`
`.shf-signature { gap: 18px; }` `.shf-social-icon { width: 38px; height: 38px; }` `.shf-counter strong { font-size: 108px; }`

**≤ 390px**: `h2 { font-size: 9.2vw; }`

## JavaScript spec (`scroll-hero.js`)

Expose `window.ScrollHero = { init(sectionEl) → { destroy() }, initAll() }`. Call `initAll()` on `DOMContentLoaded`
for every `[data-scroll-hero]`.

### A. Scrub engine (per frame)
1. Get `video`, `backdrop`, progress `span`. Force `muted = defaultMuted = true`, `playsInline = true`, set
   `playsinline` / `webkit-playsinline` attributes, `pause()`.
2. `mobile = matchMedia('(max-width: 820px)')`.
3. `fraction()`:
   - desktop: `r = section.getBoundingClientRect(); return clamp((vh - r.top) / max(1, r.height), 0, 1)`
   - mobile: `r = backdrop.getBoundingClientRect(); return clamp((vh * .85 - r.top) / max(1, r.height + vh * .30), 0, 1)`
4. `update()` (run via a single `requestAnimationFrame` per frame, guarded by a `scheduled` flag):
   - set progress span `width = (fraction * 100).toFixed(2) + '%'`
   - if metadata not ready or `duration` not finite/positive → return
   - `desired = fraction * duration`, then `applySeek(false)`
5. `applySeek(force)`: `next = clamp(desired, 0, duration - .025)`. Unless `force`: skip if `|next - lastTarget| < .035`;
   on mobile also skip if `< 42 ms` since the last seek or `video.seeking`. Then set `video.currentTime = next` (try/catch).
6. iOS priming: on the first `touchstart`/`pointerdown` while mobile, call `video.play()` then `pause()` as soon as it resolves
   (only once), then `applySeek(true)`.
7. Listeners: `loadedmetadata` (ready = true, pause, schedule), `loadeddata`, `canplay`, `seeked` (mobile: re-seek with
   force if off by > .09 s), `play` (pause unless priming), window `scroll` + `resize` (passive), media-query `change`,
   `visibilitychange`. Call `video.load()` and `schedule()` once at start.
8. `destroy()` removes every listener.

### B. Reveal engine (per frame)
1. Targets inside `.shf-content`: `h2, .shf-lead, .shf-kicker, .shf-card h3, .shf-counter, .shf-bio, .shf-awards-label,
   .shf-award, .shf-note, .shf-signature`.
2. For each (index `i`): add `shf-reveal`, set `--reveal-delay: ${Math.min(i % 5, 4) * 75}ms`.
3. `IntersectionObserver` with `threshold: .12, rootMargin: '0px 0px -7% 0px'`. On intersect: add `is-visible`, `unobserve`.
4. No IntersectionObserver → add `is-visible` to all immediately.

## Demo page (`index.html`)
- Body background `#0a090e`, Arial.
- Fixed header (height ~108px, padding 0 62px): left a bold condensed wordmark + 3-line 10px uppercase tagline;
  right nav links (WORK, STUDIO, INSIGHTS, ABOUT US) at 11px, letter-spacing .14em, then a pill "CONTACT ↗" button
  (1px white border, radius 999px) and a pill language button "EN ⌄".
- One 100vh spacer section before the frame and one after, so scrubbing can be tested in both directions.

## Acceptance tests (check each one)
1. At 1600 x 832, the section top entering the bottom of the screen → progress bar 0%; section top at the screen top → ~40%;
   section bottom at the screen bottom → 100% and the video on its last frame.
2. Scrolling up rewinds the video smoothly; the video never plays on its own (also after switching tabs).
3. Each text block animates once; scrolling back up does not hide it again.
4. Two frames on one page work independently.
5. At 820px and below the order is heading → video panel → lead → card content → signature, and the video scrubs while its panel crosses the screen.
6. With reduced motion turned on, all text is visible immediately.
7. No console errors when the video file is missing (the frame still renders with the poster/background colour).
8. No horizontal scrollbar at any width from 320px to 2560px.

## Video note (for README)
Smooth scrubbing needs a keyframe on every frame:
```bash
ffmpeg -i input.mp4 -vf "scale=1280:-2" -c:v libx264 -preset slow -crf 23 -g 1 -pix_fmt yuv420p -an -movflags +faststart scroll.mp4
ffmpeg -i scroll.mp4 -frames:v 1 -q:v 3 poster.jpg
```
