@echo off
setlocal enabledelayedexpansion
set encontrado=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING') do (
  taskkill /F /PID %%p >nul 2>&1
  set encontrado=1
)
if "!encontrado!"=="1" (
  echo Servidor detenido.
) else (
  echo No habia nada escuchando en el puerto 8787.
)
pause
