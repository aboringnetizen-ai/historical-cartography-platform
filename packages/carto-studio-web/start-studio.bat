@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Historical Cartography Studio (960-975 Central Asia)

if not exist "dist\index.html" (
  echo [Carto Studio] 未检测到 dist 构建产物，正在执行构建...
  call npm run build
  if errorlevel 1 (
    echo [Carto Studio] 构建失败，请检查 Node.js 与依赖环境。
    pause
    exit /b 1
  )
)

echo [Carto Studio] 正在启动本地预览服务器并自动打开浏览器 (http://127.0.0.1:4179/) ...
echo [Carto Studio] 关闭此窗口即可停止服务器。
npx vite preview --host 127.0.0.1 --port 4179 --open
pause
