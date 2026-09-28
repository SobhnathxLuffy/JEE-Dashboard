#!/usr/bin/env python3
"""Generate the JEE Study App icon set.

Design language: warm "Quiet Cockpit" palette (ivory #FAF9F5, coral #D97757,
charcoal #262624). Mark = timer ring with a gap + a charcoal hand pointing at a
coral dot in the gap -> "correct under time".

Outputs (public/):
  logo.svg              vector version (hand-written counterpart, same geometry)
  icons/icon-192.png    any-purpose
  icons/icon-512.png    any-purpose
  icons/maskable-512.png full-bleed, content inside 80% safe zone
  icons/apple-touch-icon.png (180, full-bleed)
  favicon.ico           16/32/48
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")

IVORY = (250, 249, 245, 255)      # #FAF9F5
CORAL = (217, 119, 87, 255)       # #D97757
CHARCOAL = (38, 38, 36, 255)      # #262624

# Geometry defined at a 512 grid, scaled by `k`.
BG_RADIUS = 110     # rounded-square corner radius
RING_MID = 132      # ring centerline radius
RING_W = 36         # ring stroke width
HAND_LEN = 100      # pointer length from center
HAND_W = 32         # pointer width
DOT_R = 27          # dot radius (sits in the ring gap)
GAP_CENTER = -45    # degrees, pixel coords (0 = 3 o'clock, clockwise, y down)
GAP_DEG = 70        # gap size


def point(cx, cy, rad, k, deg):
    a = math.radians(deg)
    return (cx + rad * k * math.cos(a), cy + rad * k * math.sin(a))


def make_icon(size: int, full_bleed: bool, scale: float = 1.0) -> Image.Image:
    S = 4  # supersample factor for smooth edges
    W = size * S
    k = (W / 512.0) * scale
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # background
    if full_bleed:
        d.rectangle([0, 0, W - 1, W - 1], fill=IVORY)
    else:
        d.rounded_rectangle([0, 0, W - 1, W - 1], radius=BG_RADIUS * k, fill=IVORY)

    cx = cy = W / 2.0

    # coral ring with gap (arc measured clockwise from 3 o'clock)
    r_out = (RING_MID + RING_W / 2) * k
    bbox = [cx - r_out, cy - r_out, cx + r_out, cy + r_out]
    # gap spans [GAP_CENTER - GAP/2, GAP_CENTER + GAP/2]; arc sweeps the rest clockwise
    start = GAP_CENTER + GAP_DEG / 2            # e.g. -10 deg
    end = GAP_CENTER - GAP_DEG / 2 + 360        # e.g. 280 deg
    d.arc(bbox, start=start, end=end, fill=CORAL, width=max(1, round(RING_W * k)))

    # charcoal hand (rounded caps)
    hx, hy = point(cx, cy, HAND_LEN, k, GAP_CENTER)
    lw = max(1, round(HAND_W * k))
    d.line([(cx, cy), (hx, hy)], fill=CHARCOAL, width=lw)
    cap = lw / 2.0
    d.ellipse([cx - cap, cy - cap, cx + cap, cy + cap], fill=CHARCOAL)
    d.ellipse([hx - cap, hy - cap, hx + cap, hy + cap], fill=CHARCOAL)

    # coral dot inside the gap, on the ring centerline
    dx, dy = point(cx, cy, RING_MID, k, GAP_CENTER)
    dr = DOT_R * k
    d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=CORAL)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(os.path.join(PUBLIC, "icons"), exist_ok=True)

    make_icon(192, full_bleed=False).save(os.path.join(PUBLIC, "icons", "icon-192.png"))
    make_icon(512, full_bleed=False).save(os.path.join(PUBLIC, "icons", "icon-512.png"))
    make_icon(512, full_bleed=True, scale=0.72).save(os.path.join(PUBLIC, "icons", "maskable-512.png"))
    make_icon(180, full_bleed=True, scale=0.80).save(os.path.join(PUBLIC, "icons", "apple-touch-icon.png"))

    base = make_icon(512, full_bleed=False)
    base.save(
        os.path.join(PUBLIC, "favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    for f in sorted(os.listdir(os.path.join(PUBLIC, "icons"))):
        p = os.path.join(PUBLIC, "icons", f)
        print(f"{f:24s} {os.path.getsize(p):>7d} bytes")
    print("favicon.ico              ", os.path.getsize(os.path.join(PUBLIC, "favicon.ico")), "bytes")


if __name__ == "__main__":
    main()
