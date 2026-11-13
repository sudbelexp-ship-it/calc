"""Поиск таблиц с линиями на картинке страницы: сетка, объединённые ячейки."""
import numpy as np
import cv2


def line_masks(gray):
    h, w = gray.shape
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kh = cv2.getStructuringElement(cv2.MORPH_RECT, (max(45, w // 45), 1))
    kv = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(45, h // 70)))
    horiz = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kh)
    vert = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kv)
    return horiz, vert


def _clusters(idx, gap):
    out = []
    for i in idx:
        if out and i - out[-1][-1] <= gap:
            out[-1].append(i)
        else:
            out.append([i])
    return [float(np.mean(c)) for c in out]


def _merge_close(vals, mind):
    out = []
    for v in vals:
        if out and v - out[-1] < mind:
            out[-1] = (out[-1] + v) / 2
        else:
            out.append(v)
    return out


def find_tables(gray):
    """[{bbox:(x0,y0,x1,y1), xs:[...], ys:[...], cells:[{r,c,rs,cs,bbox}]}]"""
    h, w = gray.shape
    horiz, vert = line_masks(gray)
    grid = cv2.bitwise_or(horiz, vert)
    comp = cv2.dilate(grid, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(comp, connectivity=8)
    res = []
    for i in range(1, n):
        x, y, bw_, bh_, area = stats[i]
        if bw_ < w * 0.12 or bh_ < 40:
            continue
        sub_h = horiz[y:y + bh_, x:x + bw_]
        sub_v = vert[y:y + bh_, x:x + bw_]
        ys = _merge_close([y + v for v in _clusters(np.where(sub_h.sum(axis=1) / 255 >= bw_ * 0.18)[0], 3)], 22)
        xs = _merge_close([x + v for v in _clusters(np.where(sub_v.sum(axis=0) / 255 >= bh_ * 0.18)[0], 3)], 22)
        if len(ys) < 2 or len(xs) < 2:
            continue
        # границы таблицы — по крайним линиям (даже если внешний контур неполон)
        x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
        if (x1 - x0) < w * 0.12 or (y1 - y0) < 40:
            continue
        cells = _cells(horiz, vert, xs, ys)
        res.append({'bbox': (int(x0), int(y0), int(x1), int(y1)), 'xs': xs, 'ys': ys, 'cells': cells})
    # убрать вложенные
    res.sort(key=lambda t: (t['bbox'][1], t['bbox'][0]))
    keep = []
    for t in res:
        a = t['bbox']
        if any(k['bbox'][0] <= a[0] + 5 and k['bbox'][1] <= a[1] + 5 and k['bbox'][2] >= a[2] - 5 and k['bbox'][3] >= a[3] - 5 for k in keep):
            continue
        keep.append(t)
    return keep


def _border_h(horiz, y, xa, xb):
    y = int(round(y))
    strip = horiz[max(0, y - 4):y + 5, int(xa) + 5:int(xb) - 4]
    if strip.size == 0:
        return True
    return (strip.max(axis=0) > 0).mean() >= 0.5


def _border_v(vert, x, ya, yb):
    x = int(round(x))
    strip = vert[int(ya) + 5:int(yb) - 4, max(0, x - 4):x + 5]
    if strip.size == 0:
        return True
    return (strip.max(axis=1) > 0).mean() >= 0.5


def _cells(horiz, vert, xs, ys):
    R, C = len(ys) - 1, len(xs) - 1
    seen = [[False] * C for _ in range(R)]
    cells = []
    for r in range(R):
        for c in range(C):
            if seen[r][c]:
                continue
            cs = 1
            while c + cs < C and not _border_v(vert, xs[c + cs], ys[r], ys[r + 1]):
                cs += 1
            rs = 1
            while r + rs < R and not all(_border_h(horiz, ys[r + rs], xs[c + k], xs[c + k + 1]) for k in range(cs)):
                rs += 1
            for rr in range(r, r + rs):
                for cc in range(c, c + cs):
                    seen[rr][cc] = True
            cells.append({'r': r, 'c': c, 'rs': rs, 'cs': cs, 'bbox': (xs[c], ys[r], xs[c + cs], ys[r + rs])})
    return cells


def erase_lines(img, tables):
    """Стирает линии таблиц (только внутри найденных таблиц), чтобы OCR не путал их с буквами."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    horiz, vert = line_masks(gray)
    m = cv2.dilate(cv2.bitwise_or(horiz, vert), np.ones((3, 3), np.uint8))
    zone = np.zeros_like(m)
    for t in tables:
        x0, y0, x1, y1 = t['bbox']
        zone[max(0, y0 - 6):y1 + 7, max(0, x0 - 6):x1 + 7] = 255
    m = cv2.bitwise_and(m, zone)
    out = img.copy()
    out[m > 0] = 255
    return out
