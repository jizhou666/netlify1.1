#!/usr/bin/env bash
# 汇然库存 —— 服务器快捷命令（安装到 /usr/local/bin/kc）
# 用法：kc [命令]        不带命令 = kc help
# 这些命令都是只读/安全的，除了 restart / backup / deploy
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/inventory/app}"
SERVICE="${SERVICE:-inventory}"
PORT="${PORT:-8080}"
DATA_DIR="${DATA_DIR:-/var/lib/inventory}"
DOMAIN="${DOMAIN:-huiranpk.com}"

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; D='\033[0;90m'; N='\033[0m'
title() { printf "\n${C}── %s ──${N}\n" "$*"; }
ok()    { printf "${G}  ✓ %s${N}\n" "$*"; }
warn()  { printf "${Y}  ! %s${N}\n" "$*"; }
bad()   { printf "${R}  ✗ %s${N}\n" "$*"; }
dim()   { printf "${D}  %s${N}\n" "$*"; }

state() { systemctl is-active "$SERVICE" 2>/dev/null; }

cmd_help() {
  cat <<EOF
${C}汇然库存 · 服务器快捷命令${N}

  kc status     服务状态 / 代码版本 / 监听端口 / 证书到期
  kc check      自检：页面是否 200、台账数据是否在
  kc log [N]    最近 N 行日志（默认 50）
  kc logf       实时日志（Ctrl+C 退出）
  kc restart    重启库存服务
  kc data       数据库目录大小与文件数
  kc disk       磁盘 / 内存
  kc backup     立即备份数据库（会停服约 5 秒，保留 14 份）
  kc backups    列出已有备份
  kc deploy     拉最新代码 + 构建 + 重启（= deploy/update.sh）
  kc urls       对外访问地址
  kc help       这份说明

${D}想学习：每个命令背后用的就是 systemctl / journalctl / curl / du / df 这些系统命令，
kc 只是把它们包了一层。用 "kc help" 看不懂的地方，可以直接问我。${N}
EOF
}

cmd_status() {
  title "服务状态"
  if [ "$(state)" = "active" ]; then ok "inventory：运行中"; else bad "inventory：$(state)"; fi
  dim "启动时间：$(systemctl show -p ActiveEnterTimestamp --value "$SERVICE" 2>/dev/null)"
  dim "监听端口：$(ss -lntp 2>/dev/null | awk '$4 ~ /:'"$PORT"'$/ {print $4}' | head -1)"
  dim "代码版本：$(git -C "$APP_DIR" log --oneline -1 2>/dev/null)"
  dim "Node：$($(command -v node) -v 2>/dev/null)   运行内存：$(ps -o rss= -C node 2>/dev/null | awk '{s+=$1} END {printf "%.0f MB", s/1024}')"
  if systemctl is-active --quiet company-site 2>/dev/null; then
    dim "独立站：运行中（127.0.0.1:8081）"
  else
    dim "独立站：未运行"
  fi
  local cert="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
  if [ -f "$cert" ]; then
    dim "证书到期：$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2)"
  else
    dim "证书：还没签（备案通过后执行 install.sh --cert）"
  fi
}

cmd_check() {
  title "自检"
  local code size hits
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:$PORT/" 2>/dev/null)"
  size="$(curl -s --max-time 20 "http://127.0.0.1:$PORT/" 2>/dev/null | wc -c | tr -d ' ')"
  [ "$code" = "200" ] && ok "页面 HTTP 200（${size} 字节）" || bad "页面 HTTP $code"
  # 满数据时首页约 1.8MB；只有 4 个示例货号时会小很多，用它判断数据在不在
  if [ "${size:-0}" -gt 1000000 ]; then
    ok "页面 ${size} 字节 —— 业务数据完整"
  else
    warn "页面只有 ${size} 字节 —— 数据可能是空的（或刚被清空）"
  fi
  [ "$(state)" = "active" ] && ok "systemd 状态正常" || bad "systemd 状态：$(state)"
  dim "最近错误日志（显示 -- No entries -- 就是没报错）："
  journalctl -u "$SERVICE" -p err -n 3 --no-pager 2>/dev/null | sed 's/^/    /'
}

cmd_log() {
  title "最近 ${1:-50} 行日志"
  journalctl -u "$SERVICE" -n "${1:-50}" --no-pager
}

cmd_logf() {
  title "实时日志（Ctrl+C 退出）"
  journalctl -u "$SERVICE" -n 20 -f
}

cmd_restart() {
  title "重启库存服务"
  systemctl restart "$SERVICE"
  sleep 3
  if [ "$(state)" = "active" ]; then
    ok "已重启，当前：运行中"
    printf "  自检：HTTP %s\n" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:$PORT/")"
  else
    bad "启动失败，看日志：kc log 50"
    exit 1
  fi
}

cmd_data() {
  title "数据库"
  dim "目录：$DATA_DIR/pglite"
  dim "大小：$(du -sh "$DATA_DIR/pglite" 2>/dev/null | cut -f1)   文件数：$(ls "$DATA_DIR/pglite" 2>/dev/null | wc -l | tr -d ' ')"
  dim "备份目录：/var/backups/inventory（$(ls /var/backups/inventory 2>/dev/null | wc -l | tr -d ' ') 份）"
}

cmd_disk() {
  title "磁盘 / 内存"
  df -h / | sed 's/^/  /'
  echo
  free -h | sed 's/^/  /'
}

cmd_backup() {
  title "备份数据库（停服约 5 秒）"
  if [ ! -x "$APP_DIR/deploy/backup.sh" ]; then bad "找不到 $APP_DIR/deploy/backup.sh"; exit 1; fi
  bash "$APP_DIR/deploy/backup.sh"
  ok "备份完成"
}

cmd_backups() {
  title "已有备份"
  ls -lh /var/backups/inventory 2>/dev/null | tail -n +2 | tail -14 | sed 's/^/  /'
  [ -d /var/backups/inventory ] || warn "还没有备份（kc backup 先手动跑一次）"
}

cmd_deploy() {
  title "拉代码 + 构建 + 重启"
  warn "这会在服务器上重新构建，约 1~3 分钟，期间页面仍可访问（构建完才重启）"
  bash "$APP_DIR/deploy/update.sh"
}

cmd_urls() {
  title "访问地址"
  local ip
  ip="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo '服务器公网IP')"
  dim "内网自测：http://127.0.0.1:$PORT"
  dim "公网 IP ：http://${ip}:${PORT}（需要安全组放行，且只建议临时用）"
  if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    dim "独立站  ：https://www.$DOMAIN"
    dim "库存台账：https://kc.$DOMAIN"
  else
    dim "域名地址：备案 + 证书完成后才有（install.sh --cert）"
  fi
}

case "${1:-help}" in
  status|s)   cmd_status ;;
  check|ck)   cmd_check ;;
  log|l)      cmd_log "${2:-50}" ;;
  logf|f)     cmd_logf ;;
  restart|r)  cmd_restart ;;
  data|d)     cmd_data ;;
  disk|df)    cmd_disk ;;
  backup|b)   cmd_backup ;;
  backups|bs) cmd_backups ;;
  deploy)     cmd_deploy ;;
  urls|u)     cmd_urls ;;
  help|-h|--help|*) cmd_help ;;
esac
