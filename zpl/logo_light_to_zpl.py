"""
Build the LIGHT label logo (black letters/rings on a white disc) from the
white-on-dark 2024 monogram, as a ZPL ^GFA graphic field.

The solid-black logo printed too dark on the Zebra GK420t (203 dpi) and lost
its detail, so the label now uses this inverted version by default.
The original solid logo is still in src/zebraPrint.js (LOGO_GFA_DARK).

Usage:
    python3 logo_light_to_zpl.py assets/iavarone-monogram-white-2024.svg [png_out]
Prints a single ^GFA,... line; optionally also writes a 600px PNG of the
light logo (used by the browser-print backup: public/brand/label-logo-light.png).
Requires: pip install cairosvg pillow
"""
import io, re, sys
import cairosvg
from PIL import Image, ImageDraw, ImageOps

VIEWBOX = 429.5
CX, CY, R = 225.88, 216.13, 194.73   # outer circle of the monogram, in SVG units

def light_image(svg_path, size):
    s = open(svg_path).read()
    s = re.sub(r'<rect[^>]*/>', '', s).replace('fill: #fff;', 'fill: #000;')
    im = Image.open(io.BytesIO(cairosvg.svg2png(
        bytestring=s.encode(), output_width=size, output_height=size,
        background_color='white'))).convert('L')
    k = size / VIEWBOX
    cx, cy, r = CX * k, CY * k, R * k
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - r + 2, cy - r + 2, cx + r - 2, cy + r - 2), fill=255)
    out = Image.composite(ImageOps.invert(im), Image.new('L', im.size, 255), mask)
    ImageDraw.Draw(out).ellipse((cx - r, cy - r, cx + r, cy + r), outline=0,
                                width=max(2, round(size * 0.012)))
    return out

def to_gfa(img, dots=132, threshold=170):
    img = img.resize((dots, dots), Image.LANCZOS)
    w, h = img.size
    bpr = (w + 7) // 8
    px = img.load()
    rows = []
    for y in range(h):
        bits = ''.join('1' if px[x, y] < threshold else '0' for x in range(w))
        bits += '0' * (bpr * 8 - len(bits))
        rows.append(''.join(format(int(bits[i:i + 8], 2), '02X') for i in range(0, len(bits), 8)))
    total = bpr * h
    return f"^GFA,{total},{total},{bpr},{''.join(rows)}"

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr); sys.exit(1)
    print(to_gfa(light_image(sys.argv[1], 132 * 8)))
    if len(sys.argv) > 2:
        light_image(sys.argv[1], 600).convert('RGB').save(sys.argv[2])
