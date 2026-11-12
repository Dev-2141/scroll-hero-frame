"""Cut a portrait out of its background, offline (OpenCV GrabCut + guided-filter edge matting).

  python tools/cutout_portrait.py "<input.png>" assets/subject/portrait

Writes:
  <out>.png         RGBA cut-out at full resolution. Pixels are untouched: only the alpha changes,
                    so the face and features stay exactly as photographed.
  <out>-depth.png   a soft depth map (white = near) used by the frame for its 2.5D parallax.
  <out>-preview.jpg the cut-out over a checkerboard, for checking the edges.

The photo's background is out of focus, so a local sharpness map seeds GrabCut,
then a guided filter turns the hard mask into a soft alpha that follows hair.
"""
import sys, os
import numpy as np
import cv2
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(out), exist_ok=True)
rgb = np.array(Image.open(src).convert("RGB"))
H, W = rgb.shape[:2]
gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0

# ---------------------------------------------------------------- seed from sharpness
lap = np.abs(cv2.Laplacian(gray, cv2.CV_32F, ksize=3))
sharp = cv2.GaussianBlur(lap, (0, 0), 9)
sharp = sharp / (np.percentile(sharp, 99.5) + 1e-6)

S = 0.5  # work at half size for GrabCut
small = cv2.resize(rgb, (int(W * S), int(H * S)), interpolation=cv2.INTER_AREA)
sh = cv2.resize(sharp, (small.shape[1], small.shape[0]))
h, w = sh.shape
mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
mask[sh > 0.22] = cv2.GC_PR_FGD
# sure background: top band and the upper side margins (sky, trees, lamp)
mask[: int(h * 0.17), :] = cv2.GC_BGD
mask[: int(h * 0.42), : int(w * 0.18)] = cv2.GC_BGD
mask[: int(h * 0.40), int(w * 0.80):] = cv2.GC_BGD
# sure foreground: face, neck, chest and both shoulders (portrait framing)
cv2.ellipse(mask, (int(w * 0.52), int(h * 0.46)), (int(w * 0.13), int(h * 0.12)), 0, 0, 360, cv2.GC_FGD, -1)
cv2.rectangle(mask, (int(w * 0.40), int(h * 0.62)), (int(w * 0.72), int(h * 0.98)), cv2.GC_FGD, -1)
cv2.rectangle(mask, (int(w * 0.12), int(h * 0.80)), (int(w * 0.90), int(h * 0.99)), cv2.GC_FGD, -1)
# hair: dark on a dark sky, so colour alone loses it. Core = sure subject, the
# sharp (in-focus) texture around it = probably subject.
cv2.ellipse(mask, (int(w * 0.515), int(h * 0.335)), (int(w * 0.165), int(h * 0.075)), 0, 0, 360, cv2.GC_FGD, -1)
hair_zone = np.zeros_like(mask); cv2.ellipse(hair_zone, (int(w * 0.515), int(h * 0.32)), (int(w * 0.22), int(h * 0.11)), 0, 0, 360, 1, -1)
mask[(hair_zone == 1) & (sh > 0.12) & (mask != cv2.GC_FGD)] = cv2.GC_PR_FGD

# ears (they sit at the edge of the in-focus zone and get clipped otherwise)
cv2.ellipse(mask, (int(w * 0.375), int(h * 0.475)), (int(w * 0.03), int(h * 0.04)), 0, 0, 360, cv2.GC_FGD, -1)
cv2.ellipse(mask, (int(w * 0.685), int(h * 0.455)), (int(w * 0.025), int(h * 0.04)), 0, 0, 360, cv2.GC_FGD, -1)

bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
cv2.grabCut(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), mask, None, bgd, fgd, 10, cv2.GC_INIT_WITH_MASK)
hard = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1.0, 0.0).astype(np.float32)

# keep the largest connected body, fill holes
n, lab, stats, _ = cv2.connectedComponentsWithStats((hard > 0.5).astype(np.uint8), 8)
if n > 1:
    big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    hard = (lab == big).astype(np.float32)
inv = (hard < 0.5).astype(np.uint8)
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
for i in range(1, n2):
    x, y, ww, hh, area = st2[i]
    if x > 0 and y > 0 and x + ww < w and y + hh < h:  # enclosed hole -> fill
        hard[lab2 == i] = 1.0
hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
hard = cv2.resize(hard, (W, H), interpolation=cv2.INTER_LINEAR)

# ---------------------------------------------------------------- guided filter -> soft alpha
def box(x, r): return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
def guided(I, p, r, eps):
    mI, mp = box(I, r), box(p, r)
    cov = box(I * p, r) - mI * mp
    var = box(I * I, r) - mI * mI
    a = cov / (var + eps); b = mp - a * mI
    return box(a, r) * I + box(b, r)
alpha = guided(gray, hard, 8, 6e-4)
alpha = guided(gray, np.clip(alpha, 0, 1), 3, 3e-4)
# tighten: drop the faint haze of out-of-focus background kept around hair and shoulders
alpha = np.clip((alpha - 0.30) / 0.55, 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)
# never let the matte eat into the solid interior
core = cv2.erode((hard > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8)).astype(np.float32)
alpha = np.maximum(alpha, core)

# ---------------------------------------------------------------- edge colour decontamination
# Estimate the background colour behind each edge pixel (blur of the pure background,
# normalised), then solve I = a*F + (1-a)*B for the foreground colour F. This removes the
# grey/white halo. Only semi-transparent edge pixels change; the interior stays original.
img = rgb.astype(np.float32)
bgw = (alpha < 0.02).astype(np.float32)
Bsum = cv2.GaussianBlur(img * bgw[..., None], (0, 0), 25)
Bw = cv2.GaussianBlur(bgw, (0, 0), 25)[..., None]
B = Bsum / np.maximum(Bw, 1e-4)
a3 = np.maximum(alpha, 0.08)[..., None]
Fcol = np.clip((img - (1 - a3) * B) / a3, 0, 255)
edge = ((alpha > 0.0) & (alpha < 0.98))[..., None]
# blend toward the nearest interior colour where alpha is very low, so faint pixels are not noisy
Isum = cv2.GaussianBlur(img * (alpha[..., None] > 0.98), (0, 0), 4)
Iw = cv2.GaussianBlur((alpha > 0.98).astype(np.float32), (0, 0), 4)[..., None]
interior = Isum / np.maximum(Iw, 1e-4)
Fcol = np.where(Iw > 0.05, Fcol * np.clip(a3 * 1.6, 0, 1) + interior * (1 - np.clip(a3 * 1.6, 0, 1)), Fcol)
out_rgb = np.where(edge, Fcol, img).astype(np.uint8)

rgba = np.dstack([out_rgb, (alpha * 255).astype(np.uint8)])
Image.fromarray(rgba, "RGBA").save(out + ".png", optimize=True)

# ---------------------------------------------------------------- depth (white = near)
# Bulge from the silhouette's interior (distance transform), a stronger dome on the face,
# shoulders falling away; smooth so the parallax never tears.
dist = cv2.distanceTransform((alpha > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
dist = dist / (dist.max() + 1e-6)
yy, xx = np.mgrid[0:H, 0:W]
face = np.exp(-(((xx - W * 0.52) / (W * 0.16)) ** 2 + ((yy - H * 0.47) / (H * 0.17)) ** 2))
nose = np.exp(-(((xx - W * 0.52) / (W * 0.05)) ** 2 + ((yy - H * 0.52) / (H * 0.05)) ** 2))
depth = 0.35 * np.sqrt(dist) + 0.45 * face + 0.12 * nose + 0.1 * (yy / H)
depth = cv2.GaussianBlur(depth.astype(np.float32), (0, 0), 18)
depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-6)
depth = depth * np.clip(alpha * 1.4, 0, 1)
Image.fromarray((depth * 255).astype(np.uint8)).save(out + "-depth.png")

# ---------------------------------------------------------------- preview
chk = ((xx // 32 + yy // 32) % 2).astype(np.float32)[..., None] * 60 + 40
prev = rgb.astype(np.float32) * alpha[..., None] + chk * (1 - alpha[..., None])
Image.fromarray(prev.astype(np.uint8)).resize((W // 2, H // 2)).save(out + "-preview.jpg", quality=88)
print("cut-out:", out + ".png", "coverage %.1f%%" % (alpha.mean() * 100))
