@echo off
chcp 65001 >nul
rem 一键发布「库存台账」：改完代码双击本文件
rem 流程：类型检查 → 提交推送 GitHub → 服务器拉取重建 → 自检
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\publish.ps1" %*
if errorlevel 1 (
  echo.
  echo [失败] 发布没有完成，按上面的红字提示处理。
) else (
  echo.
  echo [完成] 已发布到服务器，浏览器按 Ctrl+F5 刷新即可。
)
pause
