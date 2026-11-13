@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Сначала выполните install.bat с интернетом. Обычный запуск работает без скачиваний.
  pause
  exit /b 1
)
venv\Scripts\python -B doctor.py
if errorlevel 1 (
  echo Подготовка не завершена. Запустите install.bat повторно.
  pause
  exit /b 1
)
venv\Scripts\python -W ignore server.py --open
pause
