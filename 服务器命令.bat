@echo off
chcp 65001 >nul
setlocal
set SERVER=root@8.163.86.170

:MENU
cls
echo.
echo  ==================================================
echo        汇然库存 · 服务器快捷面板
echo        %SERVER%
echo  ==================================================
echo.
echo   1. 看状态（服务/版本/端口/证书）
echo   2. 自检（页面 200 + 数据是否完整）
echo   3. 最近 60 行日志
echo   4. 实时日志（Ctrl+C 退出）
echo   5. 重启库存服务
echo   6. 数据库大小
echo   7. 磁盘 / 内存
echo   8. 立即备份数据库（停服约 5 秒）
echo   9. 已有备份列表
echo   U. 更新并重启（服务器上拉代码构建）
echo   A. 直接进服务器命令行
echo   H. 命令说明（kc help）
echo   0. 退出
echo.
set /p choice=请输入数字后回车: 

if "%choice%"=="1" goto S_STATUS
if "%choice%"=="2" goto S_CHECK
if "%choice%"=="3" goto S_LOG
if "%choice%"=="4" goto S_LOGF
if "%choice%"=="5" goto S_RESTART
if "%choice%"=="6" goto S_DATA
if "%choice%"=="7" goto S_DISK
if "%choice%"=="8" goto S_BACKUP
if "%choice%"=="9" goto S_BACKUPS
if /i "%choice%"=="U" goto S_DEPLOY
if /i "%choice%"=="A" goto S_SHELL
if /i "%choice%"=="H" goto S_HELP
if "%choice%"=="0" goto END
goto MENU

:S_STATUS
call :RUN "kc status"
goto AGAIN
:S_CHECK
call :RUN "kc check"
goto AGAIN
:S_LOG
call :RUN "kc log 60"
goto AGAIN
:S_LOGF
echo.
echo  提示：按 Ctrl+C 结束实时日志，然后输入 exit 退出。
call :RUN "kc logf"
goto AGAIN
:S_RESTART
call :RUN "kc restart"
goto AGAIN
:S_DATA
call :RUN "kc data"
goto AGAIN
:S_DISK
call :RUN "kc disk"
goto AGAIN
:S_BACKUP
call :RUN "kc backup"
goto AGAIN
:S_BACKUPS
call :RUN "kc backups"
goto AGAIN
:S_DEPLOY
call :RUN "kc deploy"
goto AGAIN
:S_HELP
call :RUN "kc help"
goto AGAIN
:S_SHELL
echo.
echo  进入服务器命令行，输入 exit 退出。
ssh -o ServerAliveInterval=30 %SERVER%
goto AGAIN

:RUN
echo.
ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 %SERVER% "%~1"
if errorlevel 1 (
  echo.
  echo  [提示] 连接或命令失败。检查：1) 网络  2) 安全组 22 端口  3) 密钥是否还有效
)
echo.
exit /b 0

:AGAIN
echo.
pause
goto MENU

:END
endlocal
