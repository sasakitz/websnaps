#!/usr/bin/env python3
"""Render the WebSnaps capture-frame mark as antialiased PNGs (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw


def generate_icon(size, mark_scale=1.2):
    scale = 8
    unit = size * scale / 40
    image = Image.new('RGBA', (size * scale, size * scale))
    draw = ImageDraw.Draw(image)

    def box(coords):
        return tuple(round(value * unit) for value in coords)

    def mark_box(coords):
        return box(tuple((value - 20) * mark_scale + 20 for value in coords))

    draw.rounded_rectangle(box((0, 0, 40, 40)), radius=round(11 * unit), fill='#123c3a')
    for points in [((16, 10), (10, 10), (10, 16)),
                   ((24, 30), (30, 30), (30, 24)),
                   ((10, 24), (10, 30), (16, 30))]:
        draw.line([mark_box(point) for point in points], fill='#c5f47a', width=round(3 * unit * mark_scale), joint='curve')
        for x, y in points:
            draw.ellipse(mark_box((x - 1.5, y - 1.5, x + 1.5, y + 1.5)), fill='#c5f47a')
    draw.rounded_rectangle(mark_box((16, 16, 24, 24)), radius=round(2.5 * unit * mark_scale), fill='white')
    star = [(29, 7), (30.6, 11.4), (35, 13), (30.6, 14.6),
            (29, 19), (27.4, 14.6), (23, 13), (27.4, 11.4)]
    draw.polygon([mark_box(point) for point in star], fill='#c5f47a')
    return image.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == '__main__':
    for size in (16, 48, 128):
        path = Path(__file__).with_name(f'icon{size}.png')
        image = generate_icon(size)
        if size == 128:
            # CWS square artwork: 96px mark with 16px transparent padding.
            image = Image.new('RGBA', (128, 128))
            image.paste(generate_icon(96), (16, 16))
        image.save(path)
        print(f'Created {path}')
