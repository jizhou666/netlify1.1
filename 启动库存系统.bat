@echo off
chcp 65001 >nul
rem 芳村仓库存 - 一键启动（正式模式应用服务 + 内网穿透隧道）
rem 正式模式：运行已构建产物 .output，加载快、点击不卡（开发模式已弃用）。
rem 用法：直接双击；改了代码后先跑一次「启动库存系统.bat rebuild」，或在项目目录执行 npm run build。
rem       8080 上如果是个不该在的残留进程（比如调试留下的），跑「启动库存系统.bat restart」会清掉它再重启。
rem 重要：本文件必须用 CRLF 换行保存（.gitattributes 已锁定 *.bat eol=crlf）。
rem       若只有 LF 换行，cmd 会把每行拆错，报「不是内部或外部命令」。
pushd "%~dp0"

rem ── 数据库 ──
rem   默认：台账跑本机内嵌库；.env.local 里的 SYNC_DATABASE_URL 是页面「云端同步」的上传目标。
rem   想让应用直接读写云端 Neon 库（各处实时一致），就在 .env.local 里写 DATABASE_URL=连接串。
rem   （.env.local 已在 .gitignore 里，不会被提交）
set "ENVFILE_URL="
set "ENVFILE_SYNC="
if exist ".env.local" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
    if /i "%%A"=="DATABASE_URL" if not "%%B"=="" set "ENVFILE_URL=%%B"
    if /i "%%A"=="SYNC_DATABASE_URL" if not "%%B"=="" set "ENVFILE_SYNC=%%B"
  )
)
if defined ENVFILE_URL set "DATABASE_URL=%ENVFILE_URL%"
if defined ENVFILE_SYNC set "SYNC_DATABASE_URL=%ENVFILE_SYNC%"
set "DBINFO=本地内嵌库（数据只在这台电脑）"
if defined DATABASE_URL set "DBINFO=云端库 Neon（应用直接读写云端）"
set "SYNCINFO=未配置（页面上「云端同步」会提示怎么配）"
if defined SYNC_DATABASE_URL set "SYNCINFO=已配置，页面上点「云端同步」即可一键上传"

set "NEED_BUILD="
set "FORCE_RESTART="
if /i "%~1"=="rebuild" set "NEED_BUILD=1"
if /i "%~2"=="rebuild" set "NEED_BUILD=1"
if /i "%~1"=="restart" set "FORCE_RESTART=1"
if /i "%~2"=="restart" set "FORCE_RESTART=1"
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

rem ── 应用服务：先确认 8080 上到底是谁 ──
rem OURS=我们的应用在跑 / OTHER=被别的程序占用 / DOWN=没人应答
set "APPSTATE=DOWN"
for /f "delims=" %%R in ('node scripts\check-app-port.mjs') do set "APPSTATE=%%R"

if defined FORCE_RESTART (
  echo [提示] restart：先清掉 8080 上的进程，重新启动。
  goto startapp
)
if /i "%APPSTATE%"=="OURS" (
  echo [1/2] 库存应用已在运行，跳过启动：http://localhost:8080
  echo        想换成自己的窗口，先关掉 8080 上的进程，或运行「启动库存系统.bat restart」。
  goto tunnel
)
if /i "%APPSTATE%"=="OTHER" (
  echo [警告] 8080 端口被别的程序占用了，库存应用起不来。
  echo         先关掉占用 8080 的程序，再重新运行本文件。
  echo         查看占用：netstat -ano ^| findstr :8080
  goto tunnel
)

:startapp
rem DOWN 或 restart：清掉残留，开自己的窗口
call :killport
echo [1/2] 启动库存应用服务 (http://localhost:8080) ...
start "inventory-app" cmd /k "set PORT=8080 && set HOST=0.0.0.0 && node .output\server\index.mjs"

rem 等它真的应答（最多 40 秒）：起不来就直说，不再出现「看着启动了其实没起」
node scripts\check-app-port.mjs --wait 40 >nul
if errorlevel 1 (
  echo.
  echo [错误] 等了 40 秒还没等到应用就绪。请看新开窗口里的报错；
  echo        常见原因：8080 被别的程序占用、Node 版本过低、构建产物损坏
  echo        （可运行「启动库存系统.bat rebuild」重新构建）。
) else (
  echo [1/2] 应用已就绪：http://localhost:8080
)

:tunnel
echo [2/2] 启动内网穿透隧道 ...
start "cpolar-tunnel" cmd /k "tools\cpolar\cpolar.exe http 8080"

echo.
echo 启动完成！
echo   数据来源:  %DBINFO%
echo   云端同步:  %SYNCINFO%
echo   本机访问:  http://localhost:8080
echo   查看公网地址: 浏览器打开  http://127.0.0.1:4040
echo   （也可登录 dashboard.cpolar.com 状态页查看隧道网址）
echo.
echo 把公网地址发给同事即可使用；本窗口和两个黑窗口保持打开。
echo   （库存应用那个窗口关掉后，同事就打不开了；重新双击本文件即可恢复。）
popd
pause
exit /b 0

:killport
rem 清掉占着 8080 的残留进程（多是上次没关干净的库存应用/调试进程）
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /f /pid %%P >nul 2>&1
exit /b 0
