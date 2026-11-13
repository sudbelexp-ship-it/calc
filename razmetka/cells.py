"""Выравнивание наклона, распознавание таблиц по ячейкам (только распознаватель строк), строки без линий, самопроверка столбцов."""
import re
import numpy as np
import cv2
import ocr as OCR
from numeric import values as numeric_values
import logging
LOG = logging.getLogger("razmetka.cells")

NUMCELL = re.compile(r'^[\d\s.,±+\-–—−*/()%]+$')
NUMTOK = re.compile(r'^[+\-−–±]?\d+(?:[.,]\d+)?\*?$')


def nums_in(t):
    return numeric_values(t)


# ---------------------------------------------------------------- наклон скана

def skew_angle(gray):
    """Угол наклона в градусах по длинным почти горизонтальным линиям (Hough). 0.0, если надёжных линий нет."""
    h, w = gray.shape
    k = min(1.0, 1800 / max(h, w))
    small = cv2.resize(gray, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else gray
    edges = cv2.Canny(small, 60, 160)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 3600, threshold=120, minLineLength=int(small.shape[1] * 0.18), maxLineGap=12)
    if lines is None:
        return 0.0
    angs, wts = [], []
    for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
        dx, dy = x2 - x1, y2 - y1
        if dx == 0:
            continue
        a = np.degrees(np.arctan2(dy, dx))
        if abs(a) < 6:
            angs.append(a)
            wts.append(np.hypot(dx, dy))
    if len(angs) < 3:
        return 0.0
    order = np.argsort(angs)
    angs, wts = np.array(angs)[order], np.array(wts)[order]
    cum = np.cumsum(wts)
    return float(angs[np.searchsorted(cum, cum[-1] / 2)])


def deskew(img):
    """(картинка, угол, матрица 2×3 или None). Поворачивает, если |угол| > 0,1°."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    a = skew_angle(gray)
    if abs(a) <= 0.1:
        return img, 0.0, None
    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), a, 1.0)
    out = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    return out, a, M


def transform_words(words, M):
    if M is None:
        return words
    for w in words:
        pts = np.array([[w['x0'], w['y0'], 1], [w['x1'], w['y0'], 1], [w['x1'], w['y1'], 1], [w['x0'], w['y1'], 1]], dtype=float) @ M.T
        w['x0'], w['x1'] = float(pts[:, 0].min()), float(pts[:, 0].max())
        w['y0'], w['y1'] = float(pts[:, 1].min()), float(pts[:, 1].max())
    return words


# ---------------------------------------------------------------- ячейки

def line_bands(crop):
    """Горизонтальные полосы текста в кадре ячейки: [(y0, y1, x0, x1)]."""
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    _, bw = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    if bw.sum() < 255 * 12:
        return []
    rows = (bw.sum(axis=1) / 255) >= 2
    bands, start = [], None
    gap = 0
    for y, v in enumerate(rows):
        if v:
            if start is None:
                start = y
            gap = 0
            end = y
        elif start is not None:
            gap += 1
            if gap > 3:
                bands.append((start, end))
                start = None
    if start is not None:
        bands.append((start, end))
    out = []
    for y0, y1 in bands:
        if y1 - y0 < 8:
            continue
        cols = np.where(bw[y0:y1 + 1].sum(axis=0) > 0)[0]
        if len(cols):
            out.append((y0, y1 + 1, int(cols.min()), int(cols.max()) + 1))
    return out


def rec_line(img):
    try:
        return OCR.recognize_line(img)
    except Exception:
        LOG.exception('Cell recognizer failed')
        raise


def cell_ocr(img_clean, tbl, scale_to=56, zoom_min=2.0, zoom_max=3.0):
    """Распознаёт каждую ячейку по отдельности. Возвращает {(r, c): [слова]}, слова в пикселях страницы."""
    res = {}
    H, W = img_clean.shape[:2]
    for c in tbl['cells']:
        x0, y0, x1, y1 = [int(v) for v in c['bbox']]
        x0, y0, x1, y1 = max(0, x0 + 4), max(0, y0 + 4), min(W, x1 - 3), min(H, y1 - 3)
        if x1 - x0 < 10 or y1 - y0 < 10:
            res[(c['r'], c['c'])] = []
            continue
        crop = img_clean[y0:y1, x0:x1]
        words = []
        for by0, by1, bx0, bx1 in line_bands(crop):
            line = crop[by0:by1, max(0, bx0 - 2):bx1 + 2]
            h = by1 - by0
            z = min(zoom_max, max(zoom_min, scale_to / max(h, 1)))
            big = cv2.resize(line, None, fx=z, fy=z, interpolation=cv2.INTER_CUBIC) if z != 1.0 else line
            big = cv2.copyMakeBorder(big, 10, 10, 14, 14, cv2.BORDER_CONSTANT, value=(255, 255, 255))
            text, conf, variants = rec_line(big)
            toks = text.split()
            if not toks:
                continue
            lx0, lx1 = x0 + max(0, bx0 - 2), x0 + bx1 + 2
            L = sum(len(t) for t in toks) + 0.6 * (len(toks) - 1)
            k = 0.0
            for t in toks:
                a = lx0 + (lx1 - lx0) * k / L
                k += len(t)
                b = lx0 + (lx1 - lx0) * k / L
                k += 0.6
                words.append({'t': t, 'x0': a, 'x1': b, 'y0': float(y0 + by0), 'y1': float(y0 + by1), 'c': conf, 'alt': variants, 'size': (by1 - by0) * 0.85, 'bold': False, 'it': False})
        res[(c['r'], c['c'])] = words
    return res


def compare_cell(primary, other, strict_missing=False):
    """Сверка числовых значений ячейки у двух распознаваний. Расхождение → все числа основного получают сомнение.
    Возвращает (confirmed, flagged, unverified)."""
    order = lambda ws: sorted(ws, key=lambda w: ((w['y0'] + w['y1']) / 2, w['x0']))
    a = [x for w in order(primary) for x in nums_in(w['t'])]
    b = [x for w in order(other) for x in nums_in(w['t'])]
    if not a:
        return 0, 0, 0
    if a == b:
        return len(a), 0, 0
    alt = ' '.join(w['t'] for w in other)
    for w in primary:
        if re.search(r'\d', w['t']):
            w['c'] = min(w['c'], 0.5)
            w['alt'] = alt
    return 0, len(a), (len(a) if not b else 0)


# ---------------------------------------------------------------- строки без линий (сортаменты)

def numeric_word(t):
    return bool(NUMTOK.match(re.sub(r'\[\?|\]', '', t)))


def row_bands(words, tol_ratio=0.55):
    """Общие полосы строк по центрам слов всех столбцов: [(центр, [слова])]."""
    ws = sorted(words, key=lambda w: (w['y0'] + w['y1']) / 2)
    if not ws:
        return []
    hs = sorted(w['y1'] - w['y0'] for w in ws)
    tol = tol_ratio * hs[len(hs) // 2]
    bands = []
    for w in ws:
        cy = (w['y0'] + w['y1']) / 2
        if bands and cy - bands[-1][0] <= tol:
            bands[-1][1].append(w)
            n = len(bands[-1][1])
            bands[-1][0] = bands[-1][0] + (cy - bands[-1][0]) / n
        else:
            bands.append([cy, [w]])
    return bands


def extend_header_tables(tables, words, page_height):
    """A ruled header can sit above an unruled numeric body (beam sortaments).
    Extend only over a contiguous block of strongly numeric aligned lines.
    """
    for table in tables:
        if len(table['ys']) - 1 > 6:
            continue
        x0, y0, x1, bottom = table['bbox']
        columns = len(table['xs']) - 1
        if columns < 3:
            continue
        limit = min((t['bbox'][1] for t in tables if t is not table and t['bbox'][1] > bottom), default=page_height)
        candidates = [w for w in words if x0 - 4 <= (w['x0'] + w['x1']) / 2 <= x1 + 4
                      and bottom <= (w['y0'] + w['y1']) / 2 < limit]
        accepted = []
        for cy, band in row_bands(candidates):
            nums = [w for w in band if numeric_word(w['t'])]
            h = float(np.median([w['y1'] - w['y0'] for w in band]))
            strong = len(nums) >= max(3, columns // 2) and len(nums) >= .65 * len(band)
            if not accepted:
                if cy - bottom > max(page_height * .08, h * 5):
                    break
                if not strong:
                    continue
            elif not strong or cy - accepted[-1][0] > h * 3:
                break
            accepted.append((cy, band))
        if len(accepted) < 3:
            continue
        end = int(max(w['y1'] for cy, band in accepted for w in band) + 6)
        r = len(table['ys']) - 1
        # Some scans omit the outer header rules. Repeated numeric columns outside
        # the ruled header still belong to the body (e.g. profile number and i_y).
        heights = [w['y1'] - w['y0'] for cy, band in accepted for w in band]
        tolerance = float(np.median(heights)) * .65
        outside = [w for w in words if numeric_word(w['t'])
                   and ((w['x0'] + w['x1']) / 2 < x0 or (w['x0'] + w['x1']) / 2 > x1)
                   and min(abs((w['y0'] + w['y1']) / 2 - cy) for cy, band in accepted) < tolerance]
        clusters = []
        for w in sorted(outside, key=lambda w: (w['x0'] + w['x1']) / 2):
            cx = (w['x0'] + w['x1']) / 2
            if clusters and abs(cx - np.median([(q['x0'] + q['x1']) / 2 for q in clusters[-1]])) < tolerance:
                clusters[-1].append(w)
            else:
                clusters.append([w])
        stable = [g for g in clusters if len(g) >= max(3, len(accepted) * .65)]
        left = [g for g in stable if np.median([(w['x0'] + w['x1']) / 2 for w in g]) < x0]
        right = [g for g in stable if np.median([(w['x0'] + w['x1']) / 2 for w in g]) > x1]
        if len(left) + len(right) <= 4:
            left_edges = [int(min(w['x0'] for w in group) - 8) for group in left]
            right_edges = [int(max(w['x1'] for w in group) + 8) for group in right]
            if left_edges or right_edges:
                old_columns = columns
                for cell in table['cells']:
                    cell['c'] += len(left_edges)
                table['xs'] = left_edges + list(table['xs']) + right_edges
                columns = len(table['xs']) - 1
                x0, x1 = table['xs'][0], table['xs'][-1]
                for col in list(range(len(left_edges))) + list(range(len(left_edges) + old_columns, columns)):
                    table['cells'].append(dict(r=0, c=col, rs=r, cs=1,
                        bbox=(table['xs'][col], y0, table['xs'][col + 1], bottom)))
        table['ys'] = list(table['ys']) + [end]
        table['bbox'] = (x0, y0, x1, end)
        for c in range(columns):
            table['cells'].append(dict(r=r, c=c, rs=1, cs=1,
                bbox=(table['xs'][c], bottom, table['xs'][c + 1], end)))
        table['extended_numeric_body'] = len(accepted)
    return tables


def unruled_body(tbl, by):
    """Строки тела таблицы без горизонтальных линий. Возвращает матрицу строк×столбцов из текстов или None, если таблица обычная.
    Условие: числовых полос заметно больше, чем строк сетки."""
    xs = [tbl['xs'][0]]
    for x in tbl['xs'][1:]:
        if x - xs[-1] >= 22:
            xs.append(x)
    C = len(xs) - 1
    words = [w for c in tbl['cells'] for w in c['words'] if (w['y0'] + w['y1']) / 2 >= by]
    num_words = [w for w in words if numeric_word(w['t'])]
    nb = row_bands(num_words)
    grid_body = sum(1 for i, y in enumerate(tbl['ys'][:-1]) if y >= by - 2)
    if len(nb) < 4 or len(nb) <= 1.3 * max(1, grid_body):
        return None
    centers = [b[0] for b in nb]
    rows = [[[] for _ in range(C)] for _ in centers]
    for w in words:
        cy = (w['y0'] + w['y1']) / 2
        cx = (w['x0'] + w['x1']) / 2
        r = int(np.argmin([abs(cy - cc) for cc in centers]))
        col = max(0, min(C - 1, int(np.searchsorted(xs, cx) - 1)))
        rows[r][col].append(w)
    return xs, rows


# ---------------------------------------------------------------- самопроверка столбцов (значения не меняются, только пометка)

def decimals(t):
    m = re.fullmatch(r'[+\-−–±]?\d+(?:[.,](\d+))?', re.sub(r'\[\?|\]', '', t).strip())
    if not m:
        return None
    return len(m.group(1)) if m.group(1) else 0


def val(t):
    try:
        return float(re.sub(r'\[\?|\]', '', t).replace(',', '.').replace('−', '-').replace('–', '-').strip().lstrip('+±'))
    except ValueError:
        return None


def flag_text(t):
    return t if '[?' in t else '[?' + t + ']'


def selfcheck_columns(matrix):
    """matrix: список строк, строка — список ячеек {'text': ...}. Помечает подозрительные значения; возвращает число пометок."""
    if not matrix:
        return 0
    C = max(len(r) for r in matrix)
    n_flag = 0
    for c in range(C):
        col = [r[c] for r in matrix if c < len(r) and r[c] is not None]
        if len(col) < 5:
            continue
        txt = [x['text'].replace('\n', ' ').strip() for x in col]
        isnum = [bool(txt_ and NUMCELL.match(re.sub(r'\[\?|\]', '', txt_))) and val(txt_) is not None for txt_ in txt]
        if sum(isnum) / len(col) < 0.7:
            continue
        # 1. число знаков после запятой
        decs = [decimals(t) if k else None for t, k in zip(txt, isnum)]
        dd = [d for d in decs if d is not None]
        if dd:
            mode = max(set(dd), key=dd.count)
            if dd.count(mode) / len(dd) >= 0.7:
                for x, d in zip(col, decs):
                    if d is not None and d != mode and '[?' not in x['text']:
                        x['text'] = flag_text(x['text'].strip())
                        n_flag += 1
        # 2. возрастание
        vals = [val(t) if k else None for t, k in zip(txt, isnum)]
        seq = [(i, v) for i, v in enumerate(vals) if v is not None]
        if len(seq) >= 6:
            ok = sum(1 for (i, a), (j, b) in zip(seq, seq[1:]) if b >= a)
            if ok / (len(seq) - 1) >= 0.85:
                top = seq[0][1]
                for (i, v), nxt in zip(seq[1:], seq[2:] + [None]):
                    if v < top - 1e-9:
                        # нарушение порядка: помечаем само значение
                        if '[?' not in col[i]['text']:
                            col[i]['text'] = flag_text(col[i]['text'].strip())
                            n_flag += 1
                    else:
                        top = v
        # 3. пусто или текст в числовом столбце
        if sum(isnum) / len(col) >= 0.9:
            for x, k, t in zip(col, isnum, txt):
                if not k and '[?' not in x['text']:
                    x['text'] = flag_text(t if t else 'пусто')
                    n_flag += 1
    return n_flag
