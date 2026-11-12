# Prompt 02: Make your own scroll-scrub background video

> Use this to produce the clip that plays behind the Scroll Hero Frame. Part A is a prompt for an AI video generator
> (any text/image-to-video tool). Part B is the brief if you film it yourself. Part C is the mandatory encoding step.
> Replace every `[BRACKET]` before using.

---

## Part A: Prompt for an AI video generator

**Settings:** 16:9, 1280x720 or higher, 24-30 fps, **6-8 seconds, one continuous shot, no cuts**, no text, no logos, no audio needed.
If the tool supports a reference image, give it a photo of `[SUBJECT]` (yourself or a person you have the rights to show).

```
Cinematic portrait of [SUBJECT: e.g. a creative director in a plain black t-shirt, glasses pushed up on the head],
seated slightly left of centre in a very dark studio, looking slightly off-camera with a calm, confident expression.
Around them, dozens of printed photographs and small glowing screens float and slowly orbit in a loose spiral,
showing [THEME OF YOUR WORK: e.g. film stills, product renders, landscapes, character art].
Thin warm golden light streaks trail behind the floating images. Warm tungsten key light from the right,
soft amber rim light, deep shadows, background almost black. Shallow depth of field, cards in the foreground
pass blurred across the frame. Slow, steady camera push-in from a medium shot to a medium close-up over the whole clip.
The clip starts very dark and gradually brightens as the cards gather around the subject.
Smooth continuous motion, no cuts, no flashes, no text, photoreal, 35mm film look, subtle grain.
```

**Negative prompt (if supported):** `text, captions, logos, watermark, jump cut, flicker, strobe, camera shake, fast motion, bright background, cartoon`

### Why these details matter
| Detail | Reason |
|---|---|
| One continuous shot, slow push-in | Scrolling plays the clip forwards *and backwards*. Cuts or fast motion look broken in reverse. |
| Starts dark, brightens | The first ~35% of the clip plays while the headline is on screen; dark frames keep it readable. |
| Subject left-centre, right side darker | The lead paragraph and glass card sit on the right half of the screen. |
| Very dark background | A gradient shade darkens the edges further. Bright footage turns grey and muddy under it. |
| 6-8 seconds | It is spread over about 2.5 screens of scrolling. Longer clips feel sluggish and get heavy. |

## Part B: If you film it yourself
- Camera on a slider or gimbal: one slow push-in, 6-8 s, locked exposure and white balance.
- Hang printed photos on fishing line, or add the floating cards later in After Effects / Blender (3D cards orbiting on a spiral path, motion blur on).
- Light: one warm key light from the right and a rim light from behind-left; black backdrop.
- Shoot at 4K if you can, then deliver 1280x720 (and optionally a 720x1280 crop for phones).

## Part C: Encode for scrubbing (required)
A normal export has a keyframe only every ~2 s, so jumping around while scrolling stutters. Re-encode with a keyframe on **every** frame:

```bash
ffmpeg -i input.mp4 -vf "scale=1280:-2" -c:v libx264 -preset slow -crf 23 -g 1 -pix_fmt yuv420p -an -movflags +faststart scroll.mp4
```

```bash
ffmpeg -i scroll.mp4 -frames:v 1 -q:v 3 poster.jpg
```

- Target size: under ~10 MB for a 7 s clip. If it is bigger, raise `-crf` to 26-28.
- Optional phone version: add `-vf "crop=ih*9/16:ih,scale=720:-2"` and save it as `scroll-mobile.mp4`.
- Put `scroll.mp4` and `poster.jpg` in `scroll-hero-frame/assets/`.

## Part D: Matte for the Card Orbit layer (recommended)
The live cards can pass **behind** the subject when the clip carries a cut-out mask of the subject.
1. Make a matte video of the same clip: white subject on black (any background-removal / rotoscoping tool, e.g. a video
   background remover, After Effects Roto Brush, DaVinci Resolve Magic Mask). Same length, size and frame rate.
2. Pack colour and matte side by side and encode for scrubbing:

```bash
ffmpeg -i colour.mp4 -i matte.mp4 -filter_complex hstack -c:v libx264 -preset slow -crf 23 -g 1 -pix_fmt yuv420p -an -movflags +faststart scroll.mp4
```

3. Mark the video `class="shf-video is-packed"`. Export the poster from the colour clip only.

Without a matte, leave out `is-packed`: cards behind the subject are hidden wherever the picture is bright, which works
for dark-studio footage.

**Leave the cards out of the footage.** The orbiting cards are rendered live by `scroll-hero-cards.js`, so the clip only
needs the subject, the dark studio and its light. In Part A, remove the floating photographs and light streaks from the prompt.

## Checklist before use
- [ ] One continuous shot, plays naturally in reverse
- [ ] Dark start, subject left-centre, right side calm and dark
- [ ] 6-8 s, 1280x720, no audio
- [ ] Re-encoded with `-g 1` and `+faststart`
- [ ] Poster image exported from the first frame
- [ ] You own the footage or have the rights to the person and the images shown
