#!/usr/bin/env python3
"""Turn downloaded planetary maps into the assets the renderer wants.

Reproducible on purpose: the sources are named here with their licences, and
the transform each one gets is the interesting part.

The height map is the fiddly one. The renderer decides where the coast goes by
thresholding a height field whose distribution it knows -- the procedural
terrain is very nearly N(0.4972, 0.05313) -- so a real DEM has to be remapped
into that same distribution or `seaLevelForLand` would put Earth's coastline in
the wrong place. Matching the histogram (area-weighted, because an
equirectangular row near the pole covers almost no globe) does exactly that, and
it also means a real world and a procedural one can be blended without the land
fraction moving, since a mixture of two identical distributions is that
distribution.

Stored as PNG, not JPEG: ringing along a coastline in a *height* map turns into
ragged shorelines, and the file is only about a megabyte.
"""
from PIL import Image
import numpy as np, os, sys
from math import sqrt, log

Image.MAX_IMAGE_PIXELS = None
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tex'
# Two levels up, not one: /altdev and /dev are folders on main that share the
# repository root's assets/ -- see the __assetBase in each index.html. Writing
# one level up quietly created altdev/assets/bodies/ that nothing ever reads.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'bodies')
W, H = 2048, 1024
TERRAIN_MEAN, TERRAIN_SD = 0.4972, 0.05313     # matches src/render/terrain.js
HEIGHT_LO, HEIGHT_HI = 0.30, 0.70              # the byte spans this much of the field

def probit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    # Acklam, vectorised
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    pl, ph = 0.02425, 1 - 0.02425
    out = np.empty_like(p)
    lo, hi = p < pl, p > ph
    mid = ~(lo | hi)
    q = np.sqrt(-2 * np.log(np.where(lo, p, pl)))
    out_lo = (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = np.sqrt(-2 * np.log(np.where(hi, 1 - p, pl)))
    out_hi = -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5; r = q * q
    out_mid = (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)
    out[lo] = out_lo[lo]; out[hi] = out_hi[hi]; out[mid] = out_mid[mid]
    return out

def save(im, name, **kw):
    p = os.path.join(OUT, name)
    im.save(p, **kw)
    print(f'  {name:22} {im.size[0]}x{im.size[1]}  {os.path.getsize(p)/1e3:.0f} kB')

os.makedirs(OUT, exist_ok=True)

# Rebuild only what is actually downloaded. Every body here comes from a
# different archive with a different licence, and needing all five present to
# regenerate any one of them made adding the sixth harder than it had to be.
def have(name):
    if os.path.exists(os.path.join(SRC, name)):
        return True
    print(f'  skip   {name} not in {SRC}')
    return False

# --- colour ---------------------------------------------------------------
for src, name in [('earth_color.jpg', 'earth.jpg'), ('mars_color.jpg', 'mars.jpg'),
                  ('venus_color.jpg', 'venus.jpg')]:
    if not have(src):
        continue
    save(Image.open(os.path.join(SRC, src)).convert('RGB').resize((W, H), Image.LANCZOS),
         name, quality=88, optimize=True, progressive=True)

# Titan's global map is infrared and monochrome. Under its haze the world is
# orange, so brightness is mapped onto a Titan palette rather than shipping a
# grey moon: dark equatorial dune fields to bright highlands.
if have('titan_color.jpg'):
  t = np.asarray(Image.open(os.path.join(SRC, 'titan_color.jpg')).convert('L')
                 .resize((W, H), Image.LANCZOS)).astype(float) / 255
  lo, hi = np.array([0.24, 0.15, 0.10]), np.array([0.86, 0.70, 0.44])
  save(Image.fromarray((np.clip(lo + (hi - lo) * (t[..., None] ** 0.85), 0, 1) * 255).astype(np.uint8)),
       'titan.jpg', quality=88, optimize=True, progressive=True)

# --- topography, matched to the terrain distribution -----------------------
area = np.repeat(np.sin((np.arange(H) + 0.5) / H * np.pi)[:, None], W, axis=1)

# Both DEMs get the same treatment, so it is written once.
def match_and_save(field, name):
    order = np.argsort(field, axis=None, kind='stable')
    cum = np.cumsum(area.ravel()[order])
    q = np.empty(field.size)
    q[order] = (cum - 0.5 * area.ravel()[order]) / cum[-1]   # area-weighted rank
    g = TERRAIN_MEAN + TERRAIN_SD * probit(q)
    byte = np.clip((g - HEIGHT_LO) / (HEIGHT_HI - HEIGHT_LO), 0, 1) * 255
    save(Image.fromarray(byte.reshape(H, W).round().astype(np.uint8)), name, optimize=True)

if have('earth_height.png'):
    match_and_save(np.asarray(Image.open(os.path.join(SRC, 'earth_height.png')).convert('L')
                              .resize((W, H), Image.LANCZOS)).astype(np.float64), 'earth_height.png')

# --- Mars's topography, from MOLA, the same way -----------------------------
#
# megt90n000eb.img is the MOLA MEGDR global grid at 16 pixels/degree: 5760x2880
# signed 16-bit big-endian metres above the areoid, straight off the PDS. It
# checks out against the planet -- 21171 m at 17.3N 227.0E is Olympus Mons and
# -8177 m at 32.8S 62.2E is the Hellas floor.
#
# The one thing that is not obvious is the longitude origin, and getting it
# wrong puts Olympus Mons in Elysium. MEGDR starts at 0 E on its left edge; the
# Solar System Scope colour map is centred on 0, so its left edge is 180 E, and
# the two have to be rolled half a width apart. That was settled by looking at
# them stacked -- the albedo's Olympus ring lands on the DEM's Olympus peak only
# at this offset. An albedo-elevation cross-correlation does NOT settle it and
# confidently answers 244 E: Mars's brightness is dust, not relief.
if have('megt90n000eb.img'):
    mola = np.fromfile(os.path.join(SRC, 'megt90n000eb.img'), dtype='>i2')
    mola = mola.reshape(2880, 5760).astype(np.float64)
    mola = np.roll(mola, -mola.shape[1] // 2, axis=1)       # 0 E origin -> 180 E
    match_and_save(np.asarray(Image.fromarray(mola).resize((W, H), Image.LANCZOS))
                   .astype(np.float64), 'mars_height.png')

print(f'\n  matched to N({TERRAIN_MEAN}, {TERRAIN_SD}); byte spans {HEIGHT_LO}..{HEIGHT_HI}')
