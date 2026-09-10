@echo off
REM Inicia la app de Ventaneria NSR-10 (visor IFC + verificacion de vidrio)
cd /d "%~dp0"
echo Iniciando servidor local en http://localhost:5174 ...
python serve.py
pause
