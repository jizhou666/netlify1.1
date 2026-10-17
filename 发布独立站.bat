@echo off
chcp 65001 >nul
rem 一键发布「独立站」：改完 company-site 的代码后双击本文件
rem 只覆盖代码，不动服务器上的 data\ 和 uploads\（后台内容和图片安全）
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\publish-site.ps1" %*
if errorlevel 1 (
  echo.
  echo [失败] 独立站发布没有完成，按上面的红字提示处理。
) else (
  echo.
  echo [完成] 独立站已更新，浏览器按 Ctrl+F5 刷新即可。
)
pause
