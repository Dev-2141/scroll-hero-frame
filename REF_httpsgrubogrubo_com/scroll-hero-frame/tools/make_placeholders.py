"""Placeholder art for the Scroll Hero Frame demo.

  python tools/make_placeholders.py cards     -> assets/cards/rupee-01.jpg .. rupee-12.jpg
  python tools/make_placeholders.py subject   -> assets/scroll.mp4 + assets/poster.jpg

Cards: stylised rupee notes and coins, clearly marked SPECIMEN. They are design
placeholders only: no portraits, emblems, bank names or serial numbers, and
they do not reproduce any real banknote layout.
Subject: a lit, breathing head-and-shoulders silhouette in a dark studio with a
slow push-in, encoded with a keyframe on every frame for scroll scrubbing.
Replace both with your own images / footage.
"""
import math, os, random, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
FONT = "C:/Windows/Fonts/"
def font(name, size):
    for n in (name, "arialbd.ttf", "arial.ttf"):
        try: return ImageFont.truetype(FONT + n, size)
        except OSError: pass
    return ImageFont.load_default()

RUPEE = "\u20b9"
NOTES = {  # denomination: (paper base, ink, accent)
    10: ((201, 160, 120), (92, 52, 30), (150, 96, 60)),
    20: ((206, 204, 132), (86, 92, 34), (150, 150, 60)),
    50: ((132, 196, 210), (20, 78, 96), (60, 140, 160)),
    100: ((182, 170, 214), (64, 48, 112), (122, 104, 170)),
    200: ((236, 196, 92), (120, 70, 10), (196, 140, 40)),
    500: ((176, 178, 168), (58, 62, 56), (112, 116, 104)),
    2000: ((214, 140, 186), (108, 24, 74), (176, 72, 132)),
}

# --------------------------------------------------------------- texture helpers
def noise_tex(w, h, seed, scale=1.0, octaves=4):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), float); amp = 1.0; tot = 0
    for o in range(octaves):
        s = max(2, int(8 * (2 ** o) * scale))
        small = rng.random((s, max(2, int(s * w / h))))
        layer = np.array(Image.fromarray((small * 255).astype("uint8")).resize((w, h), Image.BICUBIC)) / 255.0
        out += layer * amp; tot += amp; amp *= .5
    return out / tot

def paper(w, h, base, seed):
    n = noise_tex(w, h, seed)
    fib = np.random.default_rng(seed + 1).normal(0, 1, (h, w))
    fib = np.array(Image.fromarray(np.clip(fib * 40 + 128, 0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(.6))) / 255 - .5
    arr = np.ones((h, w, 3)) * np.array(base, float)
    arr *= (0.9 + 0.2 * n)[..., None]
    arr += fib[..., None] * 18
    # gentle diagonal gradient, lighter top-left
    yy, xx = np.mgrid[0:h, 0:w]
    arr *= (1.06 - 0.14 * ((xx / w) * .6 + (yy / h) * .4))[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))

def guilloche(draw, cx, cy, R, r, d, color, width=1, turns=60, steps=3000, scale=1.0):
    pts = []
    for i in range(steps + 1):
        t = i / steps * 2 * math.pi * turns / 10
        x = (R - r) * math.cos(t) + d * math.cos((R - r) / r * t)
        y = (R - r) * math.sin(t) - d * math.sin((R - r) / r * t)
        pts.append((cx + x * scale, cy + y * scale))
    draw.line(pts, fill=color, width=width)

def wave_band(draw, x0, y0, x1, y1, color, lines=9, amp=5, freq=0.08, phase=0, width=1):
    for k in range(lines):
        y = y0 + (y1 - y0) * k / max(1, lines - 1)
        pts = [(x, y + amp * math.sin(x * freq + phase + k * .7)) for x in range(int(x0), int(x1) + 1, 3)]
        draw.line(pts, fill=color, width=width)

def lighten(c, f): return tuple(int(min(255, v + (255 - v) * f)) for v in c)
def darken(c, f): return tuple(int(v * (1 - f)) for v in c)

# --------------------------------------------------------------- note
def make_note(denom, w=1100, h=520, seed=0):
    base, ink, acc = NOTES[denom]
    img = paper(w, h, base, seed).convert("RGBA")
    over = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(over)
    # outer frame bands
    m = 22
    d.rectangle([m, m, w - m, h - m], outline=ink + (150,), width=2)
    d.rectangle([m + 8, m + 8, w - m - 8, h - m - 8], outline=ink + (90,), width=1)
    wave_band(d, m + 14, m + 14, w - m - 14, m + 34, acc + (120,), lines=6, amp=3, freq=.11)
    wave_band(d, m + 14, h - m - 34, w - m - 14, h - m - 14, acc + (120,), lines=6, amp=3, freq=.11, phase=1.3)
    # big rosettes
    guilloche(d, w * .30, h * .52, 9.7, 3.1, 6.4, ink + (95,), scale=17, turns=62)
    guilloche(d, w * .30, h * .52, 7.0, 2.3, 4.0, acc + (130,), scale=17, turns=50)
    guilloche(d, w * .80, h * .30, 6.0, 1.9, 3.6, ink + (80,), scale=10, turns=44)
    # background microtext rows
    mt = font("arial.ttf", 9)
    for row in range(int(h * .62), int(h * .86), 11):
        d.text((w * .48, row), (f"{RUPEE}{denom} " * 40)[:120], font=mt, fill=ink + (55,))
    # security thread
    tx = int(w * .58)
    for y in range(m + 40, h - m - 40, 14):
        d.rectangle([tx, y, tx + 5, y + 8], fill=lighten(acc, .3) + (210,))
    # denomination
    img = Image.alpha_composite(img, over)
    over = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(over)
    big = font("ariblk.ttf", int(h * (.26 if denom < 1000 else .22))); mid = font("arialbd.ttf", int(h * .11)); small = font("arialbd.ttf", 22)
    label = f"{RUPEE}{denom}"
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((w - m - 52 + 4, h * .74 + 4), label, font=big, fill=darken(ink, .3) + (120,), anchor="rs")
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(3)))
    d.text((w - m - 52, h * .74), label, font=big, fill=ink + (240,), anchor="rs")
    d.text((m + 30, m + 44), str(denom), font=mid, fill=ink + (220,))
    d.text((w - m - 30, h - m - 44), str(denom), font=mid, fill=ink + (220,), anchor="rb")
    d.text((m + 34, h - m - 68), "SPECIMEN  /  PLACEHOLDER IMAGE", font=small, fill=ink + (170,))
    # watermark window
    d.ellipse([w * .06, h * .22, w * .17, h * .78], fill=lighten(base, .35) + (120,), outline=ink + (60,))
    d.text((w * .115, h * .5), RUPEE, font=font("arialbd.ttf", int(h * .22)), fill=lighten(acc, .1) + (90,), anchor="mm")
    img = Image.alpha_composite(img, over)
    # diagonal SPECIMEN stamp
    st = Image.new("RGBA", (w, h), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
    sd.text((w * .5, h * .5), "SPECIMEN", font=font("ariblk.ttf", int(h * .18)), fill=darken(acc, .2) + (46,), anchor="mm")
    img = Image.alpha_composite(img, st.rotate(-14, resample=Image.BICUBIC))
    return img.convert("RGB")

# --------------------------------------------------------------- coin
def make_coin(denom, size, seed, tone=(196, 188, 170)):
    s = size; rng = random.Random(seed)
    yy, xx = np.mgrid[0:s, 0:s]; c = (s - 1) / 2
    r = np.sqrt((xx - c) ** 2 + (yy - c) ** 2) / c
    ang = np.arctan2(yy - c, xx - c)
    brushed = np.sin(r * 140 + rng.random() * 6) * .5 + .5
    light = .65 + .35 * np.cos(ang + 2.4)
    arr = np.array(tone, float) * (0.55 + 0.45 * light)[..., None] * (0.92 + 0.08 * brushed)[..., None]
    rim = (r > .86) & (r <= 1)
    arr[rim] *= 1.18
    alpha = np.clip((1 - r) * s * .5, 0, 1) * 255
    im = Image.fromarray(np.dstack([np.clip(arr, 0, 255), alpha]).astype("uint8"), "RGBA")
    d = ImageDraw.Draw(im)
    for k in range(120):  # milled edge
        a = k / 120 * 2 * math.pi
        d.line([(c + math.cos(a) * c * .9, c + math.sin(a) * c * .9), (c + math.cos(a) * c * .99, c + math.sin(a) * c * .99)], fill=(255, 255, 240, 60), width=2)
    emb = Image.new("RGBA", (s, s), (0, 0, 0, 0)); ed = ImageDraw.Draw(emb)
    ed.text((c, c * .78), RUPEE, font=font("arialbd.ttf", int(s * .34)), fill=(255, 255, 255, 255), anchor="mm")
    ed.text((c, c * 1.38), str(denom), font=font("ariblk.ttf", int(s * .2)), fill=(255, 255, 255, 255), anchor="mm")
    m = emb.split()[3]
    hi = ImageChops.offset(m, -2, -2); lo = ImageChops.offset(m, 2, 2)
    im.paste((255, 255, 245, 150), (0, 0), ImageChops.subtract(hi, m))
    im.paste((40, 34, 26, 150), (0, 0), ImageChops.subtract(lo, m))
    im.paste(darken(tone, .12) + (255,), (0, 0), m.point(lambda v: v * .55))
    return im

def backdrop(w, h, seed, top=(28, 22, 20), bottom=(70, 52, 38)):
    yy = np.linspace(0, 1, h)[:, None, None]
    arr = np.array(top, float) * (1 - yy) + np.array(bottom, float) * yy
    arr = arr * np.ones((1, w, 1))
    n = noise_tex(w, h, seed, .6)
    arr *= (0.85 + 0.3 * n)[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8")).convert("RGBA")

def photo_finish(img, seed, warmth=1.0, vignette=.45, blur_band=None):
    """Make an image read like a photograph: light falloff, warm cast, grain."""
    a = np.array(img.convert("RGB")).astype(float); h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    lx, ly = w * .68, h * .28
    fall = 1 - vignette * np.clip(np.sqrt(((xx - lx) / w) ** 2 + ((yy - ly) / h) ** 2) * 1.3, 0, 1)
    a *= fall[..., None]
    a *= np.array([1.0 + .06 * warmth, 1.0, 1.0 - .08 * warmth])
    a += np.random.default_rng(seed).normal(0, 4.5, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype("uint8"))
    if blur_band:
        soft = out.filter(ImageFilter.GaussianBlur(blur_band))
        mask = Image.fromarray((np.clip(np.abs(yy / h - .55) * 3 - .3, 0, 1) * 255).astype("uint8"))
        out = Image.composite(soft, out, mask)
    return out

# --------------------------------------------------------------- compositions
def card_single_note(denom, seed):
    W, H = 1200, 800
    bg = backdrop(W, H, seed)
    note = make_note(denom, seed=seed).convert("RGBA").resize((1000, 473))
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    sd.rectangle([120, 210, 1120, 700], fill=(0, 0, 0, 150))
    bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(26)))
    rot = note.rotate(random.Random(seed).uniform(-7, 7), expand=True, resample=Image.BICUBIC)
    bg.alpha_composite(rot, ((W - rot.width) // 2, (H - rot.height) // 2 + 10))
    return photo_finish(bg, seed)

def card_fan(seed):
    W, H = 1200, 800; rng = random.Random(seed)
    bg = backdrop(W, H, seed, (22, 18, 24), (54, 40, 46))
    for i, dn in enumerate([10, 50, 100, 200, 500, 2000]):
        n = make_note(dn, seed=seed + i).convert("RGBA").resize((760, 360))
        r = n.rotate(-32 + i * 12 + rng.uniform(-2, 2), expand=True, resample=Image.BICUBIC)
        shadow = Image.new("RGBA", r.size, (0, 0, 0, 0)); shadow.paste((0, 0, 0, 120), (0, 0), r.split()[3])
        bg.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)), (W // 2 - r.width // 2 + 14, int(H * .62) - r.height // 2 + 18 - i * 6))
        bg.alpha_composite(r, (W // 2 - r.width // 2, int(H * .62) - r.height // 2 - i * 6))
    return photo_finish(bg, seed, vignette=.55)

def card_coins(seed, pile=False):
    W, H = 1200, 800; rng = random.Random(seed)
    bg = backdrop(W, H, seed, (18, 16, 14), (44, 36, 28))
    n = 14 if pile else 4
    for i in range(n):
        dn = rng.choice([1, 2, 5, 10, 20]); s = rng.randint(220, 340) if not pile else rng.randint(170, 260)
        tone = (206, 178, 120) if dn in (10, 20) and rng.random() < .6 else (196, 190, 178)
        coin = make_coin(dn, s, seed + i, tone)
        x = rng.randint(80, W - s - 80) if pile else 120 + i * 260 + rng.randint(-20, 20)
        y = rng.randint(140, H - s - 60) if pile else rng.randint(220, 380)
        sh = Image.new("RGBA", (s, s), (0, 0, 0, 0)); sh.paste((0, 0, 0, 160), (0, 0), coin.split()[3])
        bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)), (x + 10, y + 14))
        bg.alpha_composite(coin, (x, y))
    return photo_finish(bg, seed, vignette=.5, blur_band=None if not pile else 6)

def card_macro(denom, seed):
    note = make_note(denom, 1600, 760, seed)
    crop = note.crop((700, 120, 1500, 653)).resize((1200, 800), Image.BICUBIC)
    return photo_finish(crop, seed, vignette=.35, blur_band=7)

def card_bundle(denom, seed):
    W, H = 800, 1100
    bg = backdrop(W, H, seed, (24, 20, 18), (60, 46, 34))
    for k in range(9):
        n = make_note(denom, seed=seed + k).convert("RGBA").resize((620, 294)).rotate(90, expand=True)
        bg.alpha_composite(n, (90 + k * 2, 70 + k * 7))
    d = ImageDraw.Draw(bg)
    d.rectangle([80, 470, 720, 560], fill=(232, 222, 200, 255))
    d.text((400, 515), f"{RUPEE} {denom} x 100  /  SPECIMEN", font=font("arialbd.ttf", 30), fill=(70, 50, 40, 255), anchor="mm")
    return photo_finish(bg, seed)

def make_cards():
    out = os.path.join(ASSETS, "cards"); os.makedirs(out, exist_ok=True)
    plan = [lambda: card_single_note(500, 1), lambda: card_fan(2), lambda: card_coins(3), lambda: card_single_note(2000, 4),
            lambda: card_macro(100, 5), lambda: card_single_note(200, 6), lambda: card_bundle(500, 7), lambda: card_coins(8, pile=True),
            lambda: card_single_note(50, 9), lambda: card_macro(10, 10), lambda: card_single_note(20, 11), lambda: card_bundle(2000, 12)]
    for i, fn in enumerate(plan, 1):
        im = fn(); im.thumbnail((900, 900), Image.LANCZOS)
        p = os.path.join(out, f"rupee-{i:02d}.jpg"); im.save(p, quality=86, optimize=True); print(p, im.size)

# --------------------------------------------------------------- subject clip
def smooth(x): return x * x * (3 - 2 * x)

def vnoise(t, seed):
    i = math.floor(t); f = t - i; u = f * f * (3 - 2 * f)
    a = random.Random(i * 7919 + seed).random(); b = random.Random((i + 1) * 7919 + seed).random()
    return (a * (1 - u) + b * u) * 2 - 1

def fbm(t, seed): return vnoise(t, seed) * .6 + vnoise(t * 2.1, seed + 3) * .3 + vnoise(t * 4.3, seed + 7) * .1

def figure_mask(W, H, cx, cy, s, turn, tilt, breath):
    m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
    # shoulders / torso
    sy = cy + 205 * s + breath
    d.polygon([(cx - 330 * s, H + 10), (cx - 300 * s, sy + 120 * s), (cx - 220 * s, sy + 20 * s), (cx - 70 * s, sy - 8 * s),
               (cx + 70 * s, sy - 8 * s), (cx + 220 * s, sy + 20 * s), (cx + 300 * s, sy + 120 * s), (cx + 330 * s, H + 10)], fill=255)
    d.ellipse([cx - 330 * s, sy + 10 * s, cx - 170 * s, sy + 190 * s], fill=255)
    d.ellipse([cx + 170 * s, sy + 10 * s, cx + 330 * s, sy + 190 * s], fill=255)
    # neck
    d.rounded_rectangle([cx - 52 * s + turn * .3, cy + 80 * s, cx + 52 * s + turn * .3, sy + 30 * s], radius=int(30 * s), fill=255)
    # head
    head = Image.new("L", (W, H), 0); hd = ImageDraw.Draw(head)
    hx = cx + turn
    hd.ellipse([hx - 92 * s, cy - 128 * s, hx + 92 * s, cy + 112 * s], fill=255)
    hd.ellipse([hx - 70 * s, cy + 20 * s, hx + 70 * s, cy + 140 * s], fill=255)  # jaw
    hd.ellipse([hx - 104 * s, cy - 20 * s, hx - 82 * s, cy + 40 * s], fill=255)  # ears
    hd.ellipse([hx + 82 * s, cy - 20 * s, hx + 104 * s, cy + 40 * s], fill=255)
    head = head.rotate(tilt, center=(hx, cy + 120 * s), resample=Image.BICUBIC)
    m = ImageChops.lighter(m, head)
    return m.filter(ImageFilter.GaussianBlur(1.6))

def make_subject():
    import imageio_ffmpeg
    W, H, FPS, SECS = 1280, 720, 30, 7; N = FPS * SECS
    os.makedirs(ASSETS, exist_ok=True)
    mp4, poster = os.path.join(ASSETS, "scroll.mp4"), os.path.join(ASSETS, "poster.jpg")
    # Packed video: colour on the left half, the subject's cut-out mask (white = subject) on the right half.
    # The card engine uses the mask so cards can pass behind the subject.
    proc = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                             "-s", f"{W * 2}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "22",
                             "-g", "1", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", mp4], stdin=subprocess.PIPE)
    yy, xx = np.mgrid[0:H, 0:W]
    first = None
    for n in range(N):
        t = n / (N - 1); sec = t * SECS
        push = 1 + .26 * smooth(t)
        light = .25 + .75 * smooth(min(1, t * 1.3))
        cx = W * .38 + fbm(sec * .35, 1) * 8 - (push - 1) * 80
        cy = H * .40 + fbm(sec * .3, 2) * 6 + (push - 1) * 60
        s = 1.05 * push
        turn = 18 * math.sin(sec * .55) * s + fbm(sec * .8, 3) * 6
        tilt = 2.2 * math.sin(sec * .42 + 1) + fbm(sec * .6, 4) * 1.2
        breath = 4 * math.sin(sec * 2 * math.pi / 3.6)
        mask = figure_mask(W, H, cx, cy, s, turn, tilt, breath)
        M = np.array(mask) / 255.0
        # background: dark studio + warm haze behind right shoulder
        bg = np.zeros((H, W, 3))
        hz = np.exp(-(((xx - W * .72) / (W * .45)) ** 2 + ((yy - H * .35) / (H * .6)) ** 2))
        bg += hz[..., None] * np.array([46, 30, 18]) * light
        bg += np.exp(-(((xx - cx) / (W * .3)) ** 2 + ((yy - cy) / (H * .5)) ** 2))[..., None] * np.array([22, 15, 12]) * light
        # figure shading: key light from the right, soft skin/shirt split
        key = np.clip((xx - (cx - 120 * s)) / (260 * s), 0, 1) ** 1.6
        skin = (yy < cy + 170 * s + breath).astype(float)
        skin = np.array(Image.fromarray((skin * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(14))) / 255
        body = np.array([30, 22, 20]) * (1 - skin)[..., None] + np.array([118, 80, 62]) * skin[..., None]
        fig = body * (0.18 + 0.82 * key[..., None]) * light
        # rim light: edges facing the key light (right) and a cool kicker (left)
        right = np.array(ImageChops.subtract(mask, ImageChops.offset(mask, 10, 0)).filter(ImageFilter.GaussianBlur(5))) / 255
        left = np.array(ImageChops.subtract(mask, ImageChops.offset(mask, -8, 0)).filter(ImageFilter.GaussianBlur(4))) / 255
        top = np.array(ImageChops.subtract(mask, ImageChops.offset(mask, 0, 9)).filter(ImageFilter.GaussianBlur(5))) / 255
        rim = right[..., None] * np.array([255, 196, 130]) * 1.1 + top[..., None] * np.array([230, 170, 110]) * .55 + left[..., None] * np.array([90, 100, 130]) * .5
        img = bg * (1 - M[..., None]) + fig * M[..., None] + rim * light
        # floor bounce + vignette + grain
        img *= (1 - .55 * np.clip(np.sqrt(((xx - W * .5) / (W * .7)) ** 2 + ((yy - H * .45) / (H * .7)) ** 2) - .3, 0, 1))[..., None]
        img += np.random.default_rng(n).normal(0, 3.0, img.shape)
        frame = np.clip(img, 0, 255).astype("uint8")
        matte = np.repeat((M * 255).astype("uint8")[..., None], 3, axis=2)
        proc.stdin.write(np.concatenate([frame, matte], axis=1).tobytes())
        if n == 0: first = frame
        if n % 30 == 0: print("subject frame", n, flush=True)
    proc.stdin.close(); proc.wait()
    Image.fromarray(first).save(poster, quality=85)
    print(mp4, poster)

if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "cards"
    if what in ("cards", "all"): make_cards()
    if what in ("subject", "all"): make_subject()
