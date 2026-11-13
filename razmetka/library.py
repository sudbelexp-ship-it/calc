"""Persistent document library. Removing entries never deletes source or results."""
import hashlib
import json
import os
from pathlib import Path
import re
import threading

CATALOG=Path(__file__).with_name('library.json')
LOCK=threading.RLock()
RESULTS='Распознанные документы'


def state():
    default=dict(documents={},hidden=[],last_source='',last_output='',last_ids=[])
    for path in (CATALOG,CATALOG.with_suffix('.bak.json')):
        if not path.exists():continue
        try:
            loaded=json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(loaded.get('documents'),dict) or not isinstance(loaded.get('hidden',[]),list):continue
            result=dict(default,**loaded)
            if path!=CATALOG:result['warning']='Каталог восстановлен из резервной копии. При необходимости добавьте папку ещё раз: готовые результаты сохранятся.'
            return result
        except (ValueError,OSError,AttributeError):continue
    if CATALOG.exists():default['warning']='Каталог повреждён. Добавьте исходную папку ещё раз, чтобы найти готовые результаты на диске.'
    return default


def save(data):
    import engine as E
    if CATALOG.exists():
        try:
            old=json.loads(CATALOG.read_text(encoding='utf-8'))
            if isinstance(old.get('documents'),dict):E.save_json(CATALOG.with_suffix('.bak.json'),old)
        except (ValueError,OSError,AttributeError):pass
    E.save_json(CATALOG,{k:v for k,v in data.items() if k!='warning'})


def locate(name):
    entry=state()['documents'].get(name)
    return Path(entry['output']) if entry else None


def fingerprint(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block:=stream.read(1024*1024):h.update(block)
    return h.hexdigest()


def check_source(entry):
    path=Path(entry['source'])
    before=(path.stat().st_size,path.stat().st_mtime_ns)
    if fingerprint(path)!=entry['sha256'] or (path.stat().st_size,path.stat().st_mtime_ns)!=before:
        raise ValueError('PDF изменился. Добавьте его заново: '+str(path))
    return before


def receive_upload(stream,length,name,inbox):
    """Preserve uploaded versions and reuse identical copies without touching them."""
    import tempfile
    inbox=Path(inbox).resolve();inbox.mkdir(parents=True,exist_ok=True)
    name=re.sub(r'[\\/:*?"<>|]+','_',name).strip(' .') or 'file.pdf'
    temporary=None;digest=hashlib.sha256()
    try:
        with tempfile.NamedTemporaryFile(dir=inbox,suffix='.tmp',delete=False) as out:
            temporary=Path(out.name);remaining=length
            if remaining<=0:raise ValueError('Пустой файл')
            while remaining:
                chunk=stream.read(min(1024*1024,remaining))
                if not chunk:raise ValueError('Загрузка оборвалась; повторите отправку файла')
                out.write(chunk);digest.update(chunk);remaining-=len(chunk)
            out.flush();os.fsync(out.fileno())
        target=inbox/digest.hexdigest()/name
        if not target.resolve().is_relative_to(inbox):raise ValueError('Неверное имя файла')
        target.parent.mkdir(exist_ok=True)
        if not target.exists() or target.stat().st_size!=length or fingerprint(target)!=digest.hexdigest():
            os.replace(temporary,target)
        return target
    finally:
        if temporary is not None:temporary.unlink(missing_ok=True)


def valid_page(data,number):
    import math
    def box(values):return isinstance(values,(list,tuple)) and len(values)==4 and all(isinstance(v,(int,float)) and math.isfinite(v) for v in values)
    def words(items):return isinstance(items,list) and all(isinstance(w,dict) and isinstance(w.get('t'),str) and box([w.get(k) for k in ('x0','y0','x1','y1')]) for w in items)
    if not isinstance(data,dict) or data.get('page')!=number or not words(data.get('words')):return False
    if not isinstance(data.get('source'),str) or not all(isinstance(data.get(k),(int,float)) and data[k]>0 for k in ('w','h')):return False
    if not isinstance(data.get('tables'),list) or not isinstance(data.get('figures'),list):return False
    for table in data['tables']:
        if not isinstance(table,dict) or not all(k in table for k in ('nr','nc','xs','ys','bbox','cells')) or not isinstance(table['cells'],list):return False
        if not all(isinstance(c,dict) and all(k in c for k in ('r','c','rs','cs')) and box(c.get('bbox')) and words(c.get('words')) for c in table['cells']):return False
    return all(box(f) for f in data['figures'])


def register(source, output='', label='', recursive=False):
    import engine as E
    if not str(source).strip():raise ValueError('Выберите исходный PDF или папку')
    source=Path(source).expanduser().resolve()
    if not source.exists():raise ValueError('Исходный файл или папка не найдены')
    root=source if source.is_dir() else source.parent
    target=Path(output).expanduser().resolve() if output else root/RESULTS
    if target.exists() and not target.is_dir():raise ValueError('Место сохранения должно быть папкой')
    files=sorted(source.rglob('*') if recursive else source.glob('*')) if source.is_dir() else [source]
    files=[p for p in files if p.is_file() and p.suffix.lower()=='.pdf' and not (source.is_dir() and target!=root and p.resolve().is_relative_to(target))]
    if not files:raise ValueError('В выбранной папке нет PDF')
    imported=[]
    with LOCK:
        data=state()
        for path in files:
            path=path.resolve();digest=fingerprint(path)
            identity=hashlib.sha256((os.path.normcase(str(path))+'\0'+os.path.normcase(str(target))+'\0'+digest).encode()).hexdigest()[:16]
            name='doc_'+identity
            stem=E.safe_name(label or path.stem) if re.search('[A-Za-z0-9]',label or path.stem) else 'document'
            folder=target/(stem[:64]+'_'+identity[:8])
            if not folder.exists() and target.exists():
                for prior in target.glob('*_'+identity[:8]):
                    meta=E.load_json(prior/'meta.json') or {}
                    if meta.get('source_sha256')==digest and meta.get('source')==str(path):
                        folder=prior
                        break
            entry=data['documents'].get(name) or dict(source=str(path),output=str(folder),label=label or path.stem,sha256=digest)
            entry['removed']=False
            data['documents'][name]=entry
            imported.append(name)
        data.update(last_source=str(source),last_output=str(target),last_output_setting=str(output),last_ids=imported)
        save(data)
    return dict(ids=imported,output=str(target),count=len(imported))


def remove(name):
    with LOCK:
        data=state()
        if name in data['documents']:data['documents'][name]['removed']=True
        elif name not in data['hidden']:data['hidden'].append(name)
        save(data)


def entries():
    return [(name,e) for name,e in state()['documents'].items() if not e.get('removed')]


def initialize(name, entry):
    import engine as E
    import pymupdf
    d=Path(entry['output']);d.mkdir(parents=True,exist_ok=True)
    if not (d/'.gitignore').exists():E.save_text(d/'.gitignore','*\n')
    for sub in ('pages','view','img','auto','pages_md'):(d/sub).mkdir(exist_ok=True)
    pr=E.load_json(d/'progress.json')
    meta=E.load_json(d/'meta.json') or {}
    if meta.get('source_sha256') and meta['source_sha256']!=entry['sha256']:
        raise ValueError('Результат относится к другой версии PDF')
    if not pr:
        with pymupdf.open(entry['source']) as pdf:count=len(pdf)
        E.save_json(d/'progress.json',dict(pages=count,done=[],source=entry['source']))
    E.save_json(d/'meta.json',dict(meta,source=entry['source'],kind='pdf',source_sha256=entry['sha256']))


def run(ids,mode='auto',progress=None,cancel=None):
    import engine as E
    results=[]
    if not any(name in dict(entries()) for name in ids):raise ValueError('В очереди нет активных документов')
    with LOCK:
        data=state();data['last_mode']=mode;save(data)
    with E.OCR.RES.worker():
        for di,name in enumerate(ids,1):
            entry=state()['documents'].get(name)
            if not entry or entry.get('removed'):continue
            if cancel and cancel():raise E.Cancelled()
            source=Path(entry['source'])
            stamp=check_source(entry)
            initialize(name,entry)
            d=Path(entry['output']);N=E.load_json(d/'progress.json')['pages']
            for n in range(1,N+1):
                if cancel and cancel():raise E.Cancelled()
                if (source.stat().st_size,source.stat().st_mtime_ns)!=stamp:raise ValueError('PDF изменился во время обработки')
                if progress:progress(n-1,N,f'{di}/{len(ids)} · {entry["label"]} · страница {n}/{N}')
                cached=E.load_json(d/'auto'/f'p{n:03d}.json')
                valid=valid_page(cached,n)
                md=d/'pages_md'/f'p{n:03d}.md'
                manual=(d/'pages_md'/f'p{n:03d}.manual').exists()
                if valid or (manual and md.exists()):
                    recovered=not md.exists()
                    if recovered:
                        E.ensure_page(name,n)
                        E.save_text(md,E.render_page(name,n)['md'])
                    pr=E.load_json(d/'progress.json')
                    if n not in pr.get('done',[]):
                        pr['done']=sorted(set(pr.get('done',[]))|{n});E.save_json(d/'progress.json',pr)
                    if recovered or not (d/'document.md').exists():E.assemble(name)
                    continue
                E.recognize(name,[n],mode,cancel=cancel)
                pr=E.load_json(d/'progress.json');pr['done']=sorted(set(pr.get('done',[]))|{n});E.save_json(d/'progress.json',pr)
            if progress:progress(N,N,f'{entry["label"]}: готово')
            E.assemble(name)
            results.append(dict(name=name,output=str(d)))
    return results
