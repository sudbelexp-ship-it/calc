#!/usr/bin/env python3
"""Копирует веб-калькуляторы из корня репозитория в assets Android-приложений.

Сайт c.bit-exp.ru остаётся единственным источником: правите HTML на сайте — пересобираете APK.
Шрифты Google Fonts заменяются на локальные (если лежат в android/build-web/fonts), иначе
страница использует системный шрифт — так приложения работают без интернета.

  python3 android/tools/sync_web.py
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "android" / "build-web"
FONTS = OUT / "fonts"

APPS = {
    "raschety": ["webcad.html", "webcad/"],
    "svai": ["pile-analyzer.html"],
}

GOOGLE = re.compile(r'\s*<link[^>]+(fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>', re.I)


def font_css() -> str:
    faces = []
    for f in sorted(FONTS.glob("*.woff2")):
        # имена вида golos-text-cyrillic-500-normal.woff2 / jetbrains-mono-latin-400-normal.woff2
        m = re.match(r"(golos-text|jetbrains-mono)-(cyrillic|latin)-(\d{3})-normal\.woff2", f.name)
        if not m:
            continue
        fam = {"golos-text": "Golos Text", "jetbrains-mono": "JetBrains Mono"}[m[1]]
        rng = "U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" if m[2] == "cyrillic" else "U+0000-00FF,U+2000-206F,U+20AC,U+2212"
        faces.append(f"@font-face{{font-family:'{fam}';font-weight:{m[3]};font-style:normal;font-display:swap;"
                     f"src:url(fonts/{f.name}) format('woff2');unicode-range:{rng}}}")
    return "\n".join(faces)


def main() -> int:
    css = font_css()
    for app, items in APPS.items():
        dst = OUT / app / "web"
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True)
        for item in items:
            src = ROOT / item
            if item.endswith("/"):
                shutil.copytree(src, dst / item.rstrip("/"))
                continue
            html = src.read_text(encoding="utf-8")
            html, n = GOOGLE.subn("", html)
            if n and css:
                html = html.replace("</head>", '<link rel="stylesheet" href="fonts.css">\n</head>', 1)
            (dst / item).write_text(html, encoding="utf-8")
        if css:
            (dst / "fonts.css").write_text(css + "\n", encoding="utf-8")
            shutil.copytree(FONTS, dst / "fonts")
        print(f"{app}: {sum(1 for _ in dst.rglob('*') if _.is_file())} файлов → {dst.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
