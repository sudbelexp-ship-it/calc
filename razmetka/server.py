"""Локальный сервер «Разметка документов и OCR».

Слушает только 127.0.0.1. Панель открывается на сайте (c.bit-exp.ru/razmetka.html) или с этого же сервера (http://127.0.0.1:8765/).
Все файлы и распознавание остаются на этом компьютере. Запуск: start.bat
"""
import os, sys, re, json, secrets, threading, traceback, time, mimetypes, shutil, subprocess
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import engine as E

PORT = int(os.environ.get('RAZMETKA_PORT', '8765'))
VERSION = '2.0-test'
MAX_UPLOAD_BYTES = 256 * 1024 * 1024
MAX_JSON_BYTES = 4 * 1024 * 1024
ALLOWED_HOSTS = {f'127.0.0.1:{PORT}', f'localhost:{PORT}'}
ALLOWED_ORIGINS = {'https://bit-exp.ru', 'https://c.bit-exp.ru', 'https://sudbelexp-ship-it.github.io',
                   f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'}
ALLOWED_ORIGINS |= {o for o in os.environ.get('RAZMETKA_ORIGINS', '').split(',') if o}
TOKEN_FILE = HERE / 'token.txt'
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(18), encoding='utf-8')
TOKEN = TOKEN_FILE.read_text(encoding='utf-8').strip()
INBOX = HERE / 'inbox'
PANEL = HERE / 'panel' / 'razmetka.html'

JOBS = {}
JOBLOCK = threading.Lock()
WORK = threading.Lock()   # распознавание — по одному заданию (движок OCR не потокобезопасен)


def new_job(kind, doc, fn):
    jid = secrets.token_hex(4)
    job = {'id': jid, 'kind': kind, 'doc': doc, 'state': 'queued', 'done': 0, 'total': 0, 'msg': '', 'error': None, 'cancel': False, 'result': None, 't0': time.time()}
    with JOBLOCK:
        JOBS[jid] = job

    def run():
        with WORK:
            job['state'] = 'running'
            try:
                job['result'] = fn(job)
                job['state'] = 'cancelled' if job['cancel'] else 'done'
            except E.Cancelled:
                job['state'] = 'cancelled'
            except Exception as e:
                job['state'] = 'error'
                job['error'] = f'{type(e).__name__}: {e}'
                traceback.print_exc()
    threading.Thread(target=run, daemon=True).start()
    return job


def progress_cb(job):
    def cb(i, n, msg):
        job['done'], job['total'], job['msg'] = i, n, msg
    return cb


class H(BaseHTTPRequestHandler):
    server_version = 'Razmetka/' + VERSION
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *a):
        pass

    # ---------- общие
    def host_ok(self):
        hosts = self.headers.get_all('Host', [])
        return len(hosts) == 1 and hosts[0].lower() in ALLOWED_HOSTS

    def origin_ok(self):
        o = self.headers.get('Origin')
        return o is None or o in ALLOWED_ORIGINS

    def cors(self):
        o = self.headers.get('Origin')
        if o and o in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'X-Token, Content-Type')
            self.send_header('Access-Control-Max-Age', '600')

    def send(self, code, body=b'', ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.cors()
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def authed(self, q):
        if not self.origin_ok():
            return False
        t = self.headers.get('X-Token') or (q.get('t') or [''])[0]
        return secrets.compare_digest(t, TOKEN)

    def body_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode('utf-8') or '{}')

    # ---------- маршруты
    def do_OPTIONS(self):
        if not self.host_ok() or not self.origin_ok():
            return self.send(403, {'error': 'origin'})
        self.send(204)

    def do_GET(self):
        self.route('GET')

    def do_POST(self):
        self.route('POST')

    def do_PUT(self):
        self.route('PUT')

    def do_DELETE(self):
        self.route('DELETE')

    def route(self, method):
        if not self.host_ok() or not self.origin_ok():
            return self.send(403, {'error': 'Host или Origin не разрешён'})
        if self.headers.get('Transfer-Encoding'):
            self.close_connection = True
            return self.send(400, {'error': 'Нужен Content-Length'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.close_connection = True
            return self.send(400, {'error': 'Неверный Content-Length'})
        limit = MAX_UPLOAD_BYTES if self.path.startswith('/api/upload') else MAX_JSON_BYTES
        if length < 0 or length > limit:
            self.close_connection = True
            return self.send(413, {'error': 'Файл превышает предел 256 МБ или JSON превышает 4 МБ'})
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = unquote(u.path)
        try:
            if method == 'GET' and path in ('/', '/index.html'):
                if not PANEL.exists():
                    return self.send(404, 'panel not found', 'text/plain; charset=utf-8')
                return self.send(200, PANEL.read_bytes(), 'text/html; charset=utf-8')
            if method == 'GET' and path == '/theme.js' and (HERE / 'panel' / 'theme.js').exists():
                return self.send(200, (HERE / 'panel' / 'theme.js').read_bytes(), 'application/javascript; charset=utf-8')
            if path == '/api/ping':
                # ping без токена: нужен для проверки связи; токен проверяется отдельно
                ok = self.authed(q)
                return self.send(200, {'ok': True, 'version': VERSION, 'auth': ok, 'root': str(E.ROOT)})
            if not self.authed(q):
                return self.send(401, {'error': 'нет доступа: неверный токен или адрес страницы'})
            if path.startswith('/files/'):
                return self.files(path[7:])
            if not path.startswith('/api/'):
                return self.send(404, {'error': 'not found'})
            return self.api(method, path[5:], q)
        except FileNotFoundError as e:
            self.send(404, {'error': str(e)})
        except Exception as e:
            traceback.print_exc()
            self.send(500, {'error': f'{type(e).__name__}: {e}'})

    def files(self, rel):
        parts = rel.split('/', 1)
        if len(parts) < 2:
            return self.send(404, {'error': 'not found'})
        d = E.docdir(parts[0]).resolve()
        f = (d / parts[1]).resolve()
        if d not in f.parents or not f.is_file():
            return self.send(404, {'error': 'not found'})
        ctype = mimetypes.guess_type(str(f))[0] or 'application/octet-stream'
        if f.suffix == '.md':
            ctype = 'text/markdown; charset=utf-8'
        self.send(200, f.read_bytes(), ctype)

    def api(self, method, p, q):
        seg = p.strip('/').split('/')
        if seg == ['docs'] and method == 'GET':
            return self.send(200, {'docs': E.list_docs()})
        if seg == ['browse'] and method == 'GET':
            return self.browse((q.get('path') or [''])[0])
        if seg == ['upload'] and method == 'PUT':
            name = re.sub(r'[\\/:*?"<>|]+', '_', (q.get('name') or ['file.pdf'])[0])
            INBOX.mkdir(exist_ok=True)
            n = int(self.headers.get('Content-Length') or 0)
            f = INBOX / name
            with open(f, 'wb') as out:
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(1 << 20, left))
                    if not chunk:
                        break
                    out.write(chunk)
                    left -= len(chunk)
            return self.send(200, {'path': str(f)})
        if seg == ['doc'] and method == 'POST':
            b = self.body_json()
            src = b.get('path', '')
            if not src or not Path(src).exists():
                return self.send(400, {'error': 'файл не найден: ' + src})
            name = E.safe_name(b.get('name') or Path(src).stem)

            def fn(job):
                job['msg'] = 'Нарезка страниц…'
                E.prep(src, name)
                job['msg'] = 'Готово'
                return {'name': name}
            return self.send(200, new_job('prep', name, fn))
        if seg[0] == 'job' and len(seg) >= 2:
            job = JOBS.get(seg[1])
            if not job:
                return self.send(404, {'error': 'нет такого задания'})
            if len(seg) == 3 and seg[2] == 'cancel':
                job['cancel'] = True
            return self.send(200, {k: v for k, v in job.items() if k != 'cancel'} | {'elapsed': round(time.time() - job['t0'], 1)})
        if seg[0] == 'doc' and len(seg) >= 2:
            name = seg[1]
            d = E.docdir(name)
            if not (d / 'progress.json').exists():
                return self.send(404, {'error': 'документ не найден'})
            rest = seg[2:]
            if not rest and method == 'GET':
                return self.send(200, E.doc_info(name))
            if rest == ['recognize'] and method == 'POST':
                b = self.body_json()
                pages, mode = b.get('pages') or [], b.get('mode', 'auto')

                def fn(job):
                    return E.recognize(name, pages, mode, progress=progress_cb(job), cancel=lambda: job['cancel'])
                return self.send(200, new_job('recognize', name, fn))
            if rest[:1] == ['page'] and len(rest) >= 2:
                n = int(rest[1])
                pm = d / 'pages_md' / f'p{n:03d}.md'
                flag = d / 'pages_md' / f'p{n:03d}.manual'
                if method == 'GET':
                    a = E.load_json(d / 'auto' / f'p{n:03d}.json')
                    return self.send(200, {'n': n, 'md': pm.read_text(encoding='utf-8') if pm.exists() else '', 'manual': flag.exists(),
                                           'auto': ({k: a[k] for k in ('source', 'w', 'h', 'figures')} | {'tables': [t['bbox'] for t in a['tables']], 'verify': a.get('verify')}) if a else None})
                if method == 'PUT':
                    b = self.body_json()
                    (d / 'pages_md').mkdir(exist_ok=True)
                    reviewed = d / 'pages_md' / f'p{n:03d}.reviewed'
                    if reviewed.exists():
                        reviewed.unlink()
                    pm.write_text(b.get('md', ''), encoding='utf-8')
                    flag.write_text('1', encoding='utf-8')
                    E.assemble(name)
                    return self.send(200, {'ok': True})
                if method == 'DELETE':
                    if flag.exists():
                        flag.unlink()
                    if (d / 'auto' / f'p{n:03d}.json').exists():
                        r = E.render_page(name, n)
                        pm.write_text(r['md'], encoding='utf-8')
                        E.assemble(name)
                    return self.send(200, {'ok': True})
            if rest == ['crop'] and method == 'POST':
                b = self.body_json()
                n, box, nm = int(b['page']), b['box'], re.sub(r'[^A-Za-z0-9._\-]+', '_', b.get('name') or 'ris_1')
                out, code = E.run_script('crop.py', d, n, *[f'{float(v):.4f}' for v in box], nm)
                return self.send(200 if code == 0 else 400, {'rel': f'img/p{n:03d}_{nm}.png', 'out': out})
            if rest == ['formula'] and method == 'POST':
                b = self.body_json()
                rel = str(b.get('rel', ''))
                if not re.fullmatch(r'img/p\d{3,}_formula_[A-Za-z0-9._-]+\.png', rel):
                    return self.send(400, {'error': 'Нужна вырезка формулы из этого документа'})
                path = (d / rel).resolve()
                if not path.is_relative_to((d / 'img').resolve()) or not path.is_file():
                    return self.send(400, {'error': 'Вырезка формулы не найдена'})
                if path.stat().st_size > 20 * 1024 * 1024:
                    return self.send(400, {'error': 'Вырезка формулы слишком большая'})
                def fn(job):
                    import formulas
                    return formulas.recognize(path)
                return self.send(200, new_job('formula', name, fn))
            if rest == ['check'] and method == 'POST':
                return self.send(200, {'out': E.do_check(name)})
            if rest == ['relcheck'] and method == 'POST':
                b = self.body_json()
                out = E.do_relcheck(name, b.get('table', '1'), b.get('rels') or ['--cols'])
                return self.send(200, {'out': out})
            if rest == ['meta'] and method == 'PUT':
                b = self.body_json()
                meta = E.load_json(d / 'meta.json') or {}
                meta['head'] = {k: str(b.get(k, ''))[:300] for k in ('обозначение', 'название', 'редакция', 'дата_введения')}
                E.save_json(d / 'meta.json', meta)
                E.assemble(name)
                return self.send(200, {'ok': True})
            if rest == ['assemble'] and method == 'POST':
                return self.send(200, E.assemble(name))
            if rest == ['done'] and method == 'POST':
                b = self.body_json()
                for n in b.get('pages', []):
                    n = int(n)
                    if not 1 <= n <= E.load_json(d / 'progress.json')['pages']:
                        return self.send(400, {'error': 'Неверная страница'})
                    pagefile = d / 'pages_md' / f'p{n:03d}.md'
                    if not pagefile.exists():
                        return self.send(400, {'error': 'Сначала распознайте и сохраните страницу'})
                    text = pagefile.read_text(encoding='utf-8').replace('[?LaTeX не сверен]<!-- latex-unverified -->', '')
                    pagefile.write_text(text, encoding='utf-8')
                    (d / 'pages_md' / f'p{n:03d}.manual').write_text('1', encoding='utf-8')
                    (d / 'pages_md' / f'p{n:03d}.reviewed').write_text('Проверена пользователем', encoding='utf-8')
                out, code = E.run_script('prep.py', '--done', d, *[int(x) for x in b.get('pages', [])])
                E.assemble(name)
                return self.send(200, {'out': out})
            if rest == ['open'] and method == 'POST':
                if os.name == 'nt':
                    os.startfile(str(d))
                return self.send(200, {'ok': True})
        self.send(404, {'error': 'not found'})

    def browse(self, path):
        p = Path(path) if path else Path.home()
        if not p.exists():
            return self.send(404, {'error': 'нет такой папки'})
        if p.is_file():
            p = p.parent
        items = []
        try:
            for c in sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
                if c.name.startswith(('.', '$')):
                    continue
                if c.is_dir():
                    items.append({'name': c.name, 'dir': True})
                elif c.suffix.lower() in ('.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff'):
                    items.append({'name': c.name, 'dir': False, 'size': c.stat().st_size})
        except PermissionError:
            pass
        drives = [f'{chr(l)}:\\' for l in range(65, 91) if os.path.exists(f'{chr(l)}:\\')] if os.name == 'nt' else ['/']
        return self.send(200, {'path': str(p), 'parent': str(p.parent) if p.parent != p else '', 'items': items, 'drives': drives})


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    url = f'http://127.0.0.1:{PORT}/#t={TOKEN}'
    print('=' * 60)
    print(' Разметка документов и OCR — локальный сервер')
    print(f' Панель на этом компьютере: {url}')
    print(f' Панель на сайте: https://bit-exp.ru/c/razmetka.html#t={TOKEN}&p={PORT}')
    print(' Окно не закрывайте, пока работаете с панелью (Ctrl+C — остановить).')
    print('=' * 60, flush=True)
    if '--open' in sys.argv:
        import webbrowser
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
