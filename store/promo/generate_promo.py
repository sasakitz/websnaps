#!/usr/bin/env python3
"""
WebSnaps プロモーション画像ジェネレーター
生成物:
  promo_small.png   440×280  (Chrome Web Store 小プロモーションタイル)
  promo_marquee.png 1400×560 (Chrome Web Store マーキープロモーションタイル)
"""
import struct, zlib, os, math

def make_chunk(t, d):
    raw = t + d
    return struct.pack('>I', len(d)) + raw + struct.pack('>I', zlib.crc32(raw) & 0xffffffff)

def create_png(w, h, fn):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r,g,b,a = fn(x,y,w,h)
            raw.extend([max(0,min(255,v)) for v in (r,g,b,a)])
    sig = b'\x89PNG\r\n\x1a\n'
    return (sig
        + make_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + make_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + make_chunk(b'IEND', b''))

def lerp(a, b, t): return a + (b - a) * t
def clamp(v, lo=0, hi=255): return max(lo, min(hi, v))

def rrect(nx, ny, x0, y0, x1, y1, cr):
    if not (x0 <= nx <= x1 and y0 <= ny <= y1): return False
    in_cx = nx < x0+cr or nx > x1-cr
    in_cy = ny < y0+cr or ny > y1-cr
    if in_cx and in_cy:
        ncx = x0+cr if nx < x0+cr else x1-cr
        ncy = y0+cr if ny < y0+cr else y1-cr
        return (nx-ncx)**2+(ny-ncy)**2 <= cr**2
    return True

# ── カメラアイコン描画（正規化座標系） ─────────────────────────────────────
def draw_camera(nx, ny):
    """カメラ形状の判定: (WHITE, INDIGO, NONE) を返す"""
    if not rrect(nx, ny, 0.0, 0.0, 1.0, 1.0, 0.22): return 'none'
    body = rrect(nx, ny, 0.09, 0.24, 0.91, 0.83, 0.11)
    bump = rrect(nx, ny, 0.35, 0.12, 0.65, 0.25, 0.07)
    if body or bump:
        ld = math.sqrt((nx-0.5)**2 + (ny-0.56)**2)
        if ld < 0.055: return 'white'
        if ld < 0.145: return 'indigo'
        if ld < 0.235: return 'white'
        return 'white'
    return 'indigo'

# ── 共通背景グラデーション ────────────────────────────────────────────────────
def bg_color(nx, ny):
    """インディゴ系グラデーション (左上→右下)"""
    t = nx * 0.4 + ny * 0.6
    r = int(lerp(79,  50, t))
    g = int(lerp(70,  45, t))
    b = int(lerp(229, 180, t))
    return r, g, b

# ── デコレーション: 薄い円弧 ──────────────────────────────────────────────────
def circle_accent(nx, ny, cx, cy, r, thickness=0.008):
    d = math.sqrt((nx-cx)**2 + (ny-cy)**2)
    return abs(d - r) < thickness

# ── 小プロモーションタイル 440×280 ───────────────────────────────────────────
def small_pixel(x, y, w, h):
    nx, ny = x/w, y/h
    br, bg_, bb = bg_color(nx, ny)

    # 背景アクセント円弧
    if (circle_accent(nx, ny, 0.82, 0.18, 0.28, 0.006)
        or circle_accent(nx, ny, 0.82, 0.18, 0.38, 0.005)):
        return clamp(br+30), clamp(bg_+28), clamp(bb+40), 255

    # カメラアイコン（右側）: 正規化して配置
    icon_cx, icon_cy, icon_r = 0.72, 0.50, 0.30
    local_nx = (nx - (icon_cx - icon_r)) / (icon_r * 2)
    local_ny = (ny - (icon_cy - icon_r)) / (icon_r * 2)
    if 0 <= local_nx <= 1 and 0 <= local_ny <= 1:
        kind = draw_camera(local_nx, local_ny)
        if kind == 'white':
            return 255, 255, 255, 255
        if kind == 'indigo':
            return br, bg_, bb, 255

    # 左側: フィーチャードット (装飾)
    dots = [(0.12, 0.35), (0.12, 0.50), (0.12, 0.65)]
    for (dx, dy) in dots:
        if math.sqrt((nx-dx)**2 + (ny-dy)**2) < 0.012:
            return 165, 180, 252, 255  # indigo-300

    return br, bg_, bb, 255

# ── マーキープロモーションタイル 1400×560 ───────────────────────────────────
def marquee_pixel(x, y, w, h):
    nx, ny = x/w, y/h
    # アスペクト比補正して小タイルと同じ比率に近づける
    nx2 = nx  # そのまま使う
    br, bg_, bb = bg_color(nx2, ny)

    # 右上の大きな装飾円弧
    if (circle_accent(nx, ny, 0.88, 0.08, 0.35, 0.004)
        or circle_accent(nx, ny, 0.88, 0.08, 0.48, 0.003)
        or circle_accent(nx, ny, 0.12, 0.92, 0.32, 0.004)):
        return clamp(br+25), clamp(bg_+22), clamp(bb+35), 255

    # カメラアイコン右寄り
    icon_cx, icon_cy = 0.78, 0.50
    icon_r = 0.22   # w 比でのアイコン半径
    ar = h / w      # アスペクト比補正
    local_nx = (nx - (icon_cx - icon_r)) / (icon_r * 2)
    local_ny = (ny - (icon_cy - icon_r * (1/ar))) / (icon_r * 2 * (1/ar))
    if 0 <= local_nx <= 1 and 0 <= local_ny <= 1:
        kind = draw_camera(local_nx, local_ny)
        if kind == 'white':  return 255, 255, 255, 255
        if kind == 'indigo': return br, bg_, bb, 255

    # 左側フィーチャードット列（縦3段）
    features = [0.28, 0.50, 0.72]
    for fy in features:
        if math.sqrt((nx-0.07)**2 + (ny-fy)**2) < 0.008:
            return 165, 180, 252, 255
        # ドットから伸びる横線（細い）
        if abs(ny - fy) < 0.008 and 0.09 <= nx <= 0.42:
            alpha = int(40 * (1 - (nx - 0.09) / 0.33))
            return clamp(br+30), clamp(bg_+28), clamp(bb+40), max(0, alpha)

    return br, bg_, bb, 255

script_dir = os.path.dirname(os.path.abspath(__file__))

images = [
    ('promo_small.png',   440,  280,  small_pixel),
    ('promo_marquee.png', 1400, 560,  marquee_pixel),
]

for fname, w, h, fn in images:
    path = os.path.join(script_dir, fname)
    png = create_png(w, h, fn)
    with open(path, 'wb') as f:
        f.write(png)
    print(f'Created {path}  ({w}×{h}, {len(png):,} bytes)')

print('\n完了！')
print('※ テキスト（拡張機能名・機能説明）は画像編集ツールで追加してください。')
print('  推奨: Figma / Canva / Adobe XD でテキストを上乗せ')
