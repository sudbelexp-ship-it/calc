"""Подготовка скана к распознаванию.

  python prep.py <скан.pdf | папка с фото> <папка документа>     — нарезать страницы
  python prep.py --done <папка документа> <стр> [<стр> ...]        — отметить страницы распознанными
  python prep.py --status <папка документа>                        — показать, что осталось
"""
import sys, os, json, glob
from pathlib import Path
_runtime = Path(__file__).resolve().parent.parent / 'razmetka'
RES = None
if (_runtime / 'resources.py').exists():
    sys.path.insert(0, str(_runtime))
    import resources as RES
for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding='utf-8', errors='replace')   # консоль Windows по умолчанию не UTF-8
import numpy as np, cv2
if RES:
    RES.configure()

VIEW_W = 1500        # ширина половинки для чтения, px
OVERLAP = 0.10       # половинки перекрываются: верх 0–0,55, низ 0,45–1
IMG_EXT = ('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp')


def imread(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def imwrite(path, img, params=None):
    ok, buf = cv2.imencode(os.path.splitext(path)[1], img, params or [])
    if not ok:
        raise RuntimeError('не удалось сохранить ' + path)
    buf.tofile(path)


def pages_of(src):
    if os.path.isdir(src):
        files = sorted(f for f in glob.glob(os.path.join(src, '*')) if f.lower().endswith(IMG_EXT))
        if not files:
            sys.exit('В папке нет изображений: ' + src)
        for f in files:
            yield imread(f)
    elif src.lower().endswith('.pdf'):
        import pymupdf
        doc = pymupdf.open(src)
        for page in doc:
            if RES:
                RES.checkpoint()
                RES.check_pixels(page.rect.width * 300/72, page.rect.height * 300/72)
            pm = page.get_pixmap(dpi=300)
            yield cv2.imdecode(np.frombuffer(pm.tobytes('png'), np.uint8), cv2.IMREAD_COLOR)
    elif src.lower().endswith(IMG_EXT):
        yield imread(src)
    else:
        sys.exit('Нужен PDF, изображение или папка с изображениями: ' + src)


def prepare(src, out):
    for d in ('pages', 'view', 'img'):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    n = 0
    for img in pages_of(src):
        if img is None:
            continue
        n += 1
        h, w = img.shape[:2]
        imwrite(os.path.join(out, 'pages', f'p{n:03d}.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        cut = int(h * (0.5 + OVERLAP / 2)), int(h * (0.5 - OVERLAP / 2))
        for tag, part in (('a', img[:cut[0]]), ('b', img[cut[1]:])):
            k = min(1.0, VIEW_W / part.shape[1])
            if k < 1:
                part = cv2.resize(part, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
            imwrite(os.path.join(out, 'view', f'p{n:03d}_{tag}.jpg'), part, [cv2.IMWRITE_JPEG_QUALITY, 88])
    prog = os.path.join(out, 'progress.json')
    done = json.load(open(prog, encoding='utf-8')).get('done', []) if os.path.exists(prog) else []
    json.dump({'source': os.path.abspath(src), 'pages': n, 'done': done}, open(prog, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'Страниц: {n}. Папка: {out}. Читать: view/pNNN_a.jpg и view/pNNN_b.jpg')


def load(out):
    prog = os.path.join(out, 'progress.json')
    if not os.path.exists(prog):
        sys.exit('Нет progress.json — сначала запустите подготовку: ' + out)
    return prog, json.load(open(prog, encoding='utf-8'))


def status(out):
    _, p = load(out)
    left = [i for i in range(1, p['pages'] + 1) if i not in p['done']]
    print(f"Распознано {len(p['done'])} из {p['pages']}." + (f" Следующая: {left[0]}. Осталось: {len(left)}." if left else ' Всё готово.'))


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) >= 2 and a[0] == '--done':
        prog, p = load(a[1])
        p['done'] = sorted(set(p['done']) | {int(x) for x in a[2:]})
        json.dump(p, open(prog, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        status(a[1])
    elif len(a) == 2 and a[0] == '--status':
        status(a[1])
    elif len(a) == 2:
        prepare(a[0], a[1])
    else:
        sys.exit(__doc__)
