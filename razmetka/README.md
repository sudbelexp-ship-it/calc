# Локальная разметка документов и OCR — тестовая сборка

PDF обрабатывается на компьютере пользователя. Основная панель работает по
`http://127.0.0.1:8765/`. Веб-панель под `https://bit-exp.ru/c/` — дополнительный
вариант: браузеру может потребоваться разрешение локальной сети. Размещение
исходников в тестовой ветке GitHub само по себе не публикует её через GitHub Pages.

## Запуск на Windows

1. Скачайте ZIP ветки `ocr-local-test` репозитория `sudbelexp-ship-it/calc` и распакуйте.
2. Нужен Python 3.13 (команда `python` должна быть доступна).
3. Один раз выполните `razmetka/install.bat` с интернетом. Устанавливаются зависимости
   и модели RapidOCR. При ошибке установка завершается; повторный запуск продолжает подготовку.
4. Запустите `razmetka/start.bat`. Оно проверяет окружение и локальные модели,
   затем открывает панель с ключом доступа. Окно сервера оставьте открытым.
5. Добавьте PDF и выберите `auto` или `ocr`. Фото с перспективой и тенями не поддерживаются.

После подготовки текст, таблицы и вырезки обрабатываются без интернета.
Для офлайн-формул один раз запустите `razmetka/install-formulas.bat`: дополнительный
токенизатор и около 179 МБ моделей скачиваются на диск. Затем кнопка «Формула → LaTeX»
с вариантом «Локально, CPU / офлайн» работает без сети и видеодрайверов. Работа проверена
с заблокированными socket-соединениями и через локальную очередь HTTP API.
Выделяйте только формулу, без поясняющего абзаца. Модель ошибается в сложных индексах,
цифрах и знаках: LaTeX всегда помечен как несверенный до ручной проверки.
В основе — адаптированный [RapidLaTeXOCR 0.0.9](https://github.com/RapidAI/RapidLaTeXOCR),
лицензия и описание изменений находятся в `vendor/latex_ocr/`.
GLM-OCR остаётся дополнительным вариантом в браузере: требуется WebGPU и отдельная
первоначальная загрузка библиотеки/модели (~650 МБ). Она выключена по умолчанию.

## Что значит строгий режим проверки

В этой тестовой сборке **все автоматически полученные числа помечены `[?…]` до
визуальной проверки**. Даже согласие нескольких моделей не гарантирует правильность.
Это сознательно консервативный режим: ноль непомеченных ошибок не означает идеальный OCR.
Смотрите также число найденных, правильных, пропущенных и помеченных правильных чисел.

Пересчёты и голосование ничего не исправляют по смыслу. Исходный вариант сохраняется,
альтернативы записываются в `auto/pNNN.json`. Вырезки остаются в `img/`.
Правки в редакторе сохраняются отдельно от автоматического результата. Сохранение
не означает проверку. Кнопка «Страница проверена» фиксирует ручную сверку, но не
снимает автоматически все сомнения в числах.

## Точный режим

Страница PDF рендерится в 400 dpi, вырезки не уменьшаются. Для числовых ячеек используется
распознаватель PP-OCRv5 SERVER, ещё два распознавателя дают альтернативы.
У RapidOCR 3.10 нет Cyrillic SERVER export: русский текст страницы по-прежнему
читается Cyrillic MOBILE. SERVER здесь применяется к ячейкам, а не объявляется
универсальным серверным OCR русского текста.

## Ночная очередь и отчёты

Из корня распакованного проекта:

```powershell
.\razmetka\venv\Scripts\python.exe .\razmetka\batch.py "normy/*" --mode precise
```

Завершённые страницы с валидным `auto/pNNN.json` пропускаются. Для повторного
распознавания используйте `--force`. Незавершённый Markdown восстанавливается из JSON.
Журнал — `batch.log`. В каждой папке документа создаются `report.md` и `quality.json`:
количество страниц/сомнений, ошибки соотношений, порядок страниц для проверки.

Связи столбцов задаются в `relations.json`; перед применением проверяется число
столбцов. Расхождения перечисляются в «Сомнительных местах», значения не заменяются.

## Проверки

```powershell
.\razmetka\venv\Scripts\python.exe -m unittest discover -s razmetka/tests -v
.\razmetka\venv\Scripts\python.exe razmetka/audit_checks.py
.\razmetka\venv\Scripts\python.exe razmetka/offline_smoke.py
```

В `evaluate.py` числовые ячейки сравниваются по номеру таблицы, строке, столбцу и
позиции внутри ячейки. `rowspan`/`colspan` разворачиваются. Знаки чисел сохраняются.
Числа вне таблиц сравниваются последовательностями внутри страницы.

```powershell
.\razmetka\venv\Scripts\python.exe razmetka/evaluate.py source.pdf reference_folder test_name auto
```

`--cached` пересчитывает метрики без повторного OCR. Эталон и результаты остаются локально.
Агрегированные результаты проверки пяти ГОСТов приведены в `VALIDATION.md` в корне ветки.

## Публикация и конфиденциальность

В GitHub попадают код, панель, тесты и агрегированные метрики. Документы, PDF, модели,
ключ `token.txt`, журналы и содержимое `normy/` не публикуются. Сервер слушает только
127.0.0.1, проверяет Host и Origin, защищает API ключом, ограничивает загрузку 256 МБ.
Ключ передаётся панели в URL-фрагменте `#t=…`, а не серверу сайта.

Файлы для нового хостинга: `markitdown.html`, `razmetka.html`, `theme.js`. Относительные
ссылки позволяют размещение в `/c/`. Сам Python-сервер на хостинг переносить не нужно.


## Resource budget

The browser is a panel; Python, dependencies and OCR model weights are installed locally once by install.bat. Ordinary OCR is offline after installation; no graphics drivers are installed. Model files occupy about 150 MB, in addition to Python, packages, PDFs and output images. Optional browser GLM downloads are separate.

CPU: at most half the logical CPUs, capped at four threads per inference session; one recognition job runs at a time. OpenCV has the same limit; Windows process priority is below normal. This is not a hard CPU percentage quota.

RAM: check before pages and cell recognition; stop when available system RAM falls below 20% or 1.5 GB, whichever is larger. Before PDF rendering, estimate 40 bytes per pixel and reject pages over 45 MP. These are preventive checks, not a hard process memory cap; other applications can still change available RAM during a step. Completed pages remain on disk for resuming.

Resource smoke test (this workstation, 20 logical CPUs, synthetic 900x1200 page): 4 threads; 1.829 s wall time; 6.234 s CPU time; average 17.04% of total machine CPU; peak process working set 255.7 MiB. Includes model loading and one cell recognition; not a worst-case guarantee for large PDFs or precise mode. Run `python razmetka/resource_probe.py` to repeat.
