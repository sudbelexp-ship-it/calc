"""Скачивает модели OCR один раз, чтобы дальше всё работало без интернета."""
import ocr
import numpy as np
import cv2
import json
from pathlib import Path
img = np.full((160, 850, 3), 255, np.uint8)
cv2.putText(img, '12345 67.89', (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 3, cv2.LINE_AA)
ocr.ocr_words(img)
for k in ('latin', 'ch'):
    ocr.ocr_words(img, k)
for engine in (ocr._engine(), ocr._alt_engine('latin'), ocr._alt_engine('ch'), ocr._server_engine()):
    result = engine(img, use_det=False, use_cls=False, use_rec=True)
    if not result.txts:
        raise RuntimeError('Подготовка распознавателя не завершена')
import rapidocr
folder = Path(rapidocr.__file__).parent / 'models'
files = [dict(path=str(p.resolve()), size=p.stat().st_size) for p in folder.rglob('*') if p.is_file()]
if not files:
    raise RuntimeError('Не найдены скачанные модели')
Path(__file__).with_name('.models-ready.json').write_text(json.dumps({'files': files}, ensure_ascii=False, indent=2), encoding='utf-8')
print('Модели OCR готовы.')
