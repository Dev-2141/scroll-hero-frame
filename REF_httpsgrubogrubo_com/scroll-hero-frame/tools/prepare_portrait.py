"""Prepare an already cut-out portrait (transparent background) for the glass scene.

  python tools/prepare_portrait.py <input.webp|png> assets/subject/<name>

Writes <name>.png (same pixels, PNG) and <name>-depth.png (white = near) used for
the 2.5D parallax. Use tools/cutout_portrait.py instead if the photo still has
its background.
"""
import sys, os
import numpy as np
import cv2
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(out), exist_ok=True)
im = Image.open(src).convert("RGBA")
im.save(out + ".png", optimize=True)
a = np.array(im)[..., 3].astype(np.float32) / 255.0
H, W = a.shape

# face centre: the widest solid row band in the upper half is the head
solid = a > 0.5
ys = np.where(solid.any(1))[0]
top = ys.min() if len(ys) else 0
fy = top + 0.30 * (H - top)                     # face sits ~30% down from the top of the hair
cols = np.where(solid[int(fy)])[0]
fx = cols.mean() if len(cols) else W * 0.52

dist = cv2.distanceTransform(solid.astype(np.uint8), cv2.DIST_L2, 5)
dist = dist / (dist.max() + 1e-6)
yy, xx = np.mgrid[0:H, 0:W]
face = np.exp(-(((xx - fx) / (W * 0.16)) ** 2 + ((yy - fy) / (H * 0.17)) ** 2))
nose = np.exp(-(((xx - fx) / (W * 0.05)) ** 2 + ((yy - (fy + H * 0.05)) / (H * 0.05)) ** 2))
depth = 0.35 * np.sqrt(dist) + 0.45 * face + 0.12 * nose + 0.1 * (yy / H)
depth = cv2.GaussianBlur(depth.astype(np.float32), (0, 0), 18)
depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-6)
depth *= np.clip(a * 1.4, 0, 1)
Image.fromarray((depth * 255).astype(np.uint8)).save(out + "-depth.png")
print(out, "face at %.2f, %.2f" % (fx / W, fy / H))
