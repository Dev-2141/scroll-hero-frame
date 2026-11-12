# Prompt 05: DEVAN versions (V1 colourless, V2 colour)

> For an AI tool editing or porting the DEVAN pages. Engine and scene: `04-glass-portrait-scene.md`.
> Visual summary: `../docs/Report-04-DEVAN-Versions.pdf`.

## Rule
Two versions of one page. They must stay identical except for the portrait files, the version label and the version switch,
and the colour grade that suits each portrait. Do not edit `devan-v1-colourless.html` / `devan-v2-colour.html` by hand: edit
`tools/make_devan_pages.py` (content) or `index.html` (structure) and run `python tools/make_devan_pages.py`.

| Version | Page | Portrait (+ `-depth.png`) | `.shf-scene` extras |
|---|---|---|---|
| V1 Colourless | `devan-v1-colourless.html` | `assets/subject/devan-v1-colourless.png` | none (grade 0.35, saturation 1) |
| V2 Colour | `devan-v2-colour.html` | `assets/subject/devan-v2-colour.png` | `data-grade="0.12" data-saturation="1.12"` |

Header: the language pill is replaced by a link to the other version ("V2 COLOUR" on V1, "V1 COLOURLESS" on V2).

## Content
- Logo: `DEVAN`. Tagline: `MAKING COMPLEX THINGS SIMPLE<br>AND SIMPLE THINGS<br>MEMORABLE.`
- Kicker: `CREATIVE DEVELOPER / TECH DESIGNER`
- Name: `Devapriyan<br>G.S<span class="shf-dot">.</span>` (the last dot is the accent colour)
- Counter: `<strong class="shf-infinity">&infin;</strong><span>CURIOSITY FOR NEW TECHNOLOGY</span>`
  (CSS `.shf-counter strong.shf-infinity { font-size: clamp(150px, 19vw, 300px); line-height: .62; letter-spacing: 0; color: #fff; }`)
- Bio: "I’m Devan, a creative developer and tech designer. I connect design thinking with front-end engineering, motion and
  creative technology, making complex things simple and simple things memorable."
- Second bio: "Every project starts the same way: a sharp idea first, then whatever design and code it takes to make it real."
- List label: `CURRENT FOCUS`; 01 "Interactive websites and scroll-driven experiences"; 02 "UI / UX design for apps and digital
  products"; 03 "Creative coding, motion and 3D on the web".
- Note: "Selected work and code are on GitHub; experience and background on LinkedIn."
- Signature: `DEVAPRIYAN G.S. / DEVAN` + GitHub (filled icon) and LinkedIn (stroke icon) buttons. **URLs are TODO.**

## Portraits
Supplied already cut out (transparent WebP). Keep pixels unchanged; only convert to PNG and build a depth map:
`python tools/prepare_portrait.py <file> assets/subject/<name>`. A photo with its background still on goes through
`tools/cutout_portrait.py` first.

## Open items
- GitHub / LinkedIn URLs.
- Headline (`IDEAS ARE HUMAN.`) and lead sentence are still the reference site's wording; replace with Devan's own.
- Nav items and CONTACT link are placeholders.
