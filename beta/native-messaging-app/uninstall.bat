@echo off
:: Uninstall the tbsync_bridge_host native messaging host for Thunderbird on Windows.

setlocal

set "INSTALL_DIR=%APPDATA%\Mozilla\NativeMessagingHosts\tbsync_bridge_host_helper"
set "REG_KEY=HKCU\Software\Mozilla\NativeMessagingHosts\tbsync_bridge_host"

echo.
echo This will uninstall the bridge helper app for the Thunderbird
echo add-on "TbSync Manager Beta".
echo.
echo The following will happen:
echo   - Remove the bridge helper app from:
echo       %INSTALL_DIR%
echo   - Remove the registry entry:
echo       %REG_KEY%
echo.
choice /c yn /n /m "Proceed with uninstallation? [y/n] "
if errorlevel 2 (
  echo.
  echo Uninstallation cancelled.
  pause
  endlocal
  exit /b 1
)
echo.

reg query "%REG_KEY%" >nul 2>&1
if %errorlevel% equ 0 (
  reg delete "%REG_KEY%" /f >nul
  echo Removed registry key: %REG_KEY%
) else (
  echo Registry key already removed: %REG_KEY%
)

rem 
if exist "%INSTALL_DIR%" (
  rmdir /s /q "%INSTALL_DIR%" >nul 2>&1
  if exist "%INSTALL_DIR%" (
    echo ERROR: Could not fully remove the bridge helper app.
    echo Some files are still in use by Thunderbird or another process:
    echo   %INSTALL_DIR%
    echo.
    echo Please close Thunderbird, or restart your PC, then run this uninstaller
    echo again or remove the folder manually.
    pause
    endlocal
    exit /b 1
  )
  echo Removed app directory: %INSTALL_DIR%
) else (
  echo App directory already removed: %INSTALL_DIR%
)

echo.
echo The bridge helper app was sucessfully removed.
pause

endlocal
