#!/usr/bin/env bash
# 一键更新库存台账（在服务器上跑）：拉代码 → 装依赖 → 构建 → 重启 → 自检
#
# 用法：
#   sudo /opt/inventory/app/deploy/update.sh            # 正常更新
#   sudo SKIP_PULL=1 /opt/inventory/app/deploy/update.sh   # 服务器上手动改过代码时跳过 git pull
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/inventory/app}"
SERVICE="${SERVICE:-inventory}"
PORT="${PORT:-8080}"

cd "$APP_DIR"

echo "==> 1/5 拉取代码"
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  git pull --ff-only
fi

echo "==> 2/5 安装依赖"
npm ci

echo "==> 3/5 构建（SELF_HOST=1 才会输出可长期托管的 .output）"
SELF_HOST=1 npm run build

echo "==> 4/5 重启服务"
systemctl restart "$SERVICE"
sleep 3
systemctl is-active "$SERVICE"

echo "==> 5/5 自检"
if curl -fsS --max-time 20 "http://127.0.0.1:${PORT}/" -o /dev/null; then
  echo "OK：应用已在 127.0.0.1:${PORT} 正常应答"
else
  echo "失败：应用没有应答，看看日志： journalctl -u ${SERVICE} -n 50 --no-pager"
  exit 1
fi
