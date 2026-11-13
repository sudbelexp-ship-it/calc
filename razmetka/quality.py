"""Relations and morning reports. Expected values never replace source values."""
import ast
import json
import math
import operator
from pathlib import Path
import re
from numeric import scalar
from table_data import tables_in

OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
       ast.Div: operator.truediv, ast.Pow: operator.pow}


def expression(text, env):
    def visit(n):
        if isinstance(n, ast.Expression):
            return visit(n.body)
        if isinstance(n, ast.Constant) and type(n.value) in (float, int):
            return n.value
        if isinstance(n, ast.Name):
            return env[n.id]
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
            return -visit(n.operand) if isinstance(n.op, ast.USub) else visit(n.operand)
        if isinstance(n, ast.BinOp) and type(n.op) in OPS:
            return OPS[type(n.op)](visit(n.left), visit(n.right))
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in ('sqrt', 'abs', 'min', 'max') and not n.keywords:
            return {'sqrt': math.sqrt, 'abs': abs, 'min': min, 'max': max}[n.func.id](*[visit(a) for a in n.args])
        raise ValueError('Unsupported relation syntax')
    return visit(ast.parse(text.strip(), mode='eval'))


def relation_checks(text):
    rules = json.loads(Path(__file__).with_name('relations.json').read_text(encoding='utf-8'))
    designation = re.search(r'^обозначение:\s*(.+)$', text, re.M)
    key = designation[1].replace('—', '-').replace('–', '-').strip() if designation else ''
    config = rules.get(key, {})
    issues = []
    for table in tables_in(text):
        spec = config.get(table['name'])
        if not spec:
            continue
        if table['width'] != spec['columns']:
            issues.append(dict(page=table['page'], table=table['name'], kind='columns',
                               message=f"ожидалось {spec['columns']} столбцов, найдено {table['width']}; пересчёт пропущен"))
            continue
        for i, row in enumerate(table['rows'], 1 + table['start']):
            env = {f'c{j + 1}': scalar(c['text']) for j, c in enumerate(row)}
            for rule in spec['rules']:
                formula, _, tolerance = rule.partition(':')
                left, right = formula.split('~')
                try:
                    a, b = expression(left, env), expression(right, env)
                    tol = float(tolerance or '1.5') / 100
                    if not math.isfinite(a) or not math.isfinite(b):
                        raise ValueError('non-finite value')
                    if abs(a - b) <= tol * max(abs(b), 1e-12):
                        continue
                except (ValueError, TypeError, KeyError, ZeroDivisionError, OverflowError):
                    continue
                issues.append(dict(page=row[0]['page'] if row else table['page'], table=table['name'], row=i,
                                   kind='relation', rule=rule, actual=a, expected=b,
                                   message=f'строка {i}: {formula.strip()}, получено {a:.6g}, ожидается {b:.6g}'))
    return issues


def run_relcheck_cli(folder, text, runner):
    """Execute the skill's checker too; keep its diagnostics with private page data."""
    rules=json.loads(Path(__file__).with_name('relations.json').read_text(encoding='utf-8'))
    designation=re.search(r'^обозначение:\s*(.+)$',text,re.M)
    key=designation[1].replace('—','-').replace('–','-').strip() if designation else ''
    config=rules.get(key,{})
    records=[]
    widths={t['name']:t['width'] for t in tables_in(text)}
    for name,spec in config.items():
        if widths.get(name)!=spec['columns']:
            continue
        output,code=runner('relcheck.py',folder,name,*spec['rules'])
        records.append(dict(table=name,returncode=code,output=output))
        if code not in (0,1):
            raise RuntimeError(f'relcheck.py failed for table {name}: {output}')
    target=Path(folder)/'auto'
    target.mkdir(exist_ok=True)
    (target/'relcheck.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
    return records


def report(folder, text, issues):
    folder = Path(folder)
    progress = json.loads((folder / 'progress.json').read_text(encoding='utf-8'))
    pages = []
    for n in range(1, progress['pages'] + 1):
        path = folder / 'pages_md' / f'p{n:03d}.md'
        t = path.read_text(encoding='utf-8') if path.exists() else ''
        counts = len(re.findall(r'\[\?[^\]]*\]', t))
        unread = len(re.findall(r'\[нечитаемо[^\]]*\]', t))
        rel = sum(x['page'] == n for x in issues)
        reviewed = (folder / 'pages_md' / f'p{n:03d}.reviewed').exists()
        pages.append(dict(page=n, doubts=counts, unreadable=unread, relations=rel,
                          recognized=path.exists(), reviewed=reviewed))
    clean = sum(p['recognized'] and not (p['doubts'] or p['unreadable'] or p['relations']) for p in pages)
    lines = ['# Отчёт проверки', '', f"Страниц всего: {progress['pages']}",
             f'Страниц без пометок: {clean}', f"Пометок [?…]: {sum(p['doubts'] for p in pages)}", '',
             'Автоматические числа помечены до визуальной проверки. Совпадение OCR-моделей не снимает пометку.', '',
             '| Страница | Сомнений | Нечитаемо | Расхождений | Проверена человеком |', '|---|---:|---:|---:|---|']
    for p in sorted(pages, key=lambda p: (p['recognized'], -(p['relations'] * 10 + p['unreadable'] * 5 + p['doubts']))):
        lines.append(f"| {p['page']} | {p['doubts']} | {p['unreadable']} | {p['relations']} | {'да' if p['reviewed'] else 'нет'} |")
    lines += ['', '## Расхождения по соотношениям', '']
    lines += [f"- Стр. {x['page']}, таблица {x['table']}: {x['message']}. Значение не изменено." for x in issues] or ['нет']
    (folder / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (folder / 'quality.json').write_text(json.dumps(dict(pages=pages, relations=issues), ensure_ascii=False, indent=2), encoding='utf-8')
