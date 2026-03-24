#!/usr/bin/env python3
"""Generate WebSnaps icon PNG files."""
import struct
import zlib
import os
import math

def make_chunk(chunk_type, data):
    raw = chunk_type + data
    crc = zlib.crc32(raw) & 0xffffffff
    return struct.pack('>I', len(data)) + raw + struct.pack('>I', crc)

def create_png(width, height, pixel_func):
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            r, g, b, a = pixel_func(x, y, width, height)
            raw.extend([
                max(0, min(255, r)),
                max(0, min(255, g)),
                max(0, min(255, b)),
                max(0, min(255, a))
            ])
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = make_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    idat = make_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend = make_chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

def lerp(a, b, t):
    return a + (b - a) * t

def camera_pixel(x, y, w, h):
    nx = x / w
    ny = y / h

    # Background gradient: indigo #6366f1 to #4f46e5
    bg_r = int(lerp(99, 79, ny))
    bg_g = int(lerp(102, 70, ny))
    bg_b = int(lerp(241, 229, ny))

    # Rounded background
    cx_bg, cy_bg = 0.5, 0.5
    r_bg = 0.48
    if (nx - cx_bg)**2 + (ny - cy_bg)**2 > r_bg**2:
        return (0, 0, 0, 0)  # transparent outside circle

    # Camera body parameters
    body_l, body_r = 0.1, 0.9
    body_t, body_b = 0.3, 0.88

    # Viewfinder bump (top center)
    bump_l, bump_r = 0.35, 0.65
    bump_t, bump_b = 0.15, 0.32

    in_body = (body_l < nx < body_r and body_t < ny < body_b)
    in_bump = (bump_l < nx < bump_r and bump_t < ny < bump_b)

    if in_body or in_bump:
        # Lens circle
        lx, ly, lr = 0.5, 0.595, 0.22
        dist_to_lens = math.sqrt((nx - lx)**2 + (ny - ly)**2)

        # Outer ring of lens
        if lr - 0.04 < dist_to_lens < lr:
            return (255, 255, 255, 220)
        # Inner lens area
        elif dist_to_lens < lr - 0.04:
            # Subtle blue-tinted lens with highlight
            hl_dist = math.sqrt((nx - (lx - 0.06))**2 + (ny - (ly - 0.06))**2)
            if hl_dist < 0.06:
                alpha = int(200 * (1 - hl_dist / 0.06))
                return (200, 210, 255, alpha + 55)
            return (120, 140, 230, 200)
        # Camera body
        else:
            # Slight shading
            shade = int(30 * ny)
            return (255 - shade, 255 - shade, 255 - shade, 230)
    else:
        return (bg_r, bg_g, bg_b, 255)

os.makedirs(os.path.dirname(os.path.abspath(__file__)), exist_ok=True)
script_dir = os.path.dirname(os.path.abspath(__file__))

for size in [16, 48, 128]:
    png = create_png(size, size, camera_pixel)
    path = os.path.join(script_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'Created {path} ({len(png)} bytes)')

print('Icons generated successfully!')
