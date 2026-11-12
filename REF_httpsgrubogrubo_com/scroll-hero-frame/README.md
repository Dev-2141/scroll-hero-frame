# Scroll Hero Frame

A reusable, dependency-free web section: a scroll-scrubbed subject video with live,
lit photo cards orbiting it, big type and a glass profile card scrolling over the top.
Modelled on the founder section of grubogrubo.com; the card lighting and finish follow
the THE DAY engine (bloom, filmic tone, grade, grain, dither).

```
scroll-hero-frame/
  scroll-hero.css         all styles (.shf- prefix, CSS variables)
  scroll-hero.js          scroll -> video scrub, progress bar, text reveals
  scroll-hero-cards.js    WebGL2 Card Orbit layer (optional; falls back to plain video)
  index.html              demo page
  assets/scroll.mp4       subject clip (placeholder: packed colour + matte, 2560x720)
  assets/poster.jpg       first colour frame
  assets/cards/*.jpg      card images (placeholder rupee specimens)
  tools/dev-server.mjs    local server with video Range support
  tools/make_placeholders.py   regenerates the placeholder cards / subject clip
```

## Two looks

| Demo | Engine | Look |
|---|---|---|
| `index.html` (current) | `scroll-hero-glass.js` | green leather wall, cut-out portrait with 2.5D depth, 11 glass shards drifting sideways |
| `index-cards.html` | `scroll-hero-cards.js` | scrubbed subject video with 34 lit photo cards orbiting it |
| `devan-v1-colourless.html` | glass | **DEVAN**, black-and-white portrait |
| `devan-v2-colour.html` | glass | **DEVAN**, colour portrait (`data-grade="0.12" data-saturation="1.12"`) |

The two DEVAN pages are generated from `index.html` by `python tools/make_devan_pages.py` (edit content there).
Already-cut-out portraits: `python tools/prepare_portrait.py photo.webp assets/subject/<name>` (adds the depth map).

### Glass look: files and options

```
assets/subject/portrait.png         cut-out portrait (RGBA)
assets/subject/portrait-depth.png   depth map (white = near)
assets/bg/green-leather.jpg         seamless background tile   (tools/make_green.py)
assets/glass/shards.glb             shard meshes (own THE DAY recreation)
assets/glass/frost.jpg, frost-normal.png   glass textures
```

New portrait (only transparency is added, the photo is not altered):

```bash
python tools/cutout_portrait.py "path/to/photo.png" assets/subject/portrait
```

Options on `.shf-scene`: `data-front` (6), `data-back` (5), `data-subject-x` (0.36), `data-portrait-height` (1.04),
`data-depth` (1, 2.5D strength), `data-speed` (1, sideways speed), `data-tile` (360px), `data-bloom` (0.7), `data-grain` (0.03).
Any `<img>` inside `.shf-scene` is shown inside every other near shard; remove them for plain glass.

## Run the demo

WebGL may only read the video and images when the page is served over http(s), so do not
open `index.html` straight from disk.

```bash
node tools/dev-server.mjs
```

Then open http://localhost:5174.

## Put it in another project

1. Copy `scroll-hero.css`, `scroll-hero.js`, `scroll-hero-cards.js` and link them
   (scripts with `defer`, `scroll-hero.js` first).
2. Paste the `<section class="shf" data-scroll-hero> … </section>` block from `index.html`.
3. Edit the text, point the `<video>` at your clip, and list your card images.

For React / Next / Vue, render the same markup, then on mount:

```js
const hero = ScrollHero.init(sectionEl);
const cards = ScrollHeroCards.attach(sectionEl);
// on unmount
cards && cards.destroy(); hero.destroy();
```

## Cards = image slots

Every `<img>` inside `.shf-cards` becomes a card face. Cards cycle through the list, so
12 images can fill 34 cards. Remove all images and the cards show empty glass slots.

```html
<div class="shf-cards" data-count="34" data-subject-x="0.40" data-subject-y="0.46">
  <img src="assets/cards/my-photo-1.jpg" alt="">
  <img src="assets/cards/my-photo-2.jpg" alt="">
</div>
```

| Attribute | Default | What it does |
|---|---|---|
| `data-count` | 34 | number of cards on desktop (phones use ~60%) |
| `data-subject-x` / `data-subject-y` | 0.40 / 0.46 | where the orbit centres on screen (0..1) |
| `data-subject-push` | 0.05 | extra slow zoom on the video while scrolling |
| `data-matte` | `0.07,0.24` | brightness range treated as "subject" for normal (unpacked) footage |
| `data-bloom` | 0.9 | glow strength |
| `data-grain` | 0.035 | film grain |
| `data-ambient` | 1 | slow drift when not scrolling (0 = frozen) |
| `data-seed` | 7 | changes the card layout |

Images: any size; they are packed into one texture (max 640px per card cell). JPG ~900px wide is plenty.

## The subject video

Two options:

- **Packed clip (best):** colour picture on the left half, white-on-black cut-out mask of the
  subject on the right half (e.g. 2560x720). Mark it `class="shf-video is-packed"`. Cards
  then pass cleanly behind the subject.
- **Normal clip:** any dark-studio footage. Cards behind the subject are hidden wherever the
  picture is bright (tune with `data-matte`).

Encode with a keyframe on every frame, or scrubbing stutters:

```bash
ffmpeg -i input.mp4 -c:v libx264 -preset slow -crf 23 -g 1 -pix_fmt yuv420p -an -movflags +faststart scroll.mp4
```

Packed clip from a colour video plus a matte video of the same size:

```bash
ffmpeg -i colour.mp4 -i matte.mp4 -filter_complex hstack -c:v libx264 -preset slow -crf 23 -g 1 -pix_fmt yuv420p -an -movflags +faststart scroll.mp4
```

## CSS variables

`--shf-accent` (#4C0AAF), `--shf-bg`, `--shf-text`, `--shf-min-height` (175vh),
`--shf-max-width` (1600px), `--shf-pad-x` (6.5vw), `--shf-font-display`, `--shf-font-body`,
`--shf-video-position`. Override on `.shf`.

## Behaviour notes

- Without WebGL2 the plain scrubbed video shows, with no cards.
- The canvas renders only while the section is on screen; it lowers its own resolution if frames get slow.
- `prefers-reduced-motion`: no text animation and no ambient drift (scroll still drives the scene).
- Placeholder rupee images are stylised SPECIMEN art, not reproductions of real notes.
