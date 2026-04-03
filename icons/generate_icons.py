#!/usr/bin/env python3
"""Generate WebSnaps icon PNG files - clear camera silhouette."""
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

    INDIGO = (99, 102, 241, 255)
    WHITE  = (255, 255, 255, 255)

    # ── 背景: 丸角正方形（角半径22%）──────────────────────────────────
    if not rrect(nx, ny, 0.0, 0.0, 1.0, 1.0, 0.22):
        return (0, 0, 0, 0)

    # ── カメラボディ: 幅広・高さも確保してシルエットを明確に ──────────
    # 幅 82%・高さ 59%。角半径 0.22 の背景内に全コーナーが収まる。
    body = rrect(nx, ny, 0.09, 0.24, 0.91, 0.83, 0.11)

    # ── ファインダーバンプ: 幅 30%・上部中央 ─────────────────────────
    bump = rrect(nx, ny, 0.35, 0.12, 0.65, 0.25, 0.07)

    if body or bump:
        lx, ly = 0.5, 0.56
        ld = math.sqrt((nx - lx) ** 2 + (ny - ly) ** 2)

        # ── レンズ: アイコン幅の約 47% と大きく描いてカメラらしく ─────
        LENS_OUTER = 0.235   # 白いリングの外縁
        LENS_INNER = 0.145   # インディゴで抜く内側（リング幅 ≈ 9%）
        CENTER_DOT = 0.055   # 中心の白い点（32px 以上のみ）

        if ld < CENTER_DOT and w >= 32:
            return WHITE        # 中心点（レンズのハイライト感）

        if ld < LENS_INNER:
            return INDIGO       # レンズ内部（背景色で抜く）

        if ld < LENS_OUTER:
            return WHITE        # レンズリング（白・太め）

        return WHITE            # ボディ本体

    return INDIGO

script_dir = os.path.dirname(os.path.abspath(__file__))

for size in [16, 48, 128]:
    png = create_png(size, size, camera_pixel)
    path = os.path.join(script_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'Created {path} ({len(png)} bytes)')

print('Done.')
