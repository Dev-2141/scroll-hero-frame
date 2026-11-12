"""Build the two DEVAN versions from index.html (same frame, only the portrait differs).

  python tools/make_devan_pages.py   -> devan-v1-colourless.html, devan-v2-colour.html

Edit the content here and re-run; index.html stays the generic template.
"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
base = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()

GITHUB = ('<a class="shf-social-icon is-filled" href="#" aria-label="GitHub" title="GitHub"><!-- TODO: your GitHub URL -->\n'
          '            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/></svg>\n'
          '          </a>')
LINKEDIN = ('<a class="shf-social-icon" href="#" aria-label="LinkedIn" title="LinkedIn"><!-- TODO: your LinkedIn URL -->\n'
            '            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5V20M5 4v.1M10 20v-11.5h4v1.7c.9-1.4 2.3-2.1 4-1.9 3 0 4 1.9 4 5V20h-4v-6.2c0-1.5-.4-2.4-1.7-2.4-1.4 0-2.3 1-2.3 2.5V20z"/></svg>\n'
            '          </a>')

CARD = """<div class="shf-card">
          <div class="shf-kicker">CREATIVE DEVELOPER / TECH DESIGNER</div>
          <h3>Devapriyan<br>G.S<span class="shf-dot">.</span></h3>
          <div class="shf-counter"><strong class="shf-infinity">&infin;</strong><span>CURIOSITY FOR NEW TECHNOLOGY</span></div>
          <p class="shf-bio">I&rsquo;m Devan, a creative developer and tech designer. I connect design thinking with front-end engineering, motion and creative technology, making complex things simple and simple things memorable.</p>
          <p class="shf-bio shf-bio-2">Every project starts the same way: a sharp idea first, then whatever design and code it takes to make it real.</p>
          <div class="shf-awards">
            <div class="shf-awards-label">CURRENT FOCUS</div>
            <div class="shf-award"><span>01</span><p>Interactive websites and scroll-driven experiences</p></div>
            <div class="shf-award"><span>02</span><p>UI / UX design for apps and digital products</p></div>
            <div class="shf-award"><span>03</span><p>Creative coding, motion and 3D on the web</p></div>
            <p class="shf-note">Selected work and code are on GitHub; experience and background on LinkedIn.</p>
          </div>
        </div>"""

VERSIONS = [
    ("devan-v1-colourless.html", "V1 COLOURLESS", "devan-v1-colourless", "devan-v2-colour.html", "V2 COLOUR"),
    ("devan-v2-colour.html", "V2 COLOUR", "devan-v2-colour", "devan-v1-colourless.html", "V1 COLOURLESS"),
]

for fname, label, img, other, other_label in VERSIONS:
    s = base
    s = re.sub(r"<title>.*?</title>", f"<title>DEVAN — {label.title()}</title>", s)
    s = s.replace('<span class="demo-logo">BRAND</span>', '<span class="demo-logo">DEVAN</span>')
    s = s.replace("WE TURN<br>COMPLEX THINGS<br>INTO COMPELLING EXPERIENCES.", "MAKING COMPLEX THINGS SIMPLE<br>AND SIMPLE THINGS<br>MEMORABLE.")
    s = s.replace('<button class="demo-pill" type="button">EN&nbsp;⌄</button>',
                  f'<a class="demo-pill" href="{other}" title="Switch version">{other_label}</a>')
    s = s.replace("<p>SCROLL HERO FRAME / DEMO</p>", f"<p>DEVAN / {label}</p>")
    s = s.replace("<p>THE VIDEO BELOW FOLLOWS YOUR SCROLL — FORWARDS AND BACKWARDS.</p>", "<p>CREATIVE DEVELOPER / TECH DESIGNER</p>")
    s = s.replace("assets/subject/portrait.png", f"assets/subject/{img}.png").replace("assets/subject/portrait-depth.png", f"assets/subject/{img}-depth.png")
    s = re.sub(r'<div class="shf-card">.*?</div>\s*</div>\s*</div>', CARD + "\n      </div>", s, count=1, flags=re.S)
    if img.endswith("v2-colour"):   # colour portrait: lighter grade, natural skin tones
        s = s.replace('data-front="6" data-back="5"', 'data-grade="0.12" data-saturation="1.12" data-front="6" data-back="5"')
    s = s.replace("<span>YOUR NAME / BRAND</span>", "<span>DEVAPRIYAN G.S. / DEVAN</span>")
    s = re.sub(r'(<div class="shf-social" aria-label="Social profiles">).*?(</div>)',
               lambda m: m.group(1) + "\n          " + GITHUB + "\n          " + LINKEDIN + "\n        " + m.group(2), s, count=1, flags=re.S)
    open(os.path.join(ROOT, fname), "w", encoding="utf-8").write(s)
    print("wrote", fname)
