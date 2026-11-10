@echo off
setlocal
cd /d "%~dp0app"

if not exist ".env" (
  echo.
  echo   Falta el archivo app\.env
  echo   Copia app\.env.example a app\.env y completa DATABASE_URL.
  echo.
  pause
  exit /b 1
)

if not exist "web\dist\index.html" (
  echo Compilando interfaz...
  call npm run build
  if errorlevel 1 (
    echo Fallo la compilacion.
    pause
    exit /b 1
  )
)

echo Iniciando tablero de planta en http://localhost:8787
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
node --env-file=.env server\index.js
pause
