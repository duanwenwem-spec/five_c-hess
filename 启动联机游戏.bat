@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$source = Get-Content -LiteralPath '%~dp0start_online.ps1' -Raw -Encoding UTF8; & ([ScriptBlock]::Create($source))"
pause
