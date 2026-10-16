#!/usr/bin/env bash
# 每日备份内嵌库目录。
#
# 为什么要停服：PGLite 就是服务器上的一个 Postgres 数据目录，直接热拷可能拷到
# 写了一半的文件。停 5 秒再打包最稳（深夜跑，同事碰不到）。
# 平时更省事的异地备份是页面上的「云端同步」按钮（推到 Neon），两者可以一起用。
#
# 用法（加到 root 的 crontab）：
#   30 2 * * * /opt/inventory/app/deploy/backup.sh >> /var/log/inventory-backup.log 2>&1
set -euo pipefail

SERVICE="${SERVICE:-inventory}"
DATA_DIR="${DATA_DIR:-/var/lib/inventory}"
DEST="${DEST:-/var/backups/inventory}"
KEEP="${KEEP:-14}"

mkdir -p "$DEST"

echo "[$(date '+%F %T')] 停服务打包…"
systemctl stop "$SERVICE"
trap 'systemctl start "$SERVICE"' EXIT

tar czf "$DEST/pglite-$(date +%F-%H%M).tgz" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
systemctl start "$SERVICE"
trap - EXIT

# 只保留最近 $KEEP 份
ls -1t "$DEST"/pglite-*.tgz 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f || true

echo "[$(date '+%F %T')] 完成，当前备份："
ls -lh "$DEST" | tail -n +2 || true
