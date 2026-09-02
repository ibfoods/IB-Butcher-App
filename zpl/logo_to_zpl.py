"""
Convert the Iavarone Bros. logo (SVG source) into a ZPL ^GFA graphic field
for embedding in the production label template.

Regenerate this if the logo ever changes. Requires: pip install cairosvg pillow

Usage:
    python3 logo_to_zpl.py path/to/logo.svg > logo_zpl.txt

Then paste the output (a single ^GFA,... line) into the label template
right after ^FO16,12 (or wherever the logo field origin is).
"""
import sys
import cairosvg
from PIL import Image

def svg_to_zpl_graphic(svg_path, target_dots=132, threshold=128):
    # Rasterize at 4x target size for clean downsampling, white background
    raster_size = target_dots * 4
    png_bytes = cairosvg.svg2png(
        url=svg_path,
        output_width=raster_size,
        output_height=raster_size,
        background_color="white",
    )
    import io
    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    img = img.resize((target_dots, target_dots), Image.LANCZOS)

    # Black pixels (< threshold) print (bit=1); white pixels don't (bit=0)
    bw = img.point(lambda p: 0 if p < threshold else 255)

    width, height = bw.size
    bytes_per_row = (width + 7) // 8
    total_bytes = bytes_per_row * height

    pixels = bw.load()
    hex_rows = []
    for y in range(height):
        row_bits = []
        for x in range(width):
            row_bits.append('1' if pixels[x, y] == 0 else '0')
        while len(row_bits) % 8 != 0:
            row_bits.append('0')
        row_bytes = []
        for i in range(0, len(row_bits), 8):
            byte = row_bits[i:i + 8]
            row_bytes.append(format(int(''.join(byte), 2), '02X'))
        hex_rows.append(''.join(row_bytes))

    hex_data = ''.join(hex_rows)
    return f"^GFA,{total_bytes},{total_bytes},{bytes_per_row},{hex_data}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 logo_to_zpl.py path/to/logo.svg", file=sys.stderr)
        sys.exit(1)
    print(svg_to_zpl_graphic(sys.argv[1]))
