"""Read-only logic checks against the copied OCR implementation. No OCR models/downloads needed."""
import ast
import http.client
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import types
import warnings

HERE = Path(__file__).resolve().parent
RESULTS = []


def record(name, passed, detail):
    RESULTS.append(dict(name=name, passed=bool(passed), detail=detail))


def word(text, confidence=1.0):
    return dict(t=text, x0=10.0, y0=10.0, x1=90.0, y1=40.0,
                c=confidence, size=24.0, bold=False, it=False)


def checks():
    for path in sorted(HERE.glob('*.py')):
        if path.name == Path(__file__).name:
            continue
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', SyntaxWarning)
                compile(path.read_text(encoding='utf-8'), str(path), 'exec')
            record('syntax:' + path.name, True, 'Python source compiles')
        except Exception as exc:
            record('syntax:' + path.name, False, str(exc))

    import engine as E
    import cells as C
    import ocr as O

    # Extract evaluator functions without its stdout rewrapping and engine side effects.
    tree = ast.parse((HERE / 'evaluate.py').read_text(encoding='utf-8'))
    body = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ImportFrom))]
    body += [n for n in tree.body if isinstance(n, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id in ('NUM', 'WORD') for t in n.targets)]
    ev = types.ModuleType('audit_evaluator')
    import re
    ev.re = re
    exec(compile(ast.Module(body=body, type_ignores=[]), 'evaluate.py', 'exec'), ev.__dict__)

    original_ocr = O.ocr_words
    try:
        O.ocr_words = lambda *a, **kw: [word('1,8')]
        primary = [word('1,3')]
        stats = E.crosscheck(primary, None, [], strict=True)
        record('crosscheck_conflicting_numbers', primary[0]['t'] == '1,3'
               and primary[0]['c'] < .8 and primary[0].get('alt') == '1,8'
               and stats['flagged'] == 1, dict(word=primary[0], stats=stats))

        O.ocr_words = lambda *a, **kw: []
        primary = [word('1,3')]
        stats = E.crosscheck(primary, None, [], strict=True)
        record('crosscheck_unconfirmed_foreign_layer', primary[0]['c'] < .8,
               dict(confidence=primary[0]['c'], stats=stats))

        O.ocr_words = lambda *a, **kw: [word('5')]
        primary = [word('-5')]
        stats = E.crosscheck(primary, None, [], strict=True)
        record('crosscheck_sign_difference', primary[0]['c'] < .8,
               dict(confidence=primary[0]['c'], stats=stats))

        def second_opinion(*args, **kwargs):
            return [word('1,8')]
        O.ocr_words = second_opinion
        primary = [word('1,3')]
        stats = O.vote_numbers(None, primary)
        record('vote_preserves_original_on_disagreement', primary[0]['t'] == '1,3'
               and primary[0]['c'] < .8, dict(word=primary[0], stats=stats))
    finally:
        O.ocr_words = original_ocr

    a = [word('1'), dict(word('2'), y0=60., y1=90.)]
    b = [word('2'), dict(word('1'), y0=60., y1=90.)]
    stats = C.compare_cell(a, b)
    record('cell_detects_reversed_vertical_order', any(w['c'] < .8 for w in a),
           dict(stats=stats, confidences=[w['c'] for w in a]))

    score = ev.score_page('Значение -5', 'Значение 5')
    record('evaluator_counts_sign_error', score['wrong_unflagged'] >= 1, score)
    ref = '| a | b |\n|---|---|\n| 10 | 20 |'
    moved = '| a | b |\n|---|---|\n| 20 | 10 |'
    score = ev.score_page(ref, moved)
    record('evaluator_counts_both_misplaced_cells', score['wrong_unflagged'] == 2, score)

    html = '<table><thead><tr><th rowspan="2">n</th><th>x</th></tr>' \
           '<tr></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    shape = E.html_shape(html)
    record('table_counts_only_tbody_rows', shape == (1, 2), dict(shape=shape))

    server_tree = ast.parse((HERE / 'server.py').read_text(encoding='utf-8'))
    handler = next(n for n in server_tree.body if isinstance(n, ast.ClassDef) and n.name == 'H')
    record('handler_has_host_validation', any(isinstance(n, ast.Constant)
           and n.value == 'Host' for n in ast.walk(handler)), 'Host header must be validated before routing')

    # Start a private test server with isolated token/inbox in this audit copy.
    env = dict(os.environ, RAZMETKA_PORT='18865', PYTHONDONTWRITEBYTECODE='1')
    log = (HERE / 'audit-server.log').open('w', encoding='utf-8')
    proc = subprocess.Popen([sys.executable, '-B', '-W', 'ignore', 'server.py'],
                            cwd=HERE, env=env, stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 15
        while True:
            try:
                conn = http.client.HTTPConnection('127.0.0.1', 18865, timeout=2)
                conn.request('GET', '/api/ping', headers={'Host': 'attacker.example'})
                response = conn.getresponse()
                status = response.status
                response.read()
                conn.close()
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(.2)
        record('http_rejects_foreign_host', status == 403, dict(status=status))

        conn = http.client.HTTPConnection('127.0.0.1', 18865, timeout=3)
        conn.request('OPTIONS', '/api/docs', headers={'Origin': 'https://bit-exp.ru',
                     'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'X-Token'})
        response = conn.getresponse()
        allowed = response.getheader('Access-Control-Allow-Origin')
        status = response.status
        response.read()
        conn.close()
        record('http_allows_new_https_site', status == 204 and allowed == 'https://bit-exp.ru',
               dict(status=status, allow_origin=allowed))

        conn = http.client.HTTPConnection('127.0.0.1', 18865, timeout=3)
        conn.request('OPTIONS', '/api/docs', headers={'Origin': 'http://c.bit-exp.ru'})
        response = conn.getresponse()
        status = response.status
        response.read()
        conn.close()
        record('http_rejects_old_insecure_site', status == 403, dict(status=status))
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        log.close()


if __name__ == '__main__':
    checks()
    target = HERE / 'audit-checks.json'
    target.write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2), encoding='utf-8')
    for r in RESULTS:
        print(('PASS ' if r['passed'] else 'FAIL ') + r['name'])
    print(f"Checks: {len(RESULTS)}; failed: {sum(not r['passed'] for r in RESULTS)}")
