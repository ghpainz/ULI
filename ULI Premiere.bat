@echo off
rem ULI Premiere'i konsol penceresi olmadan başlatır
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Bagimliliklar kuruluyor, lutfen bekleyin...
  call npm install
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
