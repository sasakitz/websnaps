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

def lerp(a, b, t):
    return a + (b - a) * t

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

    # --- 円形背景（円の外は透明）---
    # 全ての要素はこの円（半径0.46）の内側に収まるよう設計
    bg_d = math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2)
    if bg_d > 0.48:
        return (0, 0, 0, 0)

    # インディゴグラデーション背景
    t = ny
    br = int(lerp(108, 72, t))
    bg = int(lerp(110, 65, t))
    bb = int(lerp(243, 218, t))

    # --- カメラボディ（丸角矩形）---
    # 全コーナーが円内に収まる範囲: 0.18〜0.82 × 0.29〜0.80
    # 底隅(0.18, 0.80): 中心からの距離 = sqrt(0.32²+0.30²) ≈ 0.439 < 0.46 ✓
    body = rrect(nx, ny, 0.18, 0.29, 0.82, 0.80, 0.09)

    # --- ファインダーバンプ（上部中央）---
    # バンプ隅(0.37, 0.17): 距離 = sqrt(0.13²+0.33²) ≈ 0.355 < 0.46 ✓
    bump = rrect(nx, ny, 0.37, 0.17, 0.63, 0.30, 0.05)

    if body or bump:
        # --- レンズ ---
        lx, ly = 0.5, 0.555
        ld = math.sqrt((nx - lx) ** 2 + (ny - ly) ** 2)

        # レンズ外リム（白）
        if 0.175 <= ld < 0.215:
            aa = 1.0 - max(0.0, (ld - 0.195) / 0.02)
            return (255, 255, 255, int(240 * aa + 180 * (1 - aa)))

        # レンズ内リム（薄いリング）
        if 0.155 <= ld < 0.175:
            return (180, 190, 255, 255)

        # レンズ内部（濃い青）
        if ld < 0.155:
            # 光沢ハイライト（左上）
            hl = math.sqrt((nx - 0.43) ** 2 + (ny - 0.49) ** 2)
            if hl < 0.04:
                intensity = 1.0 - hl / 0.04
                return (
                    int(lerp(60, 210, intensity)),
                    int(lerp(80, 225, intensity)),
                    int(lerp(200, 255, intensity)),
                    255
                )
            # 小さなハイライト（右下）
            hl2 = math.sqrt((nx - 0.55) ** 2 + (ny - 0.60) ** 2)
            if hl2 < 0.018:
                intensity = 1.0 - hl2 / 0.018
                return (
                    int(lerp(60, 110, intensity)),
                    int(lerp(80, 130, intensity)),
                    int(lerp(200, 240, intensity)),
                    255
                )
            return (52, 72, 195, 255)

        # --- カメラボディ本体（白）---
        # フラッシュインジケーター（左上の小円）
        fl = math.sqrt((nx - 0.265) ** 2 + (ny - 0.365) ** 2)
        if fl < 0.038:
            return (200, 215, 255, 255)

        # ボディの微妙なシェーディング（立体感）
        shade = int(12 * (ny - 0.29))
        v = max(235, 255 - shade)
        return (v, v, v, 245)

    return (br, bg, bb, 255)


script_dir = os.path.dirname(os.path.abspath(__file__))

for size in [16, 48, 128]:
    png = create_png(size, size, camera_pixel)
    path = os.path.join(script_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'Created {path} ({len(png)} bytes)')

print('Icons generated successfully!')
