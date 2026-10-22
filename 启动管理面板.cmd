@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title TShock 管理面板

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [错误] 没有找到 Node.js。
  echo  请先安装 Node.js 18 或更高版本：https://nodejs.org/
  echo  安装完成后重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

echo.
echo  正在启动 TShock 管理面板，浏览器会自动打开…
echo  建议先在面板里点「停止服务器」，再关闭本窗口。
echo.
node "%~dp0TShockPanel\server.js"
echo.
echo  面板已退出，可以关闭此窗口。
pause
