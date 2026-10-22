"""Вырезает руки Адама и Бога из фрагмента фрески Микеланджело (общественное достояние, см. CREDITS.md)
в PNG с прозрачностью. Запуск: python tools/splash/cut-hands.py <detail.jpg> <папка>; затем PNG → WebP (качество 88)."""
import sys

import numpy as np
from PIL import Image, ImageFilter

src, out_dir = sys.argv[1], sys.argv[2]
img = Image.open(src).convert("RGB")
im = np.asarray(img).astype(float)
R, G, B = im[..., 0], im[..., 1], im[..., 2]
# Теплота кожи против серой штукатурки; лёгкое размытие убирает шум трещин.
warm = np.asarray(Image.fromarray(np.clip(R - B, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(float)
mask = warm > 27


def dilate(a):
    b = a.copy()
    b[1:] |= a[:-1]; b[:-1] |= a[1:]; b[:, 1:] |= a[:, :-1]; b[:, :-1] |= a[:, 1:]
    return b


def erode(a):
    return ~dilate(~a)


def grow(seed, limit):
    """Морфологическая реконструкция: заливка от затравки внутри маски."""
    cur = seed & limit
    while True:
        nxt = dilate(cur) & limit
        if (nxt == cur).all():
            return cur
        cur = nxt


def fill_holes(a):
    border = np.zeros_like(a)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    outside = grow(border & ~a, ~a)
    return a | ~outside


h, w = mask.shape
# Отрезаем лишнее: колено Адама (низ слева) и красную ткань справа.
limit_adam = mask.copy()
limit_adam[560:, :] = False
limit_adam[:, 700:] = False
limit_god = mask.copy()
limit_god[:, :660] = False
limit_god[600:, :] = False
limit_god[440:, 1350:] = False
# Трещина фрески по краю ладони Бога: здесь кожа светлее, порог мягче.
soft = (warm > 18)
limit_god[285:350, 900:1040] |= soft[285:350, 900:1040]

seed = np.zeros_like(mask)
seed_adam = seed.copy(); seed_adam[380:420, 0:30] = True
seed_god = seed.copy(); seed_god[260:300, 1370:1400] = True

for name, s, lim, box in (("hand-adam", seed_adam, limit_adam, (0, 230, 680, 520)),
                          ("hand-god", seed_god, limit_god, (660, 190, 1400, 600))):
    m = grow(s, lim)
    # Закрытие: светлые блики кожи по цвету близки к штукатурке — заделываем щербины края.
    k = 7 if name == "hand-god" else 3
    for _ in range(k):
        m = dilate(m)
    for _ in range(k):
        m = erode(m)
    m = fill_holes(m)
    # Срезаем «бахрому» штукатурки и сглаживаем край.
    m = dilate(erode(erode(m)))
    alpha = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    a = np.asarray(alpha).astype(float)
    x0, y0, x1, y1 = box
    a = a[y0:y1, x0:x1]
    # Плечо уходит за край экрана — гасим 15 % ширины у внешнего края.
    ww = x1 - x0
    ramp = np.ones(ww)
    n = int(ww * 0.3)
    if name == "hand-adam":
        ramp[:n] = np.linspace(0, 1, n) ** 1.6
    else:
        ramp[-n:] = np.linspace(1, 0, n) ** 1.6
    a = a * ramp[None, :]
    rgb = im[y0:y1, x0:x1]
    rgba = np.dstack([rgb, a]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(f"{out_dir}/{name}.png", optimize=True)
    print(name, rgba.shape, "покрытие", round(float((a > 128).mean()), 3))
