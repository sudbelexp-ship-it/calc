"""Пересчёт числовой таблицы по соотношениям между столбцами.

  python relcheck.py <папка документа> "<номер таблицы>" --cols          — показать столбцы и первые строки
  python relcheck.py <папка документа> "<номер таблицы>" "<соотношение>" ["<соотношение>" ...]

Соотношение:  <левая часть> ~ <правая часть> [: допуск в процентах, по умолчанию 1.5]
Столбцы — c1, c2, … (слева направо; объединённые ячейки развёрнуты). Доступны sqrt, pi, abs, min, max.

Пример для таблицы 1 ГОСТ 8509-93 (c2 — b, c6 — F, c7 — Ix, c9 — ix, c17 — масса):
  python relcheck.py normy/GOST_8509-93 1 "c17 ~ 0.785*c6" "c9 ~ sqrt(c7/c6)" "c10 + c12 ~ 2*c7 : 1"

Скрипт ничего не исправляет: он печатает строки, где соотношение не выполняется. Каждую такую строку
нужно открыть на скане и решить — это ошибка распознавания (исправить) или опечатка издания (оставить
как напечатано и записать в «Сомнительные места»).
"""
import sys, os, re, glob, math
for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding='utf-8', errors='replace')


def strip(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html)).strip()


def find_table(text, name):
    """Возвращает (заголовки столбцов, строки данных) таблицы с данным номером."""
    text = re.sub(r'\[\?([^\]]*)\]', r'\1', text)
    for m in re.finditer(r'^\s*Таблица\s+' + re.escape(name) + r'(?![\w.])[^\n]*$', text, flags=re.M):
        rest = text[m.end():]
        nxt = re.search(r'^\s*Таблица\s+\S', rest, flags=re.M)
        block = rest[:nxt.start()] if nxt else rest
        h = re.search(r'<table.*?</table>', block, flags=re.S | re.I)
        if h:
            return html_rows(h.group(0))
        md = [l for l in block.split('\n') if l.strip().startswith('|')]
        if md:
            cells = [[c.strip() for c in l.strip().strip('|').split('|')] for l in md]
            sep = next((i for i, c in enumerate(cells) if all(re.fullmatch(r':?-{2,}:?', x) for x in c)), 0)
            return cells[sep - 1] if sep else [], cells[sep + 1:]
    return None


def html_rows(html):
    head, data, carry = [], [], {}
    body = re.search(r'<tbody.*?</tbody>', html, flags=re.S | re.I)
    hrows = re.findall(r'<tr[^>]*>(.*?)</tr>', html[:body.start()] if body else '', flags=re.S | re.I)
    for r in hrows[-1:]:
        head = [strip(c) for c in re.findall(r'<th[^>]*>(.*?)</th>', r, flags=re.S | re.I)]
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', body.group(0) if body else html, flags=re.S | re.I):
        cells = re.findall(r'<td([^>]*)>(.*?)</td>', r, flags=re.S | re.I)
        if not cells:
            continue
        row, it, c = [], iter(cells), 0
        while True:
            if c in carry and carry[c][0] > 0:
                row.append(carry[c][1]); carry[c][0] -= 1; c += 1; continue
            try:
                attrs, val = next(it)
            except StopIteration:
                break
            val = strip(val)
            rs = re.search(r'rowspan\s*=\s*"?(\d+)', attrs, flags=re.I)
            cs = re.search(r'colspan\s*=\s*"?(\d+)', attrs, flags=re.I)
            for _ in range(int(cs.group(1)) if cs else 1):
                row.append(val)
                if rs and int(rs.group(1)) > 1:
                    carry[c] = [int(rs.group(1)) - 1, val]
                c += 1
        data.append(row)
    return head, data


def num(s):
    s = re.sub(r'\[\?([^\]]*)\]', r'\1', s)
    s = s.replace('−', '-').replace('−', '-').replace(' ', '').replace(' ', '').replace(',', '.')
    m = re.fullmatch(r'[-+]?\d+(\.\d+)?', s)
    return float(s) if m else None


SAFE = {'sqrt': math.sqrt, 'pi': math.pi, 'abs': abs, 'min': min, 'max': max, '__builtins__': {}}

if __name__ == '__main__':
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    out, name, rels = sys.argv[1], sys.argv[2], sys.argv[3:]
    text = '\n'.join(open(f, encoding='utf-8').read() for f in sorted(glob.glob(os.path.join(out, '*.md'))))
    found = find_table(text, name)
    if not found:
        sys.exit(f'Таблица {name} не найдена (нужна строка-заголовок «Таблица {name}» и тело таблицы под ней)')
    head, rows = found
    if rels == ['--cols']:
        print(f'Таблица {name}: строк {len(rows)}')
        if head:
            print('нижняя строка шапки:', ' | '.join(head))
        for r in rows[:3]:
            print('  ' + '   '.join(f'c{i + 1}={v}' for i, v in enumerate(r)))
        sys.exit(0)
    parsed = []
    for rel in rels:
        m = re.fullmatch(r'(.+?)~(.+?)(?::\s*([\d.,]+)\s*%?)?\s*', rel)
        if not m:
            sys.exit(f'Не понял соотношение: {rel}\nФормат: "c17 ~ 0.785*c6 : 1.5"')
        for part in m.group(1, 2):
            if re.search(r'[^\w\s.+\-*/(),]|__', part):
                sys.exit(f'Недопустимые символы в соотношении: {rel}')
        parsed.append((rel, compile(m.group(1).strip(), 'l', 'eval'), compile(m.group(2).strip(), 'r', 'eval'), float((m.group(3) or '1.5').replace(',', '.'))))
    bad = skipped = 0
    for i, r in enumerate(rows):
        env = dict(SAFE, **{f'c{j + 1}': num(v) for j, v in enumerate(r)})
        for rel, lc, rc, tol in parsed:
            try:
                a, b = eval(lc, env), eval(rc, env)
            except (TypeError, ZeroDivisionError, ValueError, NameError):
                skipped += 1      # в строке нет числа в нужном столбце (прочерк, текст)
                continue
            if a is None or b is None:
                skipped += 1
                continue
            if abs(a - b) > tol / 100 * max(abs(b), 1e-12):
                bad += 1
                print(f'✗ строка {i + 1} [{" ".join(r[:3])}]: {rel.split(":")[0].strip()} → {a:.5g} против {b:.5g} (расхождение {abs(a - b) / max(abs(b), 1e-12) * 100:.1f} %)')
    print(f'Таблица {name}: строк {len(rows)}, соотношений {len(parsed)}, не выполняется {bad}' + (f', пропущено (нет числа) {skipped}' if skipped else ''))
    if bad:
        print('Каждую строку с ✗ откройте на скане: ошибку распознавания исправьте, опечатку издания оставьте и запишите в «Сомнительные места».')
    sys.exit(1 if bad else 0)
