"""Сравнение автоматической разметки с ручной (эталон — document.md, сделанный вручную).

  python evaluate.py <исходный_pdf> <папка_эталона> <имя_пробной_папки> [auto|ocr|text|precise] [стр ...]

Главный показатель — «неверных чисел БЕЗ пометки [?…]» (цель — ноль). Числа сравниваются по порядку на странице
(выравнивание последовательностей), а не мешком; мешковый показатель выводится дополнительно.
Результат пишется в eval_results/<имя>_<режим>.json.
"""
import sys, io, re, time, json, os
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, str(Path(__file__).parent))
import engine as E

NUM = re.compile(r'\d+(?:[.,]\d+)?')
WORD = re.compile(r'[А-Яа-яЁёA-Za-z]{3,}')


def split_pages(md):
    md = md.split('## Сомнительные места')[0]
    parts = re.split(r'<!--\s*стр\.\s*(\d+)[^>]*-->', md)
    out = {}
    for i in range(1, len(parts), 2):
        out[int(parts[i])] = out.get(int(parts[i]), '') + parts[i + 1]
    return out


def strip(t):
    t = re.sub(r'<!--.*?-->', ' ', t, flags=re.S)
    t = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', t)
    return re.sub(r'<[^>]+>', ' ', t)


def tokens(text, keep_flags):
    """[(число, помечено_ли)] в порядке следования."""
    t = strip(text)
    spans = [(m.start(), m.end()) for m in re.finditer(r'\[\?[^\]]*\]', t)] if keep_flags else []
    out = []
    for m in NUM.finditer(t):
        fl = any(a <= m.start() < b for a, b in spans)
        out.append((m.group().replace(',', '.'), fl))
    return out


from eval_core import evaluate_text, score_page


def run(src, ref, name, mode='auto', pages=None, quiet=False, cached=False):
    d = E.docdir(name)
    if not (d / 'progress.json').exists():
        E.prep(src, name)
    t = time.time()
    if not cached:
        E.recognize(name, pages or [], mode, progress=lambda i, n, m: None)
    dt = time.time() - t
    auto = split_pages((d / 'document.md').read_text(encoding='utf-8'))
    manual = split_pages(Path(ref, 'document.md').read_text(encoding='utf-8'))
    use = pages or sorted(auto)
    res = evaluate_text(Path(ref, 'document.md').read_text(encoding='utf-8'), (d / 'document.md').read_text(encoding='utf-8'), pages)
    res.update(doc=name, mode=mode, pages=len(use), seconds=round(dt, 1), cached=cached, check=E.do_check(name).splitlines()[-6:])
    out = Path(__file__).parent / 'eval_results'
    out.mkdir(exist_ok=True)
    (out / f'{name}_{mode}.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    if not quiet:
        print(json.dumps({k: res[k] for k in ('doc', 'mode', 'total', 'seconds')}, ensure_ascii=False))
    return res


if __name__ == '__main__':
    src, ref, name = sys.argv[1], sys.argv[2], sys.argv[3]
    mode = sys.argv[4] if len(sys.argv) > 4 else 'auto'
    pages = [int(x) for x in sys.argv[5:] if x != '--cached']
    run(src, ref, name, mode, pages, cached='--cached' in sys.argv)
