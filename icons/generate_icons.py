#!/usr/bin/env python3
"""Generate WebSnaps icon PNG files - Material Design flat style."""
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
        raw.append(0)
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

def rrect(nx, ny, x0, y0, x1, y1, cr):
    """True if (nx, ny) is inside a rounded rectangle."""
    if not (x0 <= nx <= x1 and y0 <= ny <= y1):
        return False
    in_cx = nx < x0 + cr or nx > x1 - cr
    in_cy = ny < y0 + cr or ny > y1 - cr
    if in_cx and in_cy:
        ncx = x0 + cr if nx < x0 + cr else x1 - cr
        ncy = y0 + cr if ny < y0 + cr else y1 - cr
        return (nx - ncx) ** 2 + (ny - ncy) ** 2 <= cr ** 2
    return True

def camera_pixel(x, y, w, h):
    nx, ny = x / w, y / h

    # Material Design カラー（単色・フラット）
    INDIGO = (99, 102, 241, 255)   # #6366f1
    WHITE  = (255, 255, 255, 255)

    # ── 背景: 丸角正方形（角半径18%）────────────────────────────
    if not rrect(nx, ny, 0.0, 0.0, 1.0, 1.0, 0.18):
        return (0, 0, 0, 0)

    # ── カメラボディ（丸角矩形・白）──────────────────────────────
    # 四隅が背景の丸角より内側に収まる範囲
    body = rrect(nx, ny, 0.16, 0.31, 0.84, 0.80, 0.09)

    # ── ファインダーバンプ（上部中央・白）────────────────────────
    bump = rrect(nx, ny, 0.37, 0.19, 0.63, 0.32, 0.06)

    if body or bump:
        lx, ly = 0.5, 0.555
        ld = math.sqrt((nx - lx) ** 2 + (ny - ly) ** 2)

        # レンズ中心ドット（白・背景色で抜いたリングをさらに白で戻す）
        if ld < 0.065:
            return WHITE

        # レンズ開口部（インディゴで抜く → リング状に見せる）
        if ld < 0.175:
            return INDIGO

        # フラッシュインジケーター（左上の小さい丸・16px では省略）
        if w >= 32:
            fx, fy = 0.265, 0.385
            fd = math.sqrt((nx - fx) ** 2 + (ny - fy) ** 2)
            if fd < 0.055:
                return INDIGO

        # ボディ本体
        return WHITE

    # 背景
    return INDIGO


script_dir = os.path.dirname(os.path.abspath(__file__))

for size in [16, 48, 128]:
    png = create_png(size, size, camera_pixel)
    path = os.path.join(script_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'Created {path} ({len(png)} bytes)')

print('Done.')
