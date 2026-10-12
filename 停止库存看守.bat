@echo off
chcp 65001 >nul
rem 停止库存应用与「常驻看守」（同事那边的公网链接会随之打不开）。
rem 想重新启动：双击「启动库存系统.bat」。
pushd "%~dp0"

echo 正在停止库存看守与应用…
if not exist "data" mkdir "data"
rem 看守每 30 秒轮询一次，看到这个标记就停掉应用并退出
echo stop> "data\watchdog.stop"

rem 顺手把 8080 上的监听清掉（看守会先检查停止标记，不会再把它拉起来）
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /f /pid %%P >nul 2>&1
ping -n 4 127.0.0.1 >nul

node scripts\check-app-port.mjs >nul 2>&1
if errorlevel 1 (
  echo 已停止：8080 上现在没有库存应用。
) else (
  echo 8080 上还有响应，看守可能正在退出，等几秒再运行一次本文件即可。
)
echo 想重新启动：双击「启动库存系统.bat」。
popd
pause
