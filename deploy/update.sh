#!/usr/bin/env bash
# 一键更新库存台账（在服务器上跑）：拉代码 → 装依赖 → 构建 → 重启 → 自检
#
# 用法：
#   sudo /opt/inventory/app/deploy/update.sh                  # 正常更新（由「发布到服务器.bat」调用）
#   sudo SKIP_PULL=1 /opt/inventory/app/deploy/update.sh      # 跳过拉代码，只重建当前代码
#   sudo SKIP_DEPS=1 ...update.sh                             # 跳过 npm 安装（依赖没变时快很多）
#
# 说明：用 git reset --hard 对齐远端，这样服务器上被 npm 改过的 package-lock.json 之类
# 不会挡住更新（服务器是「构建目标」，本地仓库才是代码来源）。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/inventory/app}"
SERVICE="${SERVICE:-inventory}"
PORT="${PORT:-8080}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

echo "==> 1/6 拉取代码（reset 到 origin/${BRANCH}）"
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  git fetch --prune origin
  git reset --hard "origin/${BRANCH}"
fi
git log --oneline -1

echo "==> 2/6 安装依赖"
if [[ "${SKIP_DEPS:-0}" != "1" ]]; then
  if [ -f package-lock.json ]; then npm ci || npm install; else npm install; fi
else
  echo "（SKIP_DEPS=1，跳过）"
fi

echo "==> 3/6 构建（SELF_HOST=1 才会输出可长期托管的 .output）"
SELF_HOST=1 npm run build || {
  echo "构建失败，重装依赖后再试一次（vite/rolldown 原生模块在跨平台 npm ci 时可能缺失）…"
  rm -rf node_modules
  npm install
  SELF_HOST=1 npm run build
}

echo "==> 4/6 重启服务"
systemctl restart "$SERVICE"
sleep 3
systemctl is-active "$SERVICE"

echo "==> 5/6 自检"
if curl -fsS --max-time 20 "http://127.0.0.1:${PORT}/" -o /dev/null; then
  echo "OK：应用已在 127.0.0.1:${PORT} 正常应答"
else
  echo "失败：应用没有应答，看看日志： journalctl -u ${SERVICE} -n 50 --no-pager"
  exit 1
fi

echo "==> 6/6 完成：刷新浏览器即可看到新版本（Ctrl+F5 强制刷新）"
