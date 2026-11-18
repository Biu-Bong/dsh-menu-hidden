@echo off
chcp 65001 >nul
setlocal
node "%~dp0shell\patch-shell-menu.mjs" --apply %*
set "code=%errorlevel%"
echo.
if not "%code%"=="0" echo [失败] 退出码 %code%
pause
