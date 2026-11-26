@echo off
chcp 65001 >nul
title 重启 DeepSeek Harness（加载本地插件构建）
echo.
echo   即将完全退出 DeepSeek Harness 再重新启动。
echo   目的：让宿主加载 ~/.dsh/profiles/desktop/node_modules 里的新插件产物。
echo   先保存手上的输入；当前页面会断开，重开后可继续同一会话。
echo.
pause
echo [1/3] 关闭宿主...
taskkill /f /im "DeepSeek Harness.exe" >nul 2>&1
timeout /t 3 /nobreak >nul
echo [2/3] 启动宿主...
start "" "C:\Users\joshua\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
echo [3/3] 完成。窗口可关闭；宿主窗口出现后回浏览器刷新即可。
timeout /t 5 /nobreak >nul
