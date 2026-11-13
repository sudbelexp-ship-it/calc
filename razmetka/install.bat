@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Установка зависимостей и моделей. Сейчас требуется интернет.
python setup.py
if errorlevel 1 (
  echo Установка не завершена. Исправьте ошибку выше и запустите install.bat повторно.
  pause
  exit /b 1
)
pause
