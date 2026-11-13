"""Optional local ONNX formula OCR. Inference never downloads anything."""
import hashlib
import json
from pathlib import Path
import resources as RES

HERE=Path(__file__).resolve().parent
MODELS=HERE/'models/formulas'
_model=None


def ready(verify_hash=False):
    marker=MODELS/'ready.json'
    if not marker.exists():
        raise RuntimeError('Локальная модель формул не установлена. Один раз запустите install-formulas.bat с интернетом.')
    state=json.loads(marker.read_text(encoding='utf-8'))
    expected=json.loads((HERE/'formula-models.json').read_text(encoding='utf-8'))
    if {x['name'] for x in state}!={x['name'] for x in expected}:
        raise RuntimeError('Неполный комплект моделей формул; повторите install-formulas.bat')
    for item in state:
        path=MODELS/item['name']
        if not path.is_file() or path.stat().st_size!=item['size']:
            raise RuntimeError('Повреждена модель формул: '+item['name'])
        if verify_hash:
            digest=next(x['sha256'] for x in expected if x['name']==item['name'])
            if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
                raise RuntimeError('Контрольная сумма модели формул не совпала: '+item['name'])
    return state


@RES.worker()
def recognize(path):
    global _model
    ready(verify_hash=_model is None)
    RES.checkpoint()
    from PIL import Image
    with Image.open(path) as img:
        RES.check_pixels(*img.size)
        if img.width<10 or img.height<10:
            raise ValueError('Выделите формулу целиком')
    if _model is None:
        from vendor.latex_ocr.main import LaTeXOCR
        _model=LaTeXOCR(image_resizer_path=MODELS/'image_resizer.onnx',encoder_path=MODELS/'encoder.onnx',
            decoder_path=MODELS/'decoder.onnx',tokenizer_json=MODELS/'tokenizer.json')
    tex,seconds=_model(str(path))
    if not tex.strip():
        raise RuntimeError('Формула не распознана; сохраните вырезку и внесите LaTeX вручную')
    return dict(latex=tex,seconds=round(seconds,3),verified=False)


def prepare():
    """Explicit online installation only; no calls from server or recognize()."""
    import urllib.request
    import os
    MODELS.mkdir(parents=True,exist_ok=True)
    assets=json.loads((HERE/'formula-models.json').read_text(encoding='utf-8'))
    state=[]
    for item in assets:
        path=MODELS/item['name']
        if not path.exists() or path.stat().st_size!=item['size'] or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
            print('Downloading '+item['name'],flush=True)
            partial=path.with_suffix('.partial')
            with urllib.request.urlopen(item['url'],timeout=60) as response, partial.open('wb') as output:
                while chunk:=response.read(1024*1024):
                    output.write(chunk)
            if partial.stat().st_size!=item['size']:
                raise RuntimeError('Неполная загрузка '+item['name'])
            os.replace(partial,path)
        if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
            raise RuntimeError('Контрольная сумма загрузки не совпала: '+item['name'])
        state.append(dict(name=item['name'],size=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    (MODELS/'ready.json').write_text(json.dumps(state,indent=2),encoding='utf-8')
    print('Formula model files ready; about 179 MB on disk.')


if __name__=='__main__':
    import sys
    if sys.argv[1:]==['--prepare']:
        prepare()
    elif len(sys.argv)==2:
        print(json.dumps(recognize(sys.argv[1]),ensure_ascii=False))
    else:
        raise SystemExit('python formulas.py --prepare | IMAGE')
