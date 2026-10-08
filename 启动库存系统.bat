@echo off
chcp 65001 >nul
rem 芳村仓库存 - 一键启动（正式模式应用服务 + 内网穿透隧道）
rem 正式模式：运行已构建产物 .output，加载快、点击不卡（开发模式已弃用）。
cd /d E:\netlify-git

if not exist ".output\server\index.mjs" (
  echo [准备] 首次运行，正在构建正式版本，请稍候...
  set "SELF_HOST=1"
  call npm run build
)

echo [1/2] 启动库存应用服务 (http://localhost:8080) ...
start "inventory-app" cmd /k "cd /d E:\netlify-git && set PORT=8080 && set HOST=0.0.0.0 && node .output\server\index.mjs"

rem 等待应用就绪后再开隧道
timeout /t 5 /nobreak >nul

echo [2/2] 启动内网穿透隧道 ...
start "cpolar-tunnel" cmd /k "E:\netlify-git\tools\cpolar\cpolar.exe http 8080"

echo.
echo 启动完成！
echo   本机访问:  http://localhost:8080
echo   查看公网地址: 浏览器打开  http://127.0.0.1:4040
echo   （也可登录 dashboard.cpolar.com 状态页查看隧道网址）
echo.
echo 把公网地址发给同事即可使用；本窗口和两个黑窗口保持打开。
pause
