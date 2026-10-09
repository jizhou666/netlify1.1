@echo off
chcp 65001 >nul
rem 芳村仓库存 - 一键启动（正式模式应用服务 + 内网穿透隧道）
rem 正式模式：运行已构建产物 .output，加载快、点击不卡（开发模式已弃用）。
rem 用法：直接双击；改了代码后先跑一次「启动库存系统.bat rebuild」，或在项目目录执行 npm run build。
rem 重要：本文件必须用 CRLF 换行保存（.gitattributes 已锁定 *.bat eol=crlf）。
rem       若只有 LF 换行，cmd 会把每行拆错，报「不是内部或外部命令」。
pushd "%~dp0"

set "NEED_BUILD="
if /i "%~1"=="rebuild" set "NEED_BUILD=1"
if not exist ".output\server\index.mjs" set "NEED_BUILD=1"

if defined NEED_BUILD (
  echo [准备] 正在构建正式版本，请稍候...
  set "SELF_HOST=1"
  call npm run build
  if errorlevel 1 (
    echo.
    echo [错误] 构建失败：请确认已安装 Node 22 以上版本，并且能访问 npm 源。
    popd
    pause
    exit /b 1
  )
)

rem 已经在跑就不再重复启动，避免 8080 端口冲突
rem 用 node 直接连一次 8080：比解析 netstat 更可靠，也不受系统语言影响
node -e "const s=require('net').connect(8080,'127.0.0.1');s.setTimeout(1200);s.on('connect',()=>{s.destroy();process.exit(0)});s.on('timeout',()=>{s.destroy();process.exit(1)});s.on('error',()=>process.exit(1))"
if not errorlevel 1 (
  echo [1/2] 库存应用已在运行，跳过启动：http://localhost:8080
  goto tunnel
)

echo [1/2] 启动库存应用服务 (http://localhost:8080) ...
start "inventory-app" cmd /k "set PORT=8080 && set HOST=0.0.0.0 && node .output\server\index.mjs"

rem 等应用就绪后再开隧道
timeout /t 5 /nobreak >nul 2>&1
if errorlevel 1 ping -n 6 127.0.0.1 >nul

:tunnel
echo [2/2] 启动内网穿透隧道 ...
start "cpolar-tunnel" cmd /k "tools\cpolar\cpolar.exe http 8080"

echo.
echo 启动完成！
echo   本机访问:  http://localhost:8080
echo   查看公网地址: 浏览器打开  http://127.0.0.1:4040
echo   （也可登录 dashboard.cpolar.com 状态页查看隧道网址）
echo.
echo 把公网地址发给同事即可使用；本窗口和两个黑窗口保持打开。
popd
pause
