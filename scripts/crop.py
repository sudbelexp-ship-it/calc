"""Вырезка фрагмента страницы в img/.

  python crop.py <папка документа> <стр> <x0> <y0> <x1> <y1> <имя>

Координаты — доли страницы 0..1 (левый верхний угол — 0 0). Пример:
  python crop.py normy/SP_15.13330.2020 45 0.08 0.31 0.92 0.47 formula_7.1   →  img/p045_formula_7.1.png
"""
import sys, os
for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding='utf-8', errors='replace')   # консоль Windows по умолчанию не UTF-8
import numpy as np, cv2

MAX_SIDE = 3000   # крупнее не сохраняем: вырезку всё равно читают уменьшенной

if __name__ == '__main__':
    if len(sys.argv) != 8:
        sys.exit(__doc__)
    out, page, name = sys.argv[1], int(sys.argv[2]), sys.argv[7]
    try:
        x0, y0, x1, y1 = (float(v.replace(',', '.')) for v in sys.argv[3:7])
    except ValueError:
        sys.exit('Координаты должны быть числами от 0 до 1')
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        sys.exit('Нужно 0 ≤ x0 < x1 ≤ 1 и 0 ≤ y0 < y1 ≤ 1')
    src = os.path.join(out, 'pages', f'p{page:03d}.jpg')
    if not os.path.exists(src):
        sys.exit('Нет страницы: ' + src)
    img = cv2.imdecode(np.fromfile(src, dtype=np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    part = img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
    k = min(1.0, MAX_SIDE / max(part.shape[:2]))
    if k < 1:
        part = cv2.resize(part, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    os.makedirs(os.path.join(out, 'img'), exist_ok=True)
    rel = f'img/p{page:03d}_{name}.png'
    ok, buf = cv2.imencode('.png', cv2.cvtColor(part, cv2.COLOR_BGR2GRAY))
    buf.tofile(os.path.join(out, rel))
    print(f'{rel}  ({part.shape[1]}×{part.shape[0]} px) — откройте и проверьте, что ничего не обрезано')
