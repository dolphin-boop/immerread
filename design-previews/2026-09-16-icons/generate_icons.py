"""译读图标生成：同一柿红渐变圆角底，四套白色符号方案。

运行：uv run --with pillow python generate_icons.py
输出 design-previews/2026-09-16-icons/variant-*-{128,48}.png 预览，
--final NAME 时把该方案写入 icons/icon-{16,32,48,128}.png。
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 1024
MARGIN = 48
RADIUS = 224
TOP = (255, 106, 69)      # FF6A45
BOTTOM = (222, 61, 28)    # DE3D1C
LINE = (196, 47, 18)      # C42F12
CREAM = (255, 251, 244)

OUT = Path(__file__).parent
ROOT = OUT.parent.parent

PALETTES = {
    # 与 sidepanel --accent #a94f32 / 按钮 #b85f3f 完全同族
    "terracotta": ((184, 95, 63), (143, 64, 40), (116, 53, 33)),
    # 介于现亮红与陶土之间的砖红，工具栏更醒目
    "brick": ((198, 92, 58), (152, 58, 33), (128, 48, 27)),
    # 更深的焙茶色，最沉稳
    "roast": ((156, 71, 48), (110, 47, 29), (94, 40, 25)),
    # 改用 UI 中的灰绿 --success 系，差异化备选
    "moss": ((96, 130, 113), (63, 94, 78), (51, 78, 65)),
}


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def base_tile():
    grad = Image.new("RGB", (2, 2))
    grad.putpixel((0, 0), TOP)
    grad.putpixel((1, 0), lerp(TOP, BOTTOM, 0.5))
    grad.putpixel((0, 1), lerp(TOP, BOTTOM, 0.5))
    grad.putpixel((1, 1), BOTTOM)
    grad = grad.resize((S, S), Image.BICUBIC)

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [MARGIN, MARGIN, S - MARGIN, S - MARGIN], radius=RADIUS, fill=255)
    tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    tile.paste(grad, (0, 0), mask)

    glow_alpha = Image.new("L", (1, 64))
    for y in range(64):
        glow_alpha.putpixel((0, y), round(26 * (1 - y / 63)))
    glow_alpha = glow_alpha.resize((S - 2 * MARGIN, (S - 2 * MARGIN) // 2))
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    glow.paste(Image.new("RGBA", glow_alpha.size, (255, 255, 255, 255)),
               (MARGIN, MARGIN), glow_alpha)
    return Image.alpha_composite(tile, glow)


def layer():
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))


def bar(draw, x0, y, x1, w, fill):
    draw.rounded_rectangle([x0, y - w / 2, x1, y + w / 2], radius=w / 2, fill=fill)


def quad_bezier(p0, p1, p2, steps=28):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        pts.append((x, y))
    return pts


def icon_book():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    for mirror in (False, True):
        spine_x = 498 if not mirror else 526
        outer_x = 258 if not mirror else 766
        ctrl_x = 378 if not mirror else 646
        top = quad_bezier((spine_x, 430), (ctrl_x, 428), (outer_x, 378))
        bottom = quad_bezier((outer_x, 650), (ctrl_x, 704), (spine_x, 702))
        d.polygon(top + bottom, fill=CREAM)
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    for y in (480, 542, 604):
        bar(d, 320, y, 442, 26, LINE)
        bar(d, 582, y, 704, 26, LINE)
    return Image.alpha_composite(img, ov)


def icon_bubbles():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([272, 264, 600, 496], radius=56, fill=(255, 251, 244, 92))
    d.polygon([(336, 492), (408, 492), (352, 572)], fill=(255, 251, 244, 92))
    bar(d, 332, 344, 500, 26, (255, 251, 244, 205))
    bar(d, 332, 408, 448, 26, (255, 251, 244, 205))
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([440, 448, 752, 656], radius=56, fill=CREAM)
    d.polygon([(636, 652), (708, 652), (692, 732)], fill=CREAM)
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    bar(d, 494, 516, 606, 30, LINE)
    bar(d, 494, 588, 672, 30, LINE)
    return Image.alpha_composite(img, ov)


def icon_panel():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([224, 320, 480, 704], radius=40,
                        fill=(255, 251, 244, 54), outline=CREAM, width=16)
    bar(d, 268, 424, 428, 26, CREAM)
    bar(d, 268, 504, 404, 26, CREAM)
    bar(d, 268, 584, 356, 26, CREAM)
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([592, 320, 800, 704], radius=40, fill=CREAM)
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    bar(d, 636, 424, 756, 26, LINE)
    bar(d, 636, 504, 736, 26, LINE)
    bar(d, 636, 584, 692, 26, LINE)
    bar(d, 498, 512, 556, 24, CREAM)
    d.polygon([(542, 482), (542, 542), (594, 512)], fill=CREAM)
    return Image.alpha_composite(img, ov)


def arrowhead(d, tip, direction, size, fill):
    dx, dy = direction
    length = math.hypot(dx, dy)
    dx, dy = dx / length, dy / length
    px, py = -dy, dx
    bx, by = tip[0] - dx * size, tip[1] - dy * size
    d.polygon([tip,
               (bx + px * size * 0.62, by + py * size * 0.62),
               (bx - px * size * 0.62, by - py * size * 0.62)], fill=fill)


def icon_cycle():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    cx, cy, r, w = 512, 512, 196, 80
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, start=195, end=343, fill=CREAM, width=w)
    d.arc(box, start=15, end=163, fill=CREAM, width=w)
    for angle in (343, 163):
        rad = math.radians(angle)
        pos = (cx + r * math.cos(rad), cy + r * math.sin(rad))
        direction = (-math.sin(rad), math.cos(rad))
        arrowhead(d, (pos[0] + direction[0] * 26, pos[1] + direction[1] * 26),
                  direction, 118, CREAM)
    return Image.alpha_composite(img, ov)


def page_layer(width, height, radius, angle, center):
    page = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(page).rounded_rectangle([0, 0, width - 1, height - 1],
                                           radius=radius, fill=CREAM)
    rotated = page.rotate(angle, expand=True, resample=Image.BICUBIC)
    ov = layer()
    ov.paste(rotated, (round(center[0] - rotated.width / 2),
                       round(center[1] - rotated.height / 2)), rotated)
    return ov


def icon_simple_book():
    img = base_tile()
    img = Image.alpha_composite(img, page_layer(224, 336, 40, 13, (400, 512)))
    img = Image.alpha_composite(img, page_layer(224, 336, 40, -13, (624, 512)))
    return img


def icon_simple_bubble():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([296, 304, 728, 600], radius=72, fill=CREAM)
    d.polygon([(392, 592), (488, 592), (424, 704)], fill=CREAM)
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    bar(d, 384, 412, 576, 44, LINE)
    bar(d, 384, 504, 640, 44, LINE)
    return Image.alpha_composite(img, ov)


def icon_simple_swap():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    bar(d, 300, 420, 668, 60, CREAM)
    d.polygon([(616, 352), (616, 488), (756, 420)], fill=CREAM)
    bar(d, 356, 604, 724, 60, CREAM)
    d.polygon([(408, 536), (408, 672), (268, 604)], fill=CREAM)
    return Image.alpha_composite(img, ov)


def icon_a_wen():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    fa = ImageFont.truetype(f"{FONTS}/arialbd.ttf", 470)
    fz = ImageFont.truetype(f"{FONTS}/msyhbd.ttc", 430)
    d.text((368, 470), "A", font=fa, fill=CREAM, anchor="mm")
    d.text((672, 566), "文", font=fz, fill=CREAM, anchor="mm")
    return Image.alpha_composite(img, ov)


def sparkle(d, cx, cy, r, fill):
    pts = []
    for i in range(8):
        ang = math.pi / 4 * i - math.pi / 2
        rad = r if i % 2 == 0 else r * 0.28
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    d.polygon(pts, fill=fill)


def icon_spark_bubble():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    d.rounded_rectangle([232, 336, 752, 736], radius=84, fill=CREAM)
    d.polygon([(360, 728), (468, 728), (396, 836)], fill=CREAM)
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    bar(d, 330, 492, 580, 50, LINE)
    bar(d, 330, 596, 652, 50, LINE)
    sparkle(d, 792, 276, 104, CREAM)
    sparkle(d, 868, 388, 56, CREAM)
    return Image.alpha_composite(img, ov)


def icon_globe():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    cx, cy, r, w = 512, 512, 216, 52
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=CREAM, width=w)
    rx = 96
    d.ellipse([cx - rx, cy - r, cx + rx, cy + r], outline=CREAM, width=w)
    d.line([cx - r + 14, cy, cx + r - 14, cy], fill=CREAM, width=w)
    return Image.alpha_composite(img, ov)


def icon_zi_badge():
    img = base_tile()
    ov = layer()
    d = ImageDraw.Draw(ov)
    d.ellipse([256, 256, 768, 768], fill=CREAM)
    img = Image.alpha_composite(img, ov)
    ov = layer()
    d = ImageDraw.Draw(ov)
    font = ImageFont.truetype(f"{FONTS}/msyhbd.ttc", 380)
    d.text((512, 500), "译", font=font, fill=BOTTOM, anchor="mm")
    return Image.alpha_composite(img, ov)


def text_icon(font_path, weight=None, size=620, dy=0):
    def build():
        img = base_tile()
        ov = layer()
        d = ImageDraw.Draw(ov)
        font = ImageFont.truetype(font_path, size)
        if weight is not None:
            try:
                font.set_variation_by_axes([weight])
            except Exception:
                pass
        d.text((512, 520 + dy), "译", font=font, fill=CREAM, anchor="mm")
        return Image.alpha_composite(img, ov)
    return build


FONTS = "C:/Windows/Fonts"
VARIANTS = {
    "book": icon_book,
    "bubbles": icon_bubbles,
    "panel": icon_panel,
    "cycle": icon_cycle,
    "simple-book": icon_simple_book,
    "simple-bubble": icon_simple_bubble,
    "simple-swap": icon_simple_swap,
    "a-wen": icon_a_wen,
    "spark-bubble": icon_spark_bubble,
    "globe": icon_globe,
    "zi-badge": icon_zi_badge,
    "zi-kai": text_icon(f"{FONTS}/simkai.ttf"),
    "zi-song": text_icon(f"{FONTS}/simsun.ttc"),
    "zi-serif": text_icon(f"{FONTS}/NotoSerifSC-VF.ttf", weight=700),
    "zi-hei": text_icon(f"{FONTS}/msyhbd.ttc"),
}


def save(img, path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path)


def main():
    global TOP, BOTTOM, LINE
    if "--palette" in sys.argv:
        name = sys.argv[sys.argv.index("--palette") + 1]
        if name not in PALETTES:
            raise SystemExit(f"未知调色板：{name}")
        TOP, BOTTOM, LINE = PALETTES[name]
        img = icon_spark_bubble()
        for size in (128, 48, 16):
            save(img, OUT / f"variant-pal-{name}-{size}.png", size)
        print("调色板预览已写入", OUT, name)
        return
    final = None
    if "--final" in sys.argv:
        final = sys.argv[sys.argv.index("--final") + 1]
        if final not in VARIANTS:
            raise SystemExit(f"未知方案：{final}")
    for name, build in VARIANTS.items():
        img = build()
        save(img, OUT / f"variant-{name}-128.png", 128)
        save(img, OUT / f"variant-{name}-48.png", 48)
        save(img, OUT / f"variant-{name}-16.png", 16)
        if name == final:
            for size in (16, 32, 48, 128):
                save(img, ROOT / "icons" / f"icon-{size}.png", size)
    print("预览已写入", OUT)
    if final:
        print(f"正式图标（{final}）已写入 icons/")


if __name__ == "__main__":
    main()
