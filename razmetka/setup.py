"""Explicit online installation; start.bat itself never downloads dependencies."""
from pathlib import Path
import subprocess
import sys
import venv

HERE = Path(__file__).resolve().parent


def main():
    env = HERE / 'venv'
    python = env / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(env)
    for cmd in ([str(python), '-m', 'pip', 'install', '-r', str(HERE / 'requirements.txt')],
                [str(python), '-m', 'pip', 'check'],
                [str(python), str(HERE / 'warmup.py')]):
        subprocess.run(cmd, cwd=HERE, check=True)
    print('Готово. Запускайте start.bat. Распознавание текста и таблиц работает локально.')


if __name__ == '__main__':
    main()
