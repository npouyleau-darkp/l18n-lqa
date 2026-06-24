@echo off
powershell.exe -ExecutionPolicy Bypass -File "%~dp0install_build_data.ps1"
if %errorlevel% == 0 (
    echo.
    echo Installation reussie.
) else (
    echo.
    echo Erreur lors de l'installation.
)
pause
