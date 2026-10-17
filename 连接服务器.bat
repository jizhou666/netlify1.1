@echo off
chcp 65001 >nul
rem 双击直接连上服务器（SSH 免密已配置，不会再问密码）
rem 退出：输入 exit 回车
title 汇然库存服务器 - root@8.163.86.170
ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=3 root@8.163.86.170
echo.
echo （已断开连接）
pause
