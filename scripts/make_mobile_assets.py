#!/usr/bin/env python3
"""Generate Capacitor assets/ (app icon + splash) from the app mark.

Outputs at project root, matching @capacitor/assets conventions:
  assets/icon.png             1024 full-bleed ivory, mark at 0.72
  assets/icon-foreground.png  1024 transparent, mark at 0.55 (adaptive fg)
  assets/icon-background.png  1024 solid ivory
  assets/splash.png           2732 ivory + mark
  assets/splash-dark.png      2732 charcoal + mark (ivory hand variant)
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")

IVORY = (250, 249, 245, 255)
CORAL = (217, 119, 87, 255)
CHARCOAL = (38, 38, 36, 255)

RING_MID, RING_W, HAND_LEN, HAND_W, DOT_R = 132, 36, 100, 32, 27
GAP_CENTER, GAP_DEG = -45, 70


def point(cx, cy, rad, k, deg):
    a = math.radians(deg)
    return (cx + rad * k * math.cos(a), cy + rad * k * math.sin(a))


def draw_mark(d, W, k, hand_color=CHARCOAL):
    cx = cy = W / 2.0
    r_out = (RING_MID + RING_W / 2) * k
    bbox = [cx - r_out, cy - r_out, cx + r_out, cy + r_out]
    start = GAP_CENTER + GAP_DEG / 2
    end = GAP_CENTER - GAP_DEG / 2 + 360
    d.arc(bbox, start=start, end=end, fill=CORAL, width=max(1, round(RING_W * k)))
    hx, hy = point(cx, cy, HAND_LEN, k, GAP_CENTER)
    lw = max(1, round(HAND_W * k))
    d.line([(cx, cy), (hx, hy)], fill=hand_color, width=lw)
    cap = lw / 2.0
    d.ellipse([cx - cap, cy - cap, cx + cap, cy + cap], fill=hand_color)
    d.ellipse([hx - cap, hy - cap, hx + cap, hy + cap], fill=hand_color)
    dx, dy = point(cx, cy, RING_MID, k, GAP_CENTER)
    dr = DOT_R * k
    d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=CORAL)


def canvas(size, bg):
    img = Image.new("RGBA", (size, size), bg)
    return img, ImageDraw.Draw(img), size / 512.0


def main():
    os.makedirs(OUT, exist_ok=True)

    img, d, k = canvas(1024, IVORY)
    draw_mark(d, 1024, k * 0.72)
    img.save(os.path.join(OUT, "icon.png"))

    img, d, k = canvas(1024, (0, 0, 0, 0))
    draw_mark(d, 1024, k * 0.55)
    img.save(os.path.join(OUT, "icon-foreground.png"))

    img, d, k = canvas(1024, IVORY)
    img.save(os.path.join(OUT, "icon-background.png"))

    img, d, k = canvas(2732, IVORY)
    draw_mark(d, 2732, k * 0.9)
    img.save(os.path.join(OUT, "splash.png"))

    img, d, k = canvas(2732, CHARCOAL)
    draw_mark(d, 2732, k * 0.9, hand_color=IVORY)
    img.save(os.path.join(OUT, "splash-dark.png"))

    for f in sorted(os.listdir(OUT)):
        print(f"{f:24s} {os.path.getsize(os.path.join(OUT, f)):>9d} bytes")


if __name__ == "__main__":
    main()
