"""Проверка распознанного документа.  python check.py <папка документа>

Проверяет все *.md в папке: метки страниц, ссылки на картинки, таблицы (вырезка, проверочная строка,
число строк и столбцов, ровность строк), формулы (картинка), пометы сомнения.
"""
import sys, os, re, json, glob
for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding='utf-8', errors='replace')   # консоль Windows по умолчанию не UTF-8

if len(sys.argv) != 2:
    sys.exit(__doc__)
out = sys.argv[1]
files = sorted(glob.glob(os.path.join(out, '*.md')))
if not files:
    sys.exit('Нет .md файлов в ' + out)
text = '\n'.join(open(f, encoding='utf-8').read() for f in files)
lines = text.split('\n')
problems, notes = [], []

# --- метки страниц
marks = [int(m) for m in re.findall(r'<!--\s*стр\.\s*(\d+)', text)]
prog = os.path.join(out, 'progress.json')
total = json.load(open(prog, encoding='utf-8'))['pages'] if os.path.exists(prog) else (max(marks) if marks else 0)
seen = sorted(set(marks))
miss = [i for i in range(1, (max(seen) if seen else 0) + 1) if i not in seen]
if miss:
    problems.append(f'нет меток страниц: {miss[:30]}' + (' …' if len(miss) > 30 else ''))
dup = sorted({m for m in marks if marks.count(m) > 1})
# одна страница может упоминаться дважды только в комментарии о дефекте
if dup:
    notes.append(f'страницы с несколькими метками (проверьте, что это комментарии о дефектах): {dup[:20]}')
if marks != sorted(marks):
    problems.append('метки страниц идут не по порядку')
notes.append(f'страниц с метками: {len(seen)} из {total}')

# --- ссылки на картинки
links = re.findall(r'!\[[^\]]*\]\(([^)]+)\)', text)
for l in sorted(set(links)):
    if not os.path.exists(os.path.join(out, l)):
        problems.append(f'нет файла картинки: {l}')

# --- таблицы
def md_table_shape(block):
    rows = [r for r in block if r.strip().startswith('|')]
    cells = [[c for c in r.strip().strip('|').split('|')] for r in rows]
    sep = [i for i, c in enumerate(cells) if all(re.fullmatch(r'\s*:?-{2,}:?\s*', x) for x in c)]
    if not sep:
        return None
    widths = {len(c) for i, c in enumerate(cells) if i not in sep}
    return len(cells) - sep[0] - 1, len(cells[0]), len(widths) > 1

def html_table_shape(html):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'razmetka'))
    from table_data import shape
    return shape(html)

def _old_html_table_shape(html):
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, flags=re.S | re.I)
    grid = []          # занятость ячеек с учётом rowspan/colspan
    data_rows = 0
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
            data_rows += 1
    widths = {len(g) for g in grid if g}
    return data_rows, (max(widths) if widths else 0), len(widths) > 1

n_tables = 0
for i, line in enumerate(lines):
    m = re.match(r'\s*Таблица\s+([^\s—-]+)', line)
    if not m or line.lstrip().startswith(('<!--', '|')) or re.search(r'Таблица\s+\S+\s*\)', line):
        continue
    # заголовок таблицы — строка, начинающаяся со слова «Таблица»; дальше ищем тело до следующего заголовка
    name = m.group(1).rstrip('.,;:')
    end = next((j for j in range(i + 1, min(len(lines), i + 400)) if re.match(r'\s*(Таблица\s+\S+|#{1,4}\s)', lines[j])), min(len(lines), i + 400))
    block = lines[i + 1:end]
    body = '\n'.join(block)
    has_md = any(b.strip().startswith('|') for b in block)
    has_html = '<table' in body.lower()
    if not (has_md or has_html):
        continue                      # упоминание таблицы в тексте, а не сама таблица
    n_tables += 1
    if not re.search(r'!\[[^\]]*\]\(img/[^)]*tabl[^)]*\)', body):
        problems.append(f'таблица {name}: нет вырезки из скана (img/…tabl…)')
    chk = re.search(r'<!--\s*таблица[^:]*:\s*строк\s+(\d+)\s*,\s*столбцов\s+(\d+)', body, flags=re.I)
    shape = html_table_shape(re.search(r'<table.*?</table>', body, flags=re.S | re.I).group(0)) if has_html and re.search(r'<table.*?</table>', body, flags=re.S | re.I) else md_table_shape(block)
    if shape is None:
        problems.append(f'таблица {name}: не удалось разобрать (нет строки-разделителя или не закрыт <table>)')
        continue
    r, c, ragged = shape
    if ragged:
        problems.append(f'таблица {name}: в строках разное число ячеек — вероятен сдвиг столбца')
    if not chk:
        problems.append(f'таблица {name}: нет проверочной строки <!-- таблица {name}: строк N, столбцов M -->')
    elif (int(chk.group(1)), int(chk.group(2))) != (r, c):
        problems.append(f'таблица {name}: в проверочной строке {chk.group(1)}×{chk.group(2)}, по факту {r}×{c}')
notes.append(f'таблиц: {n_tables}')

# --- формулы: после $$…$$ в пределах трёх строк должна быть картинка
n_f = 0
for i, line in enumerate(lines):
    if line.count('$$') >= 2 or (line.strip().startswith('$$') and line.count('$$') == 1 and any('$$' in x for x in lines[i + 1:i + 8])):
        n_f += 1
        near = '\n'.join(lines[i:i + 10])
        if not re.search(r'!\[[^\]]*\]\(img/[^)]*\)', near):
            num = re.search(r'\((\d+[\d.]*[а-яa-z]?)\)\s*$', line)
            problems.append(f'формула {num.group(1) if num else "без номера"} (строка {i + 1}): нет картинки из скана')
notes.append(f'формул: {n_f}')
if text.count('$$') % 2:
    problems.append('нечётное число «$$» — не закрыта формула')

# --- пометы сомнения
doubt = len(re.findall(r'\[\?[^\]]*\]', text)) + text.count('[нечитаемо]')
notes.append(f'помет сомнения: {doubt}')
if doubt and '## Сомнительные места' not in text:
    notes.append('раздела «## Сомнительные места» пока нет — добавить при сдаче')

print('\n'.join('  ' + n for n in notes))
if problems:
    print(f'ПРОБЛЕМЫ ({len(problems)}):')
    for p in problems[:60]:
        print('  ✗ ' + p)
    if len(problems) > 60:
        print(f'  … и ещё {len(problems) - 60}')
    sys.exit(1)
print('Проблем не найдено.')
