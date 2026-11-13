"""Словарь слов из уже оцифрованных документов: чинит склеенные и разорванные слова после OCR (пробелы OCR угадывает плохо)."""
import re, json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOCAB_FILE = HERE / 'vocab_ru.json'
WORD = re.compile(r'[А-Яа-яЁё]{2,}')
_vocab = None


def build(normy_dir):
    cnt = {}
    for md in Path(normy_dir).glob('*/document.md'):
        t = md.read_text(encoding='utf-8', errors='ignore')
        t = re.sub(r'<[^>]+>|!\[[^\]]*\]\([^)]*\)|\[\?[^\]]*\]', ' ', t)
        for w in WORD.findall(t):
            w = w.lower()
            cnt[w] = cnt.get(w, 0) + 1
    VOCAB_FILE.write_text(json.dumps(cnt, ensure_ascii=False), encoding='utf-8')
    return len(cnt)


def build_from_pdfs(folders, normy_dir=None, min_count=2):
    """Словарь по текстовым слоям PDF (где слой исправен) и по готовым document.md."""
    import fitz
    cnt = {}
    for folder in folders:
        for pdf in Path(folder).glob('*.pdf'):
            try:
                d = fitz.open(pdf)
            except Exception:
                continue
            for i in range(len(d)):
                t = d[i].get_text()
                letters = [c for c in t if c.isalpha()]
                if len(letters) < 200:
                    continue
                cyr = sum(1 for c in letters if 'А' <= c <= 'я' or c in 'Ёё')
                if cyr / len(letters) < 0.5:
                    continue
                for w in WORD.findall(t):
                    w = w.lower()
                    cnt[w] = cnt.get(w, 0) + 1
    if normy_dir:
        for md in Path(normy_dir).glob('*/document.md'):
            t = re.sub(r'<[^>]+>|!\[[^\]]*\]\([^)]*\)|\[\?[^\]]*\]', ' ', md.read_text(encoding='utf-8', errors='ignore'))
            for w in WORD.findall(t):
                cnt[w.lower()] = cnt.get(w.lower(), 0) + 1
    cnt = {w: c for w, c in cnt.items() if c >= min_count}
    VOCAB_FILE.write_text(json.dumps(cnt, ensure_ascii=False), encoding='utf-8')
    return len(cnt)


def vocab():
    global _vocab
    if _vocab is None:
        try:
            _vocab = json.loads(VOCAB_FILE.read_text(encoding='utf-8'))
        except Exception:
            _vocab = {}
    return _vocab


def add_words(text):
    """Дополняет словарь словами текущего документа (слова, встретившиеся в нём не менее 2 раз)."""
    v = vocab()
    local = {}
    for w in WORD.findall(text):
        local[w.lower()] = local.get(w.lower(), 0) + 1
    return {w: c for w, c in local.items() if c >= 2 and w not in v}


def segment(token, v, local):
    """Лучшее разбиение склеенного слова на слова из словаря, либо None."""
    s = token.lower()
    n = len(s)
    if n < 7 or not re.fullmatch(r'[а-яё]+', s):
        return None
    if v.get(s, 0) >= 1 or local.get(s, 0) >= 1:
        return None
    best = [None] * (n + 1)
    best[0] = (0.0, [])
    for i in range(1, n + 1):
        for j in range(max(0, i - 18), i):
            if best[j] is None:
                continue
            w = s[j:i]
            c = v.get(w, 0) + local.get(w, 0)
            if c <= 0 or (len(w) < 3 and w not in ('и', 'в', 'с', 'к', 'о', 'у', 'на', 'не', 'по', 'от', 'до', 'за', 'из', 'во', 'ко', 'об', 'то', 'ли', 'же', 'бы', 'ни', 'но', 'да', 'а')):
                continue
            sc = best[j][0] + math.log(c + 1) - 2.0
            if best[i] is None or sc > best[i][0]:
                best[i] = (sc, best[j][1] + [w])
    if best[n] is None or len(best[n][1]) < 2 or len(best[n][1]) > 6:
        return None
    # короткие частицы подряд — признак ложного разбиения
    if sum(1 for w in best[n][1] if len(w) <= 2) > len(best[n][1]) // 2 + 1:
        return None
    parts, k = [], 0
    for w in best[n][1]:
        parts.append(token[k:k + len(w)])
        k += len(w)
    return parts


def fix_words(words):
    """Склеивает разорванные и разделяет склеенные слова. Работает со списком слов OCR одной страницы."""
    v = vocab()
    if not v:
        return words
    local = add_words(' '.join(w['t'] for w in words))
    # 1. слить соседние обрывки в слово из словаря
    ws = sorted(words, key=lambda w: ((w['y0'] + w['y1']) / 2 // 30, w['x0']))
    out, i = [], 0
    while i < len(ws):
        w = ws[i]
        if i + 1 < len(ws):
            n = ws[i + 1]
            same = abs((w['y0'] + w['y1']) / 2 - (n['y0'] + n['y1']) / 2) < 0.5 * (w['y1'] - w['y0'])
            gap = n['x0'] - w['x1']
            a, b = w['t'], n['t']
            if same and 0 <= gap < 0.45 * (w['y1'] - w['y0']) and re.fullmatch(r'[А-Яа-яЁё]+', a) and re.fullmatch(r'[А-Яа-яЁё]+', b):
                m = (a + b).lower()
                if v.get(m, 0) + local.get(m, 0) >= 2 and (v.get(a.lower(), 0) < 3 or v.get(b.lower(), 0) < 3):
                    out.append(dict(w, t=a + b, x1=n['x1'], y0=min(w['y0'], n['y0']), y1=max(w['y1'], n['y1']), c=min(w['c'], n['c'])))
                    i += 2
                    continue
        out.append(w)
        i += 1
    # 2. разрезать склеенные
    res = []
    for w in out:
        parts = segment(w['t'], v, local)
        if not parts:
            res.append(w)
            continue
        L = len(w['t'])
        k = 0
        for p in parts:
            x0 = w['x0'] + (w['x1'] - w['x0']) * k / L
            k += len(p)
            x1 = w['x0'] + (w['x1'] - w['x0']) * k / L
            res.append(dict(w, t=p, x0=x0, x1=x1))
    return res
