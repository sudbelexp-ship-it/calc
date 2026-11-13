@echo off
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Сначала выполните install.bat
  exit /b 1
)
venv\Scripts\python.exe -m pip install -r requirements-formulas.txt
if errorlevel 1 exit /b 1
venv\Scripts\python.exe formulas.py --prepare
if errorlevel 1 exit /b 1
echo Локальная модель формул установлена. Перезапустите start.bat.
