"""Локальный движок разметки нормативных документов: страницы → слова (текстовый слой или OCR) → таблицы, рисунки, формулы → Markdown.

Работает как навык ocr-normy: та же папка normy/<обозначение>/ (pages, view, img, progress.json, document.md),
те же скрипты prep.py / crop.py / check.py / relcheck.py. Интернет не нужен.
"""
import os, re, sys, json, subprocess, datetime, shutil, threading, html as _html
from pathlib import Path
import numpy as np
import cv2
import pymupdf as fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ocr as OCR
import tables as TB
import lexicon as LEX
import cells as CELLS
import layout as LAYOUT
from numeric import values as numeric_values, mark_word
from strict_review import mark_numbers
from table_data import shape as table_shape, caption_id
import logging

logging.basicConfig(filename=str(Path(__file__).resolve().parent / 'razmetka.log'), level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', encoding='utf-8')
LOG = logging.getLogger('razmetka')

ROOT = Path(os.environ.get('RZ_ROOT') or Path(__file__).resolve().parent.parent)
NORMY = ROOT / 'normy'
SCRIPTS = ROOT / 'scripts'
MARK = '<!-- razmetka:auto -->'
SCALE = 300 / 72
VIEW_W = 1500
OVERLAP = 0.10


def imread(p, flag=cv2.IMREAD_COLOR):
    return cv2.imdecode(np.fromfile(str(p), dtype=np.uint8), flag)


def imwrite(p, img, params=None):
    ok, buf = cv2.imencode(Path(p).suffix, img, params or [])
    buf.tofile(str(p))


def safe_name(name):
    name = re.sub(r'[^A-Za-z0-9._\-]+', '_', name).strip('._')
    if not name:
        raise ValueError('пустое имя документа')
    return name


def docdir(name):
    return NORMY / safe_name(name)


def load_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding='utf-8'))
    except Exception:
        return default


def save_json(p, obj):
    import tempfile
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=p.parent, suffix='.tmp', delete=False) as f:
            tmp = Path(f.name)
            json.dump(obj, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def run_script(script, *args, timeout=900):
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    r = subprocess.run([sys.executable, '-W', 'ignore', str(SCRIPTS / script), *map(str, args)], capture_output=True, text=True, encoding='utf-8', errors='replace', env=env, timeout=timeout)
    return (r.stdout + r.stderr).strip(), r.returncode


# ---------------------------------------------------------------- документы

def list_docs():
    out = []
    if not NORMY.exists():
        return out
    for d in sorted(NORMY.iterdir()):
        pr = load_json(d / 'progress.json')
        if not pr:
            continue
        out.append({'name': d.name, 'pages': pr.get('pages', 0), 'done': len(pr.get('done', [])),
                    'reviewed': len(list((d / 'pages_md').glob('*.reviewed'))), 'md': (d / 'document.md').exists(), 'auto': len(list((d / 'auto').glob('p*.json'))) if (d / 'auto').exists() else 0})
    return out


@OCR.RES.worker()
def prep(src, name):
    if not str(src).lower().endswith('.pdf'):
        raise ValueError('Фото с искажением не поддерживается, нужен скан в PDF. Сначала выровняйте перспективу и тени.')
    d = docdir(name)
    out, code = run_script('prep.py', src, d)
    if code:
        raise RuntimeError(out)
    meta = {'source': str(src), 'kind': 'pdf' if str(src).lower().endswith('.pdf') else 'images'}
    save_json(d / 'meta.json', meta)
    return out


def doc_info(name):
    d = docdir(name)
    pr = load_json(d / 'progress.json') or {}
    meta = load_json(d / 'meta.json') or {'source': pr.get('source', ''), 'kind': 'pdf'}
    pages = []
    for n in range(1, pr.get('pages', 0) + 1):
        a = load_json(d / 'auto' / f'p{n:03d}.json')
        pages.append({'n': n, 'done': n in pr.get('done', []), 'auto': bool(a), 'source': a.get('source') if a else None,
                      'tables': len(a['tables']) if a else 0, 'figures': len(a['figures']) if a else 0, 'doubts': a.get('doubts', 0) if a else 0,
                      'reviewed': (d / 'pages_md' / f'p{n:03d}.reviewed').exists(), 'manual': (d / 'pages_md' / f'p{n:03d}.manual').exists()})
    return {'name': d.name, 'source': meta.get('source'), 'head': meta.get('head', {}), 'pages': pages, 'md': (d / 'document.md').exists()}


# ---------------------------------------------------------------- картинки страниц

def make_views(d, n, img):
    h, w = img.shape[:2]
    cut = int(h * (0.5 + OVERLAP / 2)), int(h * (0.5 - OVERLAP / 2))
    for tag, part in (('a', img[:cut[0]]), ('b', img[cut[1]:])):
        k = min(1.0, VIEW_W / part.shape[1])
        if k < 1:
            part = cv2.resize(part, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
        imwrite(d / 'view' / f'p{n:03d}_{tag}.jpg', part, [cv2.IMWRITE_JPEG_QUALITY, 88])


def save_page_image(d, n, img):
    imwrite(d / 'pages' / f'p{n:03d}.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    make_views(d, n, img)


# ---------------------------------------------------------------- слова

ALLOWED = re.compile(r'[A-Za-zА-Яа-яЁё0-9\s.,;:!?()\[\]{}«»"\'№%°±×·/\\*+=<>≤≥≈≠_^\-–—−…&§αβγδεζηθικλμνξπρστυφχψωΑΓΔΘΛΞΠΣΦΨΩ′″∑√∫∞∂∆]')


def layer_ok(words):
    text = ' '.join(w['t'] for w in words)
    if len(text.replace(' ', '')) < 40:
        return False
    bad = sum(1 for ch in text if not ALLOWED.match(ch))
    if bad / max(1, len(text)) > 0.03:
        return False
    letters = [ch for ch in text if ch.isalpha()]
    cyr = sum(1 for ch in letters if 'А' <= ch <= 'я' or ch in 'Ёё')
    if letters and cyr / len(letters) < 0.35 and len(letters) > 80:
        return False
    toks = [t for t in text.split() if len(t) > 3 and t.isalpha()]
    mixed = sum(1 for t in toks if re.search('[А-Яа-яЁё]', t) and re.search('[A-Za-z]', t))
    if toks and mixed / len(toks) > 0.10:
        return False
    return True


def layer_kind(page, d):
    """Признаки чужого (от старого распознавания) слоя: невидимый текст, шрифт GlyphLess, картинка на всю страницу."""
    why = []
    fonts = {sp['font'].lower() for b in d['blocks'] if b.get('type') == 0 for l in b['lines'] for sp in l['spans']}
    if any('glyphless' in f or 'invisible' in f for f in fonts):
        why.append('шрифт GlyphLess')
    try:
        tr = page.get_texttrace()
        tot = sum(len(sp.get('chars', ())) for sp in tr)
        inv = sum(len(sp.get('chars', ())) for sp in tr if sp.get('type') == 3)
        if tot and inv / tot > 0.5:
            why.append('невидимый текст')
    except Exception:
        pass
    try:
        area = page.rect.get_area()
        for im in page.get_image_info():
            if fitz.Rect(im['bbox']).get_area() >= 0.75 * area:
                why.append('картинка на всю страницу')
                break
    except Exception:
        pass
    return why


def text_words(pdf, n):
    """Слова текстового слоя с настоящими рамками (get_text('words')) в пикселях страницы 300 dpi.
    Размер и начертание берутся из span'ов, в которые попадает слово. Возвращает (слова, картинка, поворот, признаки чужого слоя)."""
    doc = fitz.open(pdf)
    page = doc[n - 1]
    d = page.get_text('dict')
    votes = {}
    for b in d['blocks']:
        if b.get('type') != 0:
            continue
        for l in b['lines']:
            dx, dy = l['dir']
            key = (round(dx), round(dy))
            votes[key] = votes.get(key, 0) + sum(len(sp['text']) for sp in l['spans'])
    why = layer_kind(page, d)
    extra = 0
    if votes:
        k = max(votes, key=votes.get)
        extra = {(0, -1): 90, (0, 1): 270, (-1, 0): 180}.get(k, 0)
    if extra:
        page.set_rotation((page.rotation + extra) % 360)
        d = page.get_text('dict')
    raw = page.get_text('rawdict')
    mat = page.rotation_matrix * fitz.Matrix(SCALE, SCALE)
    spans = {}
    for b in raw['blocks']:
        if b.get('type') != 0:
            continue
        for l in b['lines']:
            for sp in l['spans']:
                r = fitz.Rect(sp['bbox'])
                rec = (r, sp['size'], bool(sp['flags'] & 16) or 'bold' in sp['font'].lower(), bool(sp['flags'] & 2))
                for k in range(int(r.y0 // 12), int(r.y1 // 12) + 1):
                    spans.setdefault(k, []).append(rec)
    words = []
    for x0, y0, x1, y1, t, bn, ln, wn in page.get_text('words'):
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        info = None
        for rec in spans.get(int(cy // 12), ()):
            if rec[0].x0 - 1 <= cx <= rec[0].x1 + 1 and rec[0].y0 - 1 <= cy <= rec[0].y1 + 1:
                info = rec
                break
        r = fitz.Rect(x0, y0, x1, y1) * mat
        r.normalize()
        words.append({'t': t, 'x0': r.x0, 'y0': r.y0, 'x1': r.x1, 'y1': r.y1, 'c': 1.0,
                      'size': (info[1] if info else (y1 - y0) * 0.85) * SCALE, 'bold': bool(info and info[2]), 'it': bool(info and info[3])})
    OCR.RES.check_pixels(page.rect.width * SCALE, page.rect.height * SCALE)
    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE))
    img = cv2.cvtColor(np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3], cv2.COLOR_RGB2BGR)
    return words, img, extra, why


# ---------------------------------------------------------------- рисунки

def find_figures(img, words, tbls):
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ink = (gray < 190).astype(np.uint8) * 255
    for t in tbls:
        x0, y0, x1, y1 = map(int, t['bbox'])
        cv2.rectangle(ink, (x0 - 4, y0 - 4), (x1 + 4, y1 + 4), 0, -1)
    longw = [w for w in words if len(w['t']) > 2 and not re.fullmatch(r'[\d.,]+', w['t'])]
    for w in longw:
        cv2.rectangle(ink, (int(w['x0']) - 3, int(w['y0']) - 3), (int(w['x1']) + 3, int(w['y1']) + 3), 0, -1)
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (45, 45)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    figs = []
    for i in range(1, n):
        x, y, w_, h_, a = st[i]
        if w_ < 220 or h_ < 200 or w_ * h_ > 0.85 * W * H:
            continue
        dens = (ink[y:y + h_, x:x + w_] > 0).mean()
        if dens < 0.01:
            continue
        figs.append([x, y, x + w_, y + h_])
    # добавить мелкие подписи-метки (буквы, размеры) рядом
    for f in figs:
        for w in words:
            if len(w['t']) <= 4 or re.fullmatch(r'[\d.,]+', w['t']):
                cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
                if f[0] - 70 <= cx <= f[2] + 70 and f[1] - 70 <= cy <= f[3] + 70:
                    f[0] = min(f[0], int(w['x0'])); f[1] = min(f[1], int(w['y0'])); f[2] = max(f[2], int(w['x1'])); f[3] = max(f[3], int(w['y1']))
    # слить пересекающиеся
    merged = True
    while merged:
        merged = False
        for i in range(len(figs)):
            for j in range(i + 1, len(figs)):
                a, b = figs[i], figs[j]
                if a[0] < b[2] + 30 and b[0] < a[2] + 30 and a[1] < b[3] + 30 and b[1] < a[3] + 30:
                    figs[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    figs.pop(j)
                    merged = True
                    break
            if merged:
                break
    return [tuple(int(v) for v in f) for f in sorted(figs, key=lambda f: f[1])]


# ---------------------------------------------------------------- извлечение страницы

def _center_in(w, box):
    cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
    return box[0] - 2 <= cx <= box[2] + 2 and box[1] - 2 <= cy <= box[3] + 2


def content_table(table):
    """Grid-like line drawings with no readable cell content are retained as figures."""
    words = [w for c in table['cells'] for w in c['words']]
    numeric = sum(bool(re.search(r'\d', w['t'])) for w in words)
    text = sum(len(re.findall(r'[A-Za-zА-Яа-яЁё]', w['t'])) >= 3 for w in words)
    return numeric >= 2 or text >= 2


NUMTOK = re.compile(r'^[+\-−–±]?\d+(?:[.,]\d+)?\*?$')


def _nums_in(t):
    return numeric_values(t)


def crosscheck(words, img, tbls, strict=False, skip=()):
    """Второе мнение: OCR страницы. Число слоя НИКОГДА не меняется молча:
    - число слоя и число OCR расходятся → слово получает сомнение, оба варианта пишутся в alt;
    - слой испорчен (не число), а OCR прочёл число → берём OCR, но с сомнением (alt — вариант слоя);
    - strict (чужой слой): число, которого OCR не подтвердил, тоже получает сомнение.
    Возвращает {'checked', 'confirmed', 'flagged', 'fixed', 'unverified'}."""
    ow = OCR.ocr_words(img)
    buckets = {}
    for o in ow:
        buckets.setdefault(int((o['y0'] + o['y1']) / 2 // 60), []).append(o)
    st = {'checked': 0, 'confirmed': 0, 'flagged': 0, 'fixed': 0, 'unverified': 0}
    for w in words:
        t = w['t']
        if not re.search(r'\d', t):
            continue
        if any(_center_in(w, b) for b in skip):
            continue
        st['checked'] += 1
        cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
        best, bd = None, 1e9
        for k in (int(cy // 60) - 1, int(cy // 60), int(cy // 60) + 1):
            for o in buckets.get(k, ()):
                ox, oy = (o['x0'] + o['x1']) / 2, (o['y0'] + o['y1']) / 2
                inside = o['x0'] - 3 <= cx <= o['x1'] + 3 and o['y0'] - 3 <= cy <= o['y1'] + 3
                inside2 = w['x0'] - 3 <= ox <= w['x1'] + 3 and w['y0'] - 3 <= oy <= w['y1'] + 3
                if inside or inside2:
                    dd = abs(ox - cx)
                    if dd < bd:
                        best, bd = o, dd
        mine = _nums_in(t)
        if not best or best['c'] < 0.6:
            st['unverified'] += 1
            if strict:
                w['c'] = min(w['c'], 0.7)
            continue
        ot = best['t']
        theirs = _nums_in(ot)
        if NUMTOK.match(t):
            if mine[0] in theirs:
                st['confirmed'] += 1
            elif NUMTOK.match(ot):
                w['alt'] = ot
                w['c'] = 0.5
                st['flagged'] += 1
            else:
                st['unverified'] += 1
                if strict:
                    w['c'] = min(w['c'], 0.7)
        else:
            if len(theirs) == 1 and NUMTOK.match(ot):
                w['alt'] = t
                w['t'] = ot
                w['c'] = 0.6
                st['fixed'] += 1
            else:
                w['c'] = min(w['c'], 0.6)
                st['flagged'] += 1
    return st


def uncovered_ratio(img, words, tbls):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ink = (gray < 170).astype(np.uint8)
    total = int(ink.sum())
    if total < 2000:
        return 0.0, None
    cov = np.zeros_like(ink)
    for w in words:
        cv2.rectangle(cov, (int(w['x0']) - 6, int(w['y0']) - 6), (int(w['x1']) + 6, int(w['y1']) + 6), 1, -1)
    for t in tbls:
        x0, y0, x1, y1 = t['bbox']
        cv2.rectangle(cov, (x0 - 4, y0 - 4), (x1 + 4, y1 + 4), 1, -1)
    rest = ink * (1 - cov)
    return float(rest.sum()) / total, cov


def merge_ocr(words, img, tbls, cov):
    clean = TB.erase_lines(img, tbls) if tbls else img
    add = 0
    for o in OCR.ocr_words(clean):
        cx, cy = int((o['x0'] + o['x1']) / 2), int((o['y0'] + o['y1']) / 2)
        if 0 <= cy < cov.shape[0] and 0 <= cx < cov.shape[1] and cov[cy, cx]:
            continue
        o['size'] = (o['y1'] - o['y0']) * 0.85
        o['bold'] = False
        o['it'] = False
        words.append(o)
        add += 1
    return add


def split_at_lines(words, tbls):
    """Слова OCR, склеившиеся через вертикальную линию сетки, режем по линии (по числу символов)."""
    out = []
    for w in words:
        parts = [w]
        for t in tbls:
            x0, y0, x1, y1 = t['bbox']
            cy = (w['y0'] + w['y1']) / 2
            if not (y0 - 3 <= cy <= y1 + 3) or len(w['t']) < 3:
                continue
            for xl in t['xs'][1:-1]:
                nxt = []
                for p in parts:
                    if p['x0'] + 6 < xl < p['x1'] - 6 and len(p['t']) >= 3:
                        L = len(p['t'])
                        frac = (xl - p['x0']) / max(1.0, p['x1'] - p['x0'])
                        idx = int(round(L * frac))
                        best = None
                        for k in range(max(1, idx - 2), min(L - 1, idx + 2) + 1):
                            if p['t'][k - 1].isdigit() and p['t'][k].isdigit() or (p['t'][k - 1].isdigit() and p['t'][k] in '+-−–'):
                                if best is None or abs(k - idx) < abs(best - idx):
                                    best = k
                        if best is None:
                            nxt.append(p)
                            continue
                        w0 = p['x0'] + (p['x1'] - p['x0']) * best / L
                        a_ = dict(p, t=p['t'][:best], x1=w0)
                        b_ = dict(p, t=p['t'][best:], x0=w0)
                        nxt += [a_, b_]
                    else:
                        nxt.append(p)
                parts = nxt
        out += parts
    return out


@OCR.RES.worker()
def extract(name, n, mode='auto'):
    """mode: auto | text | ocr | precise. Результат: auto/pNNN.json."""
    OCR.RES.checkpoint()
    d = docdir(name)
    meta = load_json(d / 'meta.json') or {}
    pdf = meta.get('source') if meta.get('kind') == 'pdf' else None
    img = imread(d / 'pages' / f'p{n:03d}.jpg')
    if mode == 'precise' and pdf:
        with fitz.open(pdf) as pd:
            OCR.RES.check_pixels(pd[n-1].rect.width * 400/72, pd[n-1].rect.height * 400/72)
            pix = pd[n - 1].get_pixmap(dpi=400)
            img = cv2.cvtColor(np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3], cv2.COLOR_RGB2BGR)
    OCR.set_precise(mode == 'precise')
    source, words = None, None
    foreign, layer_error = [], None
    if pdf and Path(pdf).exists() and mode in ('auto', 'text'):
        try:
            tw, timg, extra, foreign = text_words(pdf, n)
            if tw and (layer_ok(tw) or mode == 'text'):
                words, img = tw, timg
                source = 'layer-ocr' if foreign else 'text'
        except Exception as e:
            words = None
            layer_error = f'{type(e).__name__}: {e}'
            LOG.exception('текстовый слой %s стр. %s не прочитан', name, n)
    vote = None
    if words is None:
        ang = OCR.best_rotation(img)
        if ang:
            img = OCR.rotate(img, ang)
        img, skew, M = CELLS.deskew(img)
        save_page_image(d, n, img)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        tbls = TB.find_tables(gray)
        words = LEX.fix_words(OCR.ocr_words(img))
        source = 'ocr'
        if tbls:
            words = split_at_lines(words, tbls)
    else:
        img, skew, M = CELLS.deskew(img)
        if M is not None:
            CELLS.transform_words(words, M)
        save_page_image(d, n, img)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        tbls = TB.find_tables(gray)
    verify = {}
    if source in ('text', 'layer-ocr') and mode == 'auto':
        ratio, cov = uncovered_ratio(img, words, tbls)
        if ratio > 0.10 and cov is not None:
            verify['merge'] = merge_ocr(words, img, tbls, cov)
            source = source + '+ocr'
    H, W = img.shape[:2]
    for w in words:
        w.setdefault('size', (w['y1'] - w['y0']) * 0.85)
        w.setdefault('bold', False)
        w.setdefault('it', False)
    # A grid may contain only the header; recover the aligned unruled numeric body.
    tbls = LAYOUT.aligned_fragments(tbls, words, gray)
    CELLS.extend_header_tables(tbls, words, H)
    for t in tbls:
        LAYOUT.normalize(t, words)
    # --- таблицы: каждая ячейка распознаётся отдельно (только распознаватель строк)
    cw = {}
    cstat = {'cells': 0, 'agree': 0, 'flagged': 0, 'unverified': 0}
    use_cells = bool(tbls) and (source.startswith('ocr') or (source.startswith('layer-ocr') and mode == 'auto'))
    if use_cells:
        clean = TB.erase_lines(img, tbls)
        for ti, t in enumerate(tbls):
            co = CELLS.cell_ocr(clean, t)
            for c in t['cells']:
                page_ws = [w for w in words if _center_in(w, c['bbox'])]
                rec_ws = co.get((c['r'], c['c']), [])
                cstat['cells'] += 1
                if source.startswith('ocr'):
                    if rec_ws:
                        primary, other = rec_ws, page_ws
                    else:
                        primary, other = page_ws, []
                        for w in primary:
                            if re.search(r'\d', w['t']):
                                w['c'] = min(w['c'], 0.5)
                                cstat['unverified'] += 1
                else:
                    primary, other = page_ws, rec_ws
                if primary and other:
                    ok, fl, un = CELLS.compare_cell(primary, other)
                    cstat['agree'] += ok
                    cstat['flagged'] += fl
                    cstat['unverified'] += un
                elif primary and any(re.search(r'\d', w['t']) for w in primary) and source.startswith('layer-ocr'):
                    for w in primary:
                        if re.search(r'\d', w['t']):
                            w['c'] = min(w['c'], 0.6)
                    cstat['unverified'] += 1
                cw[(ti, c['r'], c['c'])] = primary
    # --- числа вне таблиц: чужой слой сверяем целиком; родной (векторный) — выборочно
    if source.startswith('layer-ocr') and mode == 'auto':
        verify.update(crosscheck(words, img, tbls, strict=True, skip=[t['bbox'] for t in tbls]))
    elif source == 'text' and mode == 'auto' and sum(1 for w in words if re.search(r'\d', w['t'])) > 30:
        verify.update(crosscheck(words, img, tbls, strict=False))
    if mode == 'precise':
        vote = OCR.vote_numbers(img, words)
        for ws in cw.values():
            for w in ws:
                if re.search(r'\d', w['t']):
                    w['c'] = min(w['c'], .5)
                    w.setdefault('reasons', []).append('precise cell requires visual confirmation')
        verify['vote'] = vote
    verify['cells'] = cstat
    figs = find_figures(img, words, tbls)
    keepf = []
    for f in figs:
        txt = [w for w in words if _center_in(w, f) and len(re.findall('[А-Яа-яЁё]', w['t'])) >= 3]
        if len(txt) < 4:
            keepf.append(f)
    figs = keepf
    rich = [False] * len(figs)
    out_tables = []
    for ti, t in enumerate(tbls):
        cells = []
        for c in t['cells']:
            ws = cw.get((ti, c['r'], c['c']))
            if ws is None:
                ws = [w for w in words if _center_in(w, c['bbox'])]
            cells.append({'r': c['r'], 'c': c['c'], 'rs': c['rs'], 'cs': c['cs'], 'bbox': [int(v) for v in c['bbox']], 'words': ws})
        out_tables.append({'bbox': list(t['bbox']), 'nr': len(t['ys']) - 1, 'nc': len(t['xs']) - 1, 'ys': [float(v) for v in t['ys']], 'xs': [float(v) for v in t['xs']], 'cells': cells, **({'header_rows': t['header_rows']} if 'header_rows' in t else {})})
    rejected = [t['bbox'] for t in out_tables if not content_table(t)]
    figs.extend(rejected)
    rich.extend([False] * len(rejected))
    out_tables = [t for t in out_tables if content_table(t)]
    save_json(d / 'auto' / f'p{n:03d}.json', {'page': n, 'source': source, 'w': W, 'h': H, 'words': words, 'tables': out_tables, 'figures': [list(f) for f in figs],
                                              'fig_rich': rich, 'verify': verify, 'skew': round(skew, 3), 'dpi': 400 if mode == 'precise' else 300, 'foreign_layer': foreign, 'layer_error': layer_error})
    a = load_json(d / 'auto' / f'p{n:03d}.json')
    a['numeric_review_policy'] = 'all automatic numbers require visual review'
    save_json(d / 'auto' / f'p{n:03d}.json', a)
    return source


# ---------------------------------------------------------------- строки и абзацы

NUMPAT = re.compile(r'^(\d+(?:\.\d+){0,5}\*?|[А-ЯA-Z]\.\d+(?:\.\d+)*)\s+\S')
LISTPAT = re.compile(r'^([а-яa-z]\)|\d+\)|[-—–•])\s')
DEFPAT = re.compile(r'^[A-Za-zА-Яа-яα-ωΑ-Ω][\w,.\'_^{}]{0,14}\s+[—–-]\s+\S')
FORMPAT = re.compile(r'\(\s*([A-ZА-Я]?\.?\d+(?:\.\d+)*)\s*\)\s*$')
MATHCH = re.compile(r'[=≤≥<>≈∑√∫±]|\bsin\b|\bcos\b')


SPACED = re.compile(r'(?<![\w\[])(?:[A-Za-zА-Яа-яЁё] ){3,}[A-Za-zА-Яа-яЁё](?![\w\]])')


def _collapse(t):
    return SPACED.sub(lambda m: m.group().replace(' ', ''), t)


def build_lines(words):
    ws = sorted(words, key=lambda w: (w['y0'] + w['y1']) / 2)
    lines = []
    for w in ws:
        cy = (w['y0'] + w['y1']) / 2
        h = w['y1'] - w['y0']
        placed = False
        for ln in reversed(lines[-6:]):
            ov = min(ln['y1'], w['y1']) - max(ln['y0'], w['y0'])
            if ov > 0.55 * min(ln['y1'] - ln['y0'], h) and abs(cy - ln['cy']) < 0.42 * min(ln['y1'] - ln['y0'], h) + 3:
                ln['w'].append(w)
                ln['y0'] = min(ln['y0'], w['y0']); ln['y1'] = max(ln['y1'], w['y1'])
                ln['cy'] = (ln['y0'] + ln['y1']) / 2
                placed = True
                break
        if not placed:
            lines.append({'w': [w], 'y0': w['y0'], 'y1': w['y1'], 'cy': cy})
    out = []
    for ln in sorted(lines, key=lambda l: l['cy']):
        wl = sorted(ln['w'], key=lambda w: w['x0'])
        sizes = [w['size'] for w in wl]
        main = max(sizes)
        base = np.median([(w['y0'] + w['y1']) / 2 for w in wl if w['size'] >= 0.85 * main] or [ln['cy']])
        parts, prev = [], None
        low = 0
        for w in wl:
            t = w['t']
            if w['c'] < (0.85 if re.search(r'\d', t) else 0.70):
                t_doubt = True
            else:
                t_doubt = False
            if re.search('[А-Яа-яЁё]', t) and re.search('[A-Za-z]', t) and len(t) > 2 and w['c'] < 1.0:
                t_doubt = True
            if re.search('[А-Яа-яЁё]', t) and re.search('[A-Za-z]', t) and len(t) > 3 and w['c'] == 1.0 and not re.search(r'[\d\-_/]', t):
                t_doubt = True
            if w['size'] < 0.8 * main and w['c'] == 1.0:
                cyw = (w['y0'] + w['y1']) / 2
                t = ('_' if cyw > base else '^') + (t if len(t) == 1 else '{' + t + '}')
            if t_doubt:
                t = '[?' + t + ']'
                low += 1
            if prev is not None:
                gap = w['x0'] - prev['x1']
                sub = t.startswith('_') or t.startswith('^')
                if gap > 0.18 * (ln['y1'] - ln['y0']) and not sub:
                    parts.append(' ')
            parts.append(t)
            prev = w
        text = _collapse(''.join(parts))
        out.append({'text': text, 'x0': wl[0]['x0'], 'x1': max(w['x1'] for w in wl), 'y0': ln['y0'], 'y1': ln['y1'], 'h': np.median([w['y1'] - w['y0'] for w in wl]),
                    'size': main, 'bold': sum(w['bold'] for w in wl) > len(wl) / 2, 'doubts': low, 'words': wl})
    return out


def compute_hf(name, pages):
    d = docdir(name)
    cnt = {}
    for n in pages:
        a = load_json(d / 'auto' / f'p{n:03d}.json')
        if not a:
            continue
        for ln in build_lines([w for w in a['words']]):
            if ln['y1'] < 0.075 * a['h'] or ln['y0'] > 0.925 * a['h']:
                key = re.sub(r'\d+', '#', ln['text'].lower().replace('[?', '').replace(']', '')).strip()
                if key and not re.fullmatch(r'[#ivxl\s.-]*', key):
                    cnt[key] = cnt.get(key, 0) + 1
    need = max(3, int(0.25 * len(pages)))
    hf = [k for k, v in cnt.items() if v >= need]
    save_json(d / 'hf.json', hf)
    return hf


def _norm_hf(text):
    return re.sub(r'\d+', '#', text.lower().replace('[?', '').replace(']', '')).strip()


# ---------------------------------------------------------------- таблица → md/html

NUMCELL = re.compile(r'^[\d\s.,±+\-–—−*/()%]+$')


def _lines_text(lines):
    parts = []
    for ln in lines:
        t = ln['text']
        if parts and parts[-1].endswith('-') and t[:1].islower():
            parts[-1] = parts[-1][:-1] + t
        else:
            parts.append(t)
    if len(parts) > 1 and all(NUMCELL.match(re.sub(r'\[\?|\]', '', p)) for p in parts):
        return '\n'.join(parts).strip()
    return ' '.join(parts).strip()


def cell_text(words):
    return _lines_text(build_lines(words)) if words else ''


def _isnum_text(t):
    t = re.sub(r'\[\?|\]', '', t).replace('\n', ' ').strip()
    return bool(t) and bool(NUMCELL.match(t))


def _numline(ln):
    return bool(NUMCELL.match(re.sub(r'\[\?|\]', '', ln['text']).strip()))


def html_shape(html):
    """Строки данных (без строк с <th>) и ширина — по тому же правилу, что в scripts/check.py."""
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, flags=re.S | re.I)
    grid, data = [], 0
    for r, row in enumerate(rows):
        while len(grid) <= r:
            grid.append([])
        c = 0
        is_head = bool(re.search(r'<th', row, flags=re.I))
        for tag, attrs in re.findall(r'<(t[dh])([^>]*)>', row, flags=re.I):
            rs = int((re.search(r'rowspan\s*=\s*"?(\d+)', attrs, flags=re.I) or [0, 1])[1])
            cs = int((re.search(r'colspan\s*=\s*"?(\d+)', attrs, flags=re.I) or [0, 1])[1])
            while c < len(grid[r]) and grid[r][c]:
                c += 1
            for rr in range(r, r + rs):
                while len(grid) <= rr:
                    grid.append([])
                while len(grid[rr]) < c + cs:
                    grid[rr].append(False)
                for cc in range(c, c + cs):
                    grid[rr][cc] = True
            c += cs
        if not is_head:
            data += 1
    widths = {len(g) for g in grid if g}
    data, cols, ragged = table_shape(html)
    return data, cols


def _hdr_cells(cells, first_data, by=None):
    out = []
    for c in cells:
        if c['r'] >= first_data:
            continue
        ws = c['words'] if by is None else [w for w in c['words'] if (w['y0'] + w['y1']) / 2 < by]
        out.append({'r': c['r'], 'c': c['c'], 'rs': min(c['rs'], first_data - c['r']), 'cs': c['cs'], 'text': _lines_text(build_lines(ws)) if ws else ''})
    return out


def _html_rows(out_cells, head_rows, RR):
    def esc(t):
        return _html.escape(t, quote=False).replace('\n', '<br>')
    out = ['<table>']
    for sect, rng in (('thead', range(0, head_rows)), ('tbody', range(head_rows, RR))):
        if not len(rng):
            continue
        out.append(f'<{sect}>')
        for r in rng:
            tds = []
            for c in sorted([c for c in out_cells if c['r'] == r], key=lambda c: c['c']):
                tag = 'th' if sect == 'thead' else 'td'
                at = (f' rowspan="{c["rs"]}"' if c['rs'] > 1 else '') + (f' colspan="{c["cs"]}"' if c['cs'] > 1 else '')
                tds.append(f'<{tag}{at}>{esc(c["text"])}</{tag}>')
            out.append('<tr>' + ''.join(tds) + '</tr>')
        out.append(f'</{sect}>')
    out.append('</table>')
    return '\n'.join(out)


def render_table(tb):
    """Возвращает (разметка, строк данных, столбцов). Значения не исправляются; подозрительные помечаются [?…]."""
    ys = tb['ys']
    cells = [dict(c, lines=build_lines(c['words'])) for c in tb['cells']]
    R, C = tb['nr'], tb['nc']
    for c in cells:
        c['text'] = _lines_text(c['lines'])
    first_data = R
    for r in range(R):
        row = [c for c in cells if c['r'] == r]
        # A merged multi-level header can have only five cells but two isolated
        # OCR digits. Count against physical columns, not the few merged cells.
        if row and sum(_isnum_text(c['text']) for c in row) >= max(1, (C + 1) // 2):
            first_data = r
            break
    if first_data == R:
        first_data = 1 if R > 1 else 0
    first_data = tb.get('header_rows', first_data)
    # --- строки без горизонтальных линий: общие полосы строк по всем столбцам
    ub = CELLS.unruled_body(tb, ys[first_data]) if first_data < R and 'header_rows' not in tb else None
    if ub:
        xs, rows = ub
        head = _hdr_cells(cells, first_data, by=ys[first_data] - 2)
        matrix = []
        for band in rows:
            line = []
            for col in band:
                txt = _lines_text(build_lines(col)) if col else ''
                line.append({'text': txt.replace('\n', ' ')})
            matrix.append(line)
        CELLS.selfcheck_columns(matrix)
        body = [{'r': first_data + i, 'c': j, 'rs': 1, 'cs': 1, 'text': cell['text']} for i, line in enumerate(matrix) for j, cell in enumerate(line)]
        html = _html_rows(head + body, first_data, first_data + len(matrix))
        rows_, cols_ = html_shape(html)
        return html, rows_, cols_
    # --- обычная таблица с сеткой
    out_cells = [{'r': c['r'], 'c': c['c'], 'rs': c['rs'], 'cs': c['cs'], 'text': c['text']} for c in cells]
    matrix = []
    for r in range(first_data, R):
        line = [None] * C
        for c in out_cells:
            if c['r'] == r and c['rs'] == 1 and c['cs'] == 1:
                line[c['c']] = c
        matrix.append(line)
    CELLS.selfcheck_columns(matrix)
    spans = any(c['rs'] > 1 or c['cs'] > 1 for c in out_cells)
    if not spans and first_data == 1:
        grid = [[''] * C for _ in range(R)]
        for c in out_cells:
            grid[c['r']][c['c']] = c['text'].replace('|', r'\|').replace('\n', ' ')
        lines = ['| ' + ' | '.join(grid[0]) + ' |', '| ' + ' | '.join('---' for _ in range(C)) + ' |']
        lines += ['| ' + ' | '.join(r) + ' |' for r in grid[1:]]
        return '\n'.join(lines), R - 1, C
    html = _html_rows(out_cells, first_data, R)
    rows_, cols_ = html_shape(html)
    return html, rows_, cols_


# ---------------------------------------------------------------- страница → Markdown

def crop_img(d, n, box, name, pad=10):
    img = imread(d / 'pages' / f'p{n:03d}.jpg')
    H, W = img.shape[:2]
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = max(0, int(x0 - pad)), max(0, int(y0 - pad)), min(W, int(x1 + pad)), min(H, int(y1 + pad))
    part = img[y0:y1, x0:x1]
    k = 1.0
    if k < 1:
        part = cv2.resize(part, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    (d / 'img').mkdir(exist_ok=True)
    rel = f'img/p{n:03d}_{name}.png'
    imwrite(d / rel, cv2.cvtColor(part, cv2.COLOR_BGR2GRAY))
    return rel


def _slug(s):
    return re.sub(r'[^A-Za-z0-9._\-]+', '_', s.replace('А', 'A').replace('Б', 'B').replace('В', 'V').replace('Г', 'G')).strip('_') or 'x'


def _band_filter(lines, H, hf):
    """Убирает колонтитулы и номера страниц. Возвращает (строки тела, печатный номер)."""
    printed, body = None, []
    for ln in lines:
        if ln['y1'] < 0.075 * H or ln['y0'] > 0.925 * H:
            raw = re.sub(r'\[\?|\]', '', ln['text']).strip()
            if re.fullmatch(r'\d{1,3}|[IVXLivxl]{1,6}', raw):
                printed = raw
                continue
            ws = ln['words']
            if len(ws) > 1:
                gaps = [(ws[i + 1]['x0'] - ws[i]['x1'], i) for i in range(len(ws) - 1)]
                g, i = max(gaps)
                if g > 5 * ln['h']:
                    left, right = ws[:i + 1], ws[i + 1:]
                    keep = []
                    for part in (left, right):
                        t = ' '.join(w['t'] for w in part)
                        t2 = re.sub(r'\[\?|\]', '', t).strip()
                        if _norm_hf(t) in hf or re.fullmatch(r'\d{1,3}|[IVXLivxl]{1,6}', t2):
                            if re.fullmatch(r'\d{1,3}|[IVXLivxl]{1,6}', t2):
                                printed = t2
                            continue
                        keep += part
                    if len(keep) != len(ws):
                        if keep:
                            body.append(build_lines(keep)[0])
                        continue
            if _norm_hf(ln['text']) in hf:
                continue
        body.append(ln)
    return body, printed


def render_page(name, n, hf=None, write_crops=True):
    d = docdir(name)
    a = load_json(d / 'auto' / f'p{n:03d}.json')
    if not a:
        return None
    # Apply the same guard when resuming an older cached extraction.
    rejected = [t['bbox'] for t in a['tables'] if not content_table(t)]
    a['tables'] = [t for t in a['tables'] if content_table(t)]
    a['figures'] += rejected
    a['fig_rich'] = (a.get('fig_rich') or [False] * (len(a['figures']) - len(rejected))) + [False] * len(rejected)
    H, W = a['h'], a['w']
    hf = set(hf if hf is not None else (load_json(d / 'hf.json', []) or []))
    tb_boxes = [t['bbox'] for t in a['tables']]
    fig_boxes = a['figures']
    rich = a.get('fig_rich') or [False] * len(fig_boxes)
    excl = tb_boxes + [f for f, r in zip(fig_boxes, rich) if not r]
    flow = [w for w in a['words'] if not any(_center_in(w, b) for b in excl)]
    body, printed = _band_filter(build_lines(flow), H, hf)
    sizes = [ln['size'] for ln in body if len(ln['text']) > 25]
    base_size = float(np.median(sizes)) if sizes else 40.0
    xs0 = [ln['x0'] for ln in body if len(ln['text']) > 40]
    xs1 = [ln['x1'] for ln in body if len(ln['text']) > 40]
    left = float(np.percentile(xs0, 20)) if xs0 else 0.0
    right = float(np.percentile(xs1, 90)) if xs1 else W
    items = [('line', ln['y0'], ln) for ln in body]
    items += [('table', t['bbox'][1], t) for t in a['tables']]
    items += [('figure', f[1], f) for f in a['figures']]
    items.sort(key=lambda it: it[1])
    out, paras = [], []
    cur, prev = None, None
    doubts = 0
    cnt = {'figure': 0, 'table': 0, 'formula': 0}

    def flush():
        nonlocal cur
        if cur:
            paras.append(cur)
            cur = None

    def emit():
        for p in paras:
            out.append(_style(p, base_size))
        paras.clear()

    for kind, _, obj in items:
        if kind == 'line':
            ln = obj
            txt = ln['text']
            doubts += ln['doubts']
            plain = re.sub(r'\[\?|\]', '', txt)
            m = FORMPAT.search(plain)
            centered = abs((ln['x0'] + ln['x1']) / 2 - W / 2) < W * 0.16 and ln['x1'] - ln['x0'] < W * 0.7
            formula = MATHCH.search(plain) and len(plain) < 160 and (m or centered)
            if formula:
                flush()
                emit()
                ys, xs = [ln['y0'], ln['y1']], [ln['x0'], ln['x1']]
                for other in body:
                    if other is ln:
                        continue
                    oc = (other['y0'] + other['y1']) / 2
                    if ln['y0'] - 1.6 * ln['h'] <= oc <= ln['y1'] + 1.6 * ln['h'] and len(other['text']) < 28 and other['x0'] > ln['x0'] - 50 and other['x1'] < ln['x1'] + 50:
                        ys += [other['y0'], other['y1']]
                        xs += [other['x0'], other['x1']]
                cnt['formula'] += 1
                num = m.group(1) if m else chr(96 + min(cnt['formula'], 26))
                nm = f'formula_{_slug(num)}'
                rel = crop_img(d, n, (min(xs), min(ys), max(xs), max(ys)), nm) if write_crops else f'img/p{n:03d}_{nm}.png'
                head = plain[:m.start()].strip() if m else plain.strip()
                out.append(f'$$ [нечитаемо: формулу нужно перевести в LaTeX по вырезке] $$ ({num})\n![формула {num}]({rel})\n<!-- OCR: {_html.escape(head, quote=False)} -->')
                prev = None
                continue
            starts = cur is None
            if not starts:
                gap = ln['y0'] - prev['y1']
                if (NUMPAT.match(plain) or LISTPAT.match(plain) or DEFPAT.match(plain)
                        or re.match(r'^(Примечани|Таблица|Рисунок|Черт\.|Продолжение|Окончание|Где |где )', plain)
                        or gap > 0.6 * prev['h'] + 4 or (ln['x0'] - left) > 1.0 * ln['h'] or (prev['x1'] < right - 5 * ln['h'])
                        or abs(ln['size'] - prev['size']) > 0.18 * base_size):
                    starts = True
            if starts:
                flush()
                cur = {'t': txt, 'size': ln['size'], 'bold': ln['bold']}
            else:
                if cur['t'].endswith('-') and txt[:1].islower():
                    cur['t'] = cur['t'][:-1] + txt
                elif cur['t'].endswith('­'):
                    cur['t'] = cur['t'][:-1] + txt
                else:
                    cur['t'] += ' ' + txt
            prev = ln
        elif kind == 'table':
            flush()
            t = obj
            cnt['table'] += 1
            title = None
            for pi in range(len(paras) - 1, max(-1, len(paras) - 5), -1):
                if caption_id(paras[pi]['t']) and len(paras[pi]['t']) < 160:
                    title = paras.pop(pi)['t']
                    break
            emit()
            tnum = caption_id(title or '') or chr(96 + min(cnt['table'], 26))
            rel = crop_img(d, n, t['bbox'], f'tabl_{_slug(tnum)}', pad=12) if write_crops else f'img/p{n:03d}_tabl_{_slug(tnum)}.png'
            md, rows, cols = render_table(t)
            doubts += md.count('[?')
            out.append((title + '\n\n' if title else f'Таблица {tnum}\n\n') + f'![Таблица {tnum}]({rel})\n\n' + md + f'\n\n<!-- таблица {tnum}: строк {rows}, столбцов {cols} -->')
            prev = None
        else:
            flush()
            emit()
            cnt['figure'] += 1
            nm = f'ris_{cnt["figure"]}'
            rel = crop_img(d, n, obj, nm, pad=14) if write_crops else f'img/p{n:03d}_{nm}.png'
            out.append(f'![Рисунок]({rel})')
            prev = None
    flush()
    emit()
    mark = f'<!-- стр. {n}' + (f' (печатная {printed})' if printed else '') + ' -->'
    text = mark_numbers(mark + '\n\n' + '\n\n'.join(b for b in out if b.strip()))
    return {'md': text, 'doubts': len(re.findall(r'\[\?[^\]]*\]', text)), 'printed': printed}


HDR1 = re.compile(r'^(?:ПРИЛОЖЕНИЕ|Приложение)\s+[А-ЯA-Z]\b')


def _style(p, base):
    blk, size, bold = p['t'], p['size'], p['bold']
    plain = re.sub(r'\[\?|\]', '', blk)
    if len(plain) > 110:
        return blk
    big = bold or size >= 1.08 * base
    m = re.match(r'^(\d+(?:\.\d+){0,4})\*?\s+([А-ЯЁA-Z][^.;:]*)$', plain)
    if m and big and not plain.endswith(('.', ';', ':', ',')):
        return '#' * min(m.group(1).count('.') + 1, 3) + ' ' + blk
    letters = [c for c in plain if c.isalpha()]
    if len(letters) >= 4 and plain == plain.upper() and len(plain) < 100 and not re.search(r'\d{3}', plain):
        return '# ' + blk
    if HDR1.match(plain):
        return '# ' + blk
    if plain.strip() in ('Предисловие', 'Введение', 'Содержание', 'Библиография', 'Область применения'):
        return '## ' + blk
    return blk


# ---------------------------------------------------------------- сборка документа

HDRPAT = re.compile(r'(ГОСТ(?:\s+Р)?|СП|СТО|СНиП|ТУ|ТСН)\s*([\d]+[\d.\-—–]*(?:[\-—–]\d{2,4})?)')


def assemble(name, overwrite=True):
    d = docdir(name)
    pr = load_json(d / 'progress.json') or {}
    meta = load_json(d / 'meta.json') or {}
    N = pr.get('pages', 0)
    pm = d / 'pages_md'
    pm.mkdir(exist_ok=True)
    body, doubts, doubt_counts = [], {}, {}
    desig = ''
    for n in range(1, N + 1):
        f = pm / f'p{n:03d}.md'
        if not f.exists():
            body.append(f'<!-- стр. {n}: не распознана -->')
            continue
        t = f.read_text(encoding='utf-8')
        body.append(t)
        if not desig:
            m = HDRPAT.search(re.sub(r'\[\?([^\]]*)\]', r'\1', t))
            if m:
                desig = (m.group(1) + ' ' + m.group(2)).replace('—', '-').strip()
        for m in re.finditer(r'\[\?([^\]]{1,40})\]', t):
            doubt_counts[n] = doubt_counts.get(n, 0) + 1
            examples = doubts.setdefault(n, [])
            if len(examples) < 12:
                examples.append(m.group(1))
    hd = meta.get('head', {})
    head = ['---', f'обозначение: {hd.get("обозначение") or desig}', f'название: {hd.get("название", "")}', f'редакция: {hd.get("редакция", "")}', f'дата_введения: {hd.get("дата_введения", "")}', f'источник_скана: {meta.get("source", "")}', f'страниц: {N}',
            f'распознано: {datetime.date.today().isoformat()}', '---', '', MARK, '']
    tail = ['', '## Сомнительные места', '']
    if doubts:
        for n, ws in sorted(doubts.items()):
            more = doubt_counts[n] - len(ws)
            tail.append(f'- Стр. {n}: ' + ', '.join(f'«{w}»' for w in ws) + (f' и ещё {more}' if more else '') + ' — проверить по картинке.')
    else:
        tail.append('нет')
    text = '\n'.join(head) + '\n\n'.join(body) + '\n' + '\n'.join(tail) + '\n'
    import quality
    issues = quality.relation_checks(text)
    if issues:
        text += '\n' + '\n'.join(f"- Стр. {x['page']}, таблица {x['table']}: {x['message']}. По официальному изданию проверить; значение не исправлено." for x in issues) + '\n'
    quality.report(d, text, issues)
    out = d / 'document.md'
    if out.exists() and MARK not in out.read_text(encoding='utf-8', errors='ignore')[:600]:
        shutil.copy(out, d / 'document.manual.bak.md')
    out.write_text(text, encoding='utf-8')
    quality.run_relcheck_cli(d, text, run_script)
    return {'doubts': sum(len(re.findall(r'\[\?[^\]]*\]', t)) for t in body), 'relations': len(issues)}


# ---------------------------------------------------------------- задача распознавания

class Cancelled(Exception):
    pass


@OCR.RES.worker()
def recognize(name, pages, mode='auto', progress=None, cancel=None):
    d = docdir(name)
    pr = load_json(d / 'progress.json') or {}
    N = pr.get('pages', 0)
    pages = sorted(set(p for p in pages if 1 <= p <= N)) or list(range(1, N + 1))
    done_pages = []
    for i, n in enumerate(pages, 1):
        if cancel and cancel():
            raise Cancelled()
        if progress:
            progress(i - 1, len(pages), f'Страница {n}: распознавание…')
        extract(name, n, mode)
        done_pages.append(n)
        (d / 'pages_md').mkdir(exist_ok=True)
        if not (d / 'pages_md' / f'p{n:03d}.manual').exists():
            r = render_page(name, n)
            (d / 'pages_md' / f'p{n:03d}.md').write_text(r['md'], encoding='utf-8')
        pr['done'] = sorted(set(pr.get('done', [])) | {n})
        save_json(d / 'progress.json', pr)
    # колонтитулы по всем страницам документа
    allp = [n for n in range(1, N + 1) if (d / 'auto' / f'p{n:03d}.json').exists()]
    hf = compute_hf(name, allp)
    (d / 'pages_md').mkdir(exist_ok=True)
    for n in allp:
        if (d / 'pages_md' / f'p{n:03d}.manual').exists():
            continue
        if n in done_pages or not (d / 'pages_md' / f'p{n:03d}.md').exists():
            r = render_page(name, n, hf)
            a = load_json(d / 'auto' / f'p{n:03d}.json')
            a['doubts'] = r['doubts']
            save_json(d / 'auto' / f'p{n:03d}.json', a)
            (d / 'pages_md' / f'p{n:03d}.md').write_text(r['md'], encoding='utf-8')
    res = assemble(name)
    if progress:
        progress(len(pages), len(pages), 'Готово')
    return res


def do_check(name):
    out, code = run_script('check.py', docdir(name))
    return out


def do_relcheck(name, table, rels):
    out, code = run_script('relcheck.py', docdir(name), table, *rels)
    return out
