"""Own-made, seamless dark-green pebbled-leather tile for the frame background.

  python tools/make_green.py   -> assets/bg/green-leather.jpg (512 x 512, tiles in both directions)

Pebbles are periodic Voronoi cells with a rounded bevel, lit from the top left,
plus fine grain; colours match the reference tile's range (mean ~ rgb(50, 64, 52)).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

N = 512; CELLS = 58
rng = np.random.default_rng(11)
pts = rng.random((CELLS * CELLS, 2)) * N
# jittered grid so pebbles are evenly sized
gx, gy = np.meshgrid(np.arange(CELLS), np.arange(CELLS))
pts = (np.stack([gx.ravel(), gy.ravel()], 1) + rng.random((CELLS * CELLS, 2)) * 0.85) * (N / CELLS)

yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
d1 = np.full((N, N), 1e9, np.float32); d2 = np.full((N, N), 1e9, np.float32)
idx = np.zeros((N, N), np.int32); cellv = rng.random(len(pts))
for ox in (-N, 0, N):
    for oy in (-N, 0, N):
        for k, (px, py) in enumerate(pts):
            cx, cy = px + ox, py + oy
            if cx < -40 or cx > N + 40 or cy < -40 or cy > N + 40: continue
            d = (xx - cx) ** 2 + (yy - cy) ** 2
            m = d < d1
            d2 = np.where(m, d1, np.minimum(d2, d)); d1 = np.where(m, d, d1); idx = np.where(m, k, idx)
edge = np.sqrt(d2) - np.sqrt(d1)              # 0 at cell borders
height = np.clip(edge / 3.6, 0, 1) ** 0.55 * (0.55 + 0.45 * cellv[idx])   # rounded pebbles, uneven heights
height = np.array(Image.fromarray((height * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255.0

# light from the top left
gyh, gxh = np.gradient(height)
shade = np.clip(0.55 - (gxh * 3.4 + gyh * 3.4), 0, 1.6)
spec = np.clip(-(gxh + gyh) * 6 - 0.35, 0, 1) ** 2 * (cellv[idx] > 0.45)
grain = rng.normal(0, 1, (N, N))
grain = np.array(Image.fromarray(np.clip(grain * 30 + 128, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))) / 255.0 - 0.5
low = np.array(Image.fromarray((rng.random((8, 8)) * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)) / 255.0

base = np.array([22, 36, 26], np.float32)
hi = np.array([86, 110, 90], np.float32)
t = np.clip(0.18 + 0.5 * height * shade + 0.16 * grain + 0.1 * (low - 0.5) + 0.12 * (cellv[idx] - 0.5), 0, 1)[..., None]
col = base * (1 - t) + hi * t
col *= (0.5 + 0.5 * np.clip(height + 0.15, 0, 1))[..., None]      # dark crevices
col += spec[..., None] * np.array([70, 92, 74])                    # glinting pebble tops
os.makedirs("assets/bg", exist_ok=True)
Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save("assets/bg/green-leather.jpg", quality=90)
print("mean", col.reshape(-1, 3).mean(0).round(1))
