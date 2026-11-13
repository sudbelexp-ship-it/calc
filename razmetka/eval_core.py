"""Numeric evaluation by table id, row, column and token, with signs retained."""
from collections import Counter
from difflib import SequenceMatcher
import re
from numeric import tokens
from table_data import tables_in


def split_pages(md):
    parts = re.split(r'<!--\s*стр\.\s*(\d+)[^>]*-->', md.split('## Сомнительные места')[0])
    out = {}
    for i in range(1, len(parts), 2):
        out[int(parts[i])] = out.get(int(parts[i]), '') + parts[i + 1]
    return out


def strip(t):
    from html import unescape
    visible = re.sub(r'<!--.*?-->|!\[[^\]]*\]\([^)]*\)', ' ', t, flags=re.S)
    return unescape(re.sub(r'</?(?:table|thead|tbody|tfoot|tr|th|td|br|sup|sub|i|b|strong|em|p|a|span|div)\b[^>]*>', ' ', visible, flags=re.I))


def score_tokens(ref, actual, exact=True):
    result = Counter(ref=len(ref), found=len(actual), correct=0, wrong=0,
                     wrong_unflagged=0, missing=0, flagged_correct=0,
                     flagged=sum(f for x, f in actual))
    if exact:
        for i, (value, flagged) in enumerate(actual):
            if i < len(ref) and value == ref[i][0]:
                result['correct'] += 1
                result['flagged_correct'] += flagged
            else:
                result['wrong'] += 1
                result['wrong_unflagged'] += not flagged
        result['missing'] = max(0, len(ref) - len(actual))
    else:
        sm = SequenceMatcher(None, [x for x, f in ref], [x for x, f in actual], autojunk=False)
        for tag, a, b, c, d in sm.get_opcodes():
            if tag == 'equal':
                result['correct'] += d - c
                result['flagged_correct'] += sum(f for x, f in actual[c:d])
            else:
                result['wrong'] += d - c
                result['wrong_unflagged'] += sum(not f for x, f in actual[c:d])
                result['missing'] += max(0, (b - a) - (d - c))
    return result


def evaluate_text(reference, actual, pages=None):
    rt, at = tables_in(reference), tables_in(actual)
    def index(tables):
        out = {}
        for tb in tables:
            for i, row in enumerate(tb['rows']):
                for j, cell in enumerate(row):
                    out[(tb['name'], tb['start'] + i + 1, j + 1)] = (cell['page'], tokens(cell['text']))
        return out
    ri, ai = index(rt), index(at)
    total, mismatches = score_tokens([], []), []
    for key in sorted(set(ri) | set(ai)):
        page = ri.get(key, ai.get(key))[0]
        if pages and page not in pages:
            continue
        a, b = ri.get(key, (page, []))[1], ai.get(key, (page, []))[1]
        score = score_tokens(a, b)
        total.update(score)
        if score['wrong'] or score['missing']:
            mismatches.append(dict(table=key[0], row=key[1], col=key[2], page=page,
                                   reference_tokens=a, actual_tokens=b, **dict(score)))
    table_total = dict(total)
    prose_total = score_tokens([], [])
    def prose(text, tables):
        for tb in reversed(tables):
            a, b = tb['span']
            text = text[:a] + '\n'.join(re.findall(r'<!--\s*стр\.[^>]*-->', text[a:b])) + text[b:]
        return split_pages(text)
    mr, ar = prose(reference, rt), prose(actual, at)
    for page in sorted(set(mr) | set(ar)):
        if not pages or page in pages:
            score=score_tokens(tokens(strip(mr.get(page, ''))), tokens(strip(ar.get(page, ''))), exact=False)
            total.update(score)
            prose_total.update(score)
    return dict(total=dict(total), mismatches=mismatches,
                table_total=table_total, prose_total=dict(prose_total),
                metric='table/name/row/column/token; prose sequence alignment; signs retained')


def score_page(man, auto):
    return evaluate_text('<!-- стр. 1 -->\n' + man, '<!-- стр. 1 -->\n' + auto)['total']
