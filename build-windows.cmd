@echo off
setlocal
cd /d "%~dp0"

echo Building PlainMint for Windows...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\scripts\build-windows.ps1"
set "exit_code=%ERRORLEVEL%"

if not "%exit_code%"=="0" (
  echo.
  echo Build failed. See the error above.
  pause
  exit /b %exit_code%
)

echo.
echo Build complete. Packages are in artifacts\windows.
pause
