"""Browser-free queue. python razmetka/batch.py normy/* --mode precise [--force]"""
import argparse
import glob
import json
import logging
from pathlib import Path
import sys
import engine as E


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('documents', nargs='+')
    parser.add_argument('--mode', choices=('auto', 'ocr', 'precise'), default='precise')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--log', default='batch.log')
    args = parser.parse_args(argv)
    log = logging.getLogger('batch')
    log.setLevel(logging.INFO)
    log.addHandler(logging.FileHandler(args.log, encoding='utf-8'))
    folders = []
    for pattern in args.documents:
        for item in glob.glob(pattern):
            path = Path(item).resolve()
            if (path / 'progress.json').exists() and path not in folders:
                folders.append(path)
    if not folders:
        parser.error('Не найдены папки с progress.json')
    failures = 0
    for folder in folders:
        try:
            E.NORMY = folder.parent
            meta=E.load_json(folder/'meta.json') or {}
            if meta.get('source_sha256'):
                import library
                library.check_source({'source':meta['source'],'sha256':meta['source_sha256']})
            pr = E.load_json(folder / 'progress.json')
            todo = []
            for n in range(1, pr['pages'] + 1):
                auto = folder / 'auto' / f'p{n:03d}.json'
                valid = E.load_json(auto)
                if args.force or not valid or valid.get('layer_error') and not valid.get('words'):
                    todo.append(n)
            log.info('%s: %s pages remaining', folder.name, len(todo))
            print(f'{folder.name}: осталось {len(todo)}', flush=True)
            if todo:
                E.recognize(folder.name, todo, args.mode,
                            progress=lambda i,n,m: (log.info('%s %s/%s %s', folder.name,i,n,m), print(m,flush=True)))
            else:
                # A process can die after committing auto JSON but before writing Markdown.
                (folder / 'pages_md').mkdir(exist_ok=True)
                for n in range(1, pr['pages'] + 1):
                    md = folder / 'pages_md' / f'p{n:03d}.md'
                    if not md.exists():
                        result = E.render_page(folder.name, n)
                        if result:
                            md.write_text(result['md'], encoding='utf-8')
                pr['done'] = sorted(set(pr.get('done', [])) | {
                    n for n in range(1, pr['pages'] + 1)
                    if (folder / 'pages_md' / f'p{n:03d}.md').exists()})
                E.save_json(folder / 'progress.json', pr)
                E.assemble(folder.name)
            log.info('%s complete; report.md saved', folder.name)
        except KeyboardInterrupt:
            log.warning('Interrupted; completed pages retained')
            return 130
        except Exception:
            failures += 1
            log.exception('%s failed', folder.name)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
