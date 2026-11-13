"""Обёртка над RapidOCR (PP-OCR, русский + латиница): слова с рамками и достоверностью, определение поворота страницы."""
import threading
import numpy as np
import cv2
import logging
LOG = logging.getLogger("razmetka.ocr")

_lock = threading.Lock()
_eng = None
_precise = False
_server = None


def set_precise(enabled):
    global _precise
    _precise = bool(enabled)


def _server_engine():
    global _server
    if _server is None:
        from rapidocr import RapidOCR, LangRec, OCRVersion, ModelType
        # PP-OCRv5 has no Cyrillic SERVER export. SERVER is used for numeric cells;
        # Cyrillic MOBILE remains the Russian full-page reader and second opinion.
        _server = RapidOCR(params={'Rec.lang_type': LangRec.CH,
            'Rec.ocr_version': OCRVersion.PPOCRV5, 'Rec.model_type': ModelType.SERVER,
            'Global.log_level': 'error'})
    return _server


def recognize_line(img):
    engines = [_server_engine(), _engine(), _alt_engine('latin')] if _precise else [_engine()]
    variants = []
    for engine in engines:
        with _lock:
            r = engine(img, use_det=False, use_cls=False, use_rec=True)
        variants.append((str(r.txts[0]), float(r.scores[0])) if r.txts else ('', 0.0))
    text, conf = variants[0]
    if len({_norm(t) for t, c in variants}) > 1:
        conf = min(conf, .5)
    return text, conf, [t for t, c in variants]


def _engine():
    global _eng
    if _eng is None:
        from rapidocr import RapidOCR, LangRec, OCRVersion, ModelType
        _eng = RapidOCR(params={
            "Rec.lang_type": LangRec.CYRILLIC,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_type": ModelType.MOBILE,
            "Global.log_level": "error",
            "Global.max_side_len": 3800,
            "Global.text_score": 0.3,
            "Det.unclip_ratio": 1.3,
        })
    return _eng


_alt = {}


def _alt_engine(kind):
    if kind not in _alt:
        from rapidocr import RapidOCR, LangRec, OCRVersion, ModelType
        lang = {'latin': LangRec.LATIN, 'ch': LangRec.CH}[kind]
        _alt[kind] = RapidOCR(params={"Rec.lang_type": lang, "Rec.ocr_version": OCRVersion.PPOCRV5, "Rec.model_type": ModelType.MOBILE, "Global.log_level": "error", "Global.max_side_len": 3800, "Det.unclip_ratio": 1.3})
    return _alt[kind]


def ocr_words(img, engine=None, cls=True):
    """Возвращает список слов {t, x0, y0, x1, y1, c} в пикселях картинки.
    Текст строк берётся целиком (так не теряются строки), границы слов — по точным рамкам, а если их нет — пропорционально."""
    with _lock:
        try:
            r = (_engine() if engine is None else _alt_engine(engine))(img, return_word_box=True, use_det=True, use_cls=cls, use_rec=True)
        except Exception:
            LOG.exception('OCR failed')
            raise
    txts = getattr(r, 'txts', None) or ()
    boxes = getattr(r, 'boxes', None)
    scores = getattr(r, 'scores', None)
    wr = getattr(r, 'word_results', None) or ()
    out = []
    for li, text in enumerate(txts):
        try:
            box = boxes[li]
            sc = float(scores[li])
        except Exception:
            continue
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        lx0, lx1, ly0, ly1 = float(min(xs)), float(max(xs)), float(min(ys)), float(max(ys))
        exact = None
        if li < len(wr) and wr[li]:
            items = [wr[li]] if (len(wr[li]) == 3 and isinstance(wr[li][0], str)) else wr[li]
            items = [it for it in items if it and len(it) == 3 and isinstance(it[0], str) and it[2] is not None]
            if items and ''.join(it[0] for it in items).replace(' ', '') == text.replace(' ', ''):
                exact = items
        if exact:
            for t, c, bx in exact:
                bxs = [p[0] for p in bx]
                bys = [p[1] for p in bx]
                out.append({'t': t, 'x0': float(min(bxs)), 'y0': float(min(bys)), 'x1': float(max(bxs)), 'y1': float(max(bys)), 'c': float(c)})
            continue
        toks = text.split()
        L = sum(len(t) for t in toks) + max(0, len(toks) - 1) * 0.6
        if not toks or L <= 0:
            continue
        k = 0.0
        for i, t in enumerate(toks):
            x0 = lx0 + (lx1 - lx0) * k / L
            k += len(t)
            x1 = lx0 + (lx1 - lx0) * k / L
            k += 0.6
            out.append({'t': t, 'x0': x0, 'y0': ly0, 'x1': x1, 'y1': ly1, 'c': sc})
    return out


def _quality(words):
    n = sum(len(w['t']) for w in words)
    if not n:
        return 0.0
    return sum(w['c'] * len(w['t']) for w in words) / n * min(1.0, n / 200)


def _vertical_share(words):
    long_ = [w for w in words if len(w['t']) >= 3]
    if len(long_) < 8:
        return 0.0
    return sum(1 for w in long_ if (w['y1'] - w['y0']) > 1.3 * (w['x1'] - w['x0'])) / len(long_)


def best_rotation(img):
    """Угол (0/90/180/270 по часовой), на который надо повернуть картинку, чтобы текст читался. Проверка по уменьшенной копии."""
    h, w = img.shape[:2]
    k = min(1.0, 1500 / max(h, w))
    small = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else img
    w0 = ocr_words(small, cls=False)
    q0 = _quality(w0)
    if q0 > 0.85 and _vertical_share(w0) < 0.3:
        return 0
    cand = [90, 270] if _vertical_share(w0) >= 0.45 else [0, 90, 270, 180]
    scores = {0: q0}
    codes = {90: cv2.ROTATE_90_CLOCKWISE, 270: cv2.ROTATE_90_COUNTERCLOCKWISE, 180: cv2.ROTATE_180}
    for ang in cand:
        if ang == 0:
            continue
        ws = ocr_words(cv2.rotate(small, codes[ang]), cls=False)
        scores[ang] = _quality(ws)
    if _vertical_share(w0) >= 0.45:
        scores.pop(0, None)
    return max(scores, key=scores.get)


def rotate(img, ang):
    if ang == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if ang == 270:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if ang == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    return img


_NUM = __import__('re').compile(r'^[+\-−–±]?\d+(?:[.,]\d+)?\*?$')


def _norm(t):
    return t.replace(',', '.').replace('−', '-').replace('–', '-')


def vote_numbers(img, base):
    """Три разные модели распознавания голосуют по числам. Возвращает (исправлено, спорных)."""
    others = [ocr_words(img, 'latin'), ocr_words(img, 'ch')]
    bks = []
    for ws in others:
        b = {}
        for o in ws:
            b.setdefault(int((o['y0'] + o['y1']) / 2 // 50), []).append(o)
        bks.append(b)
    fixed = disputed = 0
    for w in base:
        if not any(ch.isdigit() for ch in w['t']):
            continue
        cx, cy = (w['x0'] + w['x1']) / 2, (w['y0'] + w['y1']) / 2
        votes = [w['t']]
        for b in bks:
            best, bd = None, 1e9
            for k in (int(cy // 50) - 1, int(cy // 50), int(cy // 50) + 1):
                for o in b.get(k, ()):
                    if o['x0'] - 3 <= cx <= o['x1'] + 3 and o['y0'] - 3 <= cy <= o['y1'] + 3:
                        dd = abs((o['x0'] + o['x1']) / 2 - cx)
                        if dd < bd:
                            best, bd = o, dd
            votes.append(best['t'] if best else None)
        t0, t1, t2 = votes
        n0, n1, n2 = (_norm(x) if x else None for x in votes)
        if n1 is not None and n1 == n2 and n0 != n1 and _NUM.match(t1):
            w['alt'] = [t1, t2]
            w['c'] = min(w['c'], 0.5)
            w['alt'] = [t1, t2]
            disputed += 1
        elif (n1 is not None and n0 != n1) and (n2 is not None and n0 != n2):
            w['c'] = min(w['c'], 0.5)
            disputed += 1
        elif (n1 is not None and n0 != n1) or (n2 is not None and n0 != n2):
            w['c'] = min(w['c'], 0.7)
            w['alt'] = [t1, t2]
            disputed += 1
    return fixed, disputed
