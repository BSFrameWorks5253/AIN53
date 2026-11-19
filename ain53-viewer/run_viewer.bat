@echo off
title AIN53 Standalone File Viewer
echo ========================================================
echo   AIN53 Safar Sync File Viewer (.AIN53)
echo ========================================================
:: Silently ensure .AIN53 extension has official icon on client PC
reg query "HKCU\Software\Classes\.AIN53\DefaultIcon" >nul 2>&1
if %errorlevel% neq 0 (
    reg add "HKCU\Software\Classes\.AIN53" /ve /d "AIN53.Package" /f >nul 2>&1
    reg add "HKCU\Software\Classes\.AIN53\DefaultIcon" /ve /d "%~dp0icon.ico" /f >nul 2>&1
    reg add "HKCU\Software\Classes\AIN53.Package" /ve /d "AIN53 Safar Sync Package" /f >nul 2>&1
    reg add "HKCU\Software\Classes\AIN53.Package\DefaultIcon" /ve /d "%~dp0icon.ico" /f >nul 2>&1
    reg add "HKCU\Software\Classes\AIN53.Package\shell\open\command" /ve /d "cmd.exe /c start \"\" \"%~dp0index.html\"" /f >nul 2>&1
    reg add "HKCU\Software\Classes\SystemFileAssociations\.AIN53\DefaultIcon" /ve /d "%~dp0icon.ico" /f >nul 2>&1
)

echo   Opening viewer in your default web browser...
start "" "%~dp0index.html"
exit
