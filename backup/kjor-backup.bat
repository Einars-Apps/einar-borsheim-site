@echo off
cd /d "%~dp0.."
if not exist "backup\service-account.json" (
  echo Mangler backup\service-account.json. Se backup\README.md.
  exit /b 1
)
if "%BACKUP_DIR%"=="" set "BACKUP_DIR=%USERPROFILE%\OneDrive\Internkontroll-backup"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
echo Skriver backup til %BACKUP_DIR%
call npm run backup
exit /b %ERRORLEVEL%
