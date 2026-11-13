"""Offline readiness check; does not instantiate models or trigger downloads."""
from pathlib import Path
import hashlib
import json
import sys
from importlib import metadata


def check():
    here = Path(__file__).resolve().parent
    for name in ('pymupdf', 'opencv-python-headless', 'numpy', 'pillow', 'onnxruntime', 'rapidocr'):
        metadata.version(name)
    marker = here / '.models-ready.json'
    if not marker.exists():
        raise RuntimeError('Нет записи подготовки моделей. Один раз запустите install.bat с интернетом.')
    state = json.loads(marker.read_text(encoding='utf-8'))
    for f in state['files']:
        path = Path(f['path'])
        if not path.exists() or path.stat().st_size != f['size']:
            raise RuntimeError('Модель отсутствует или повреждена: ' + path.name)
    print('Зависимости и локальные модели найдены. Формулы GLM — отдельная необязательная функция.')


if __name__ == '__main__':
    try:
        check()
    except Exception as exc:
        print(str(exc))
        sys.exit(1)
