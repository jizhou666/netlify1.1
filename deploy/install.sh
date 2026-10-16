#!/usr/bin/env bash
# 汇然：一键安装 / 更新（Ubuntu 22.04 / 24.04，用 root 运行）
#
#   sudo bash deploy/install.sh              # 装环境 + 部署库存台账（+ 有 company-site 就一起配）
#   sudo bash deploy/install.sh --cert       # 备案通过、域名解析好之后执行：申请证书 + 装正式 Nginx 配置
#
# 可重复运行：已存在的配置会先备份再覆盖，已装好的会跳过。
#
# 可选环境变量：
#   DOMAIN=huiranpk.com       主域名
#   EMAIL=you@example.com     证书通知邮箱（--cert 时需要）
#   APP_DIR=/opt/inventory/app   库存代码目录（默认就是本脚本所在的仓库目录）
#   SITE_DIR=/opt/company-site   独立站目录
set -euo pipefail

DOMAIN="${DOMAIN:-huiranpk.com}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$REPO_DIR}"
SITE_DIR="${SITE_DIR:-/opt/company-site}"
DATA_DIR="/var/lib/inventory"
NGINX_CONF="/etc/nginx/conf.d/${DOMAIN}.conf"
WITH_CERT=0
if [[ "${1:-}" == "--cert" ]]; then WITH_CERT=1; fi

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[注意] %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[错误] %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == "0" ]] || die "请用 root 运行：sudo bash $0"
[[ -f "$REPO_DIR/deploy/inventory.service" ]] || die "找不到 deploy/inventory.service，请在仓库目录里运行本脚本"

log "1/8 系统信息"
# shellcheck disable=SC1091
. /etc/os-release 2>/dev/null || true
echo "    系统：${PRETTY_NAME:-未知}"
echo "    仓库：$REPO_DIR"
echo "    域名：$DOMAIN"

log "2/8 换国内镜像源并安装依赖"
if grep -q 'archive.ubuntu.com' /etc/apt/sources.list 2>/dev/null; then
  cp -n /etc/apt/sources.list "/etc/apt/sources.list.bak.$(date +%s)" || true
  sed -i 's|//.*archive.ubuntu.com|//mirrors.aliyun.com|g; s|//.*security.ubuntu.com|//mirrors.aliyun.com|g' /etc/apt/sources.list
  ok "apt 源已换阿里云"
fi
if [ -d /etc/apt/sources.list.d ]; then
  grep -rl 'archive.ubuntu.com\|security.ubuntu.com' /etc/apt/sources.list.d 2>/dev/null \
    | xargs -r sed -i 's|//.*archive.ubuntu.com|//mirrors.aliyun.com|g; s|//.*security.ubuntu.com|//mirrors.aliyun.com|g' || true
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates unzip nginx xz-utils >/dev/null
ok "基础软件装好"

# Node 22：优先用国内镜像的官方二进制（比 nodesource 快且稳）
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  echo "    正在安装 Node 22 …"
  BASE="https://registry.npmmirror.com/-/binary/node/latest-v22.x"
  FILE="$(curl -fsSL "$BASE/" 2>/dev/null | grep -oE 'node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -1 || true)"
  if [ -n "$FILE" ]; then
    curl -fsSL -o /tmp/node.tar.xz "$BASE/$FILE"
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 || die "解压 Node 失败，请手动安装 Node 22 后重跑本脚本"
    rm -f /tmp/node.tar.xz
  else
    warn "国内镜像取不到，改用官方源（会慢一些）"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  fi
fi
NODE_BIN="$(command -v node)"
ok "Node：$($NODE_BIN -v)（$NODE_BIN）"
npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 || true
ok "npm 源：$(npm config get registry)"

log "3/8 配置 2G swap（2G 内存的机器防 OOM）"
if swapon --show 2>/dev/null | grep -q '/swapfile' || [ -f /swapfile ]; then
  ok "swap 已存在，跳过"
else
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -qw vm.swappiness=10
  ok "已加 2G swap"
fi

log "4/8 建用户和目录"
id -u inventory >/dev/null 2>&1 || useradd --system --home /opt/inventory --shell /usr/sbin/nologin inventory
id -u huiran    >/dev/null 2>&1 || useradd --system --home "$SITE_DIR" --shell /usr/sbin/nologin huiran
mkdir -p "$DATA_DIR"
chown -R inventory:inventory "$DATA_DIR"
ok "用户 inventory / huiran、数据目录 $DATA_DIR"

log "5/8 构建库存台账"
cd "$APP_DIR"
if [ ! -f package.json ]; then
  die "$APP_DIR 里没有 package.json：请先把仓库 clone 到 $APP_DIR 再运行本脚本"
fi
if [ ! -f package-lock.json ]; then npm install; else npm ci; fi
SELF_HOST=1 npm run build || die "构建失败：看看上面的报错（内存不足可在阿里云控制台点「内存优化」或再跑一次本脚本，它会加 swap）"
ok "构建完成（$APP_DIR/.output）"

if [ ! -f /etc/inventory.env ]; then
  cp "$APP_DIR/deploy/inventory.env.example" /etc/inventory.env
  chmod 600 /etc/inventory.env
  warn "已生成 /etc/inventory.env —— 需要时编辑它填 SYNC_DATABASE_URL（云端同步用），然后 systemctl restart inventory"
else
  ok "/etc/inventory.env 已存在，未改动"
fi

install_unit() { # install_unit <源单元文件> <目标名> <WorkingDirectory>
  local src="$1" dst="$2" wd="$3"
  sed -e "s|/usr/bin/node|$NODE_BIN|" \
      -e "s|WorkingDirectory=[^ ]*|WorkingDirectory=$wd|" \
      "$src" > "/etc/systemd/system/$dst"
}

log "6/8 配置 systemd 服务"
install_unit "$APP_DIR/deploy/inventory.service" inventory.service "$APP_DIR"
systemctl daemon-reload
systemctl enable --now inventory >/dev/null 2>&1 || warn "inventory 启动失败，看：journalctl -u inventory -n 50"
sleep 3
systemctl is-active --quiet inventory && ok "inventory 已启动" || warn "inventory 没起来，看：journalctl -u inventory -n 50"

if [ -d "$SITE_DIR" ] && [ -f "$SITE_DIR/server.js" ]; then
  install_unit "$APP_DIR/deploy/company-site.service" company-site.service "$SITE_DIR"
  chown -R root:root "$SITE_DIR"
  chown -R huiran:huiran "$SITE_DIR/uploads" "$SITE_DIR/data" "$SITE_DIR/logs" 2>/dev/null || true
  [ -f "$SITE_DIR/data/config.json" ] && chmod 600 "$SITE_DIR/data/config.json" || true
  sed -i 's/server\.listen(PORT, () =>/server.listen(PORT, process.env.HOST || "0.0.0.0", () =>/' "$SITE_DIR/server.js" 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable --now company-site >/dev/null 2>&1 || warn "company-site 启动失败，看：journalctl -u company-site -n 50"
  sleep 2
  systemctl is-active --quiet company-site && ok "company-site 已启动" || warn "company-site 没起来，看：journalctl -u company-site -n 50"
else
  warn "还没放独立站代码（$SITE_DIR/server.js 不存在）——传上来之后再跑一次本脚本即可自动配好"
fi

log "7/8 自检"
if curl -fsS --max-time 10 http://127.0.0.1:8080/ -o /dev/null; then ok "库存台账 127.0.0.1:8080 正常"; else warn "库存台账没应答"; fi
if curl -fsS --max-time 10 http://127.0.0.1:8081/ -o /dev/null; then ok "独立站 127.0.0.1:8081 正常"; else warn "独立站没应答（代码还没放？）"; fi

log "8/8 Nginx"
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if [ "$WITH_CERT" == "1" ] && [ ! -f "$CERT" ]; then
  EMAIL="${EMAIL:-}"
  if [ -z "$EMAIL" ]; then
    if [ -t 0 ]; then
      read -r -p "    证书通知邮箱（备案时用的邮箱即可）：" EMAIL
    else
      die "请带上邮箱运行：sudo EMAIL=你的邮箱 bash $0 --cert"
    fi
  fi
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  # 先用纯 HTTP 配置，让 certbot 能完成域名校验
  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { proxy_pass http://127.0.0.1:8081; proxy_set_header Host \$host; }
}
server {
    listen 80;
    server_name kc.$DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host \$host; }
}
EOF
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  echo "    正在申请证书（需要域名已解析到本机、80 端口已放行）…"
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" -d "kc.$DOMAIN" \
    --agree-tos -m "$EMAIL" --non-interactive --redirect \
    || die "证书申请失败：确认 DNS 已解析到本机、安全组放行 80、备案已通过"
  ok "证书已签发"
fi

if [ -f "$CERT" ]; then
  [ -f "$NGINX_CONF" ] && cp "$NGINX_CONF" "$NGINX_CONF.bak.$(date +%s)"
  sed "s|huiranpk\.com|$DOMAIN|g" "$APP_DIR/deploy/nginx-huiranpk.conf" > "$NGINX_CONF"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  ok "正式 Nginx 配置已生效（$NGINX_CONF）"

  if [ ! -f /etc/nginx/htpasswd-inventory ]; then
    apt-get install -y -qq apache2-utils >/dev/null
    warn "库存还没加访问密码。建议执行："
    echo "      sudo htpasswd -c /etc/nginx/htpasswd-inventory huiran"
    echo "    然后去掉 $NGINX_CONF 里 auth_basic 两行的注释，再 nginx -t && systemctl reload nginx"
  fi
else
  warn "证书还没有，先跳过正式 Nginx 配置。当前用 IP + 端口访问："
  echo "      独立站：http://<公网IP>:8081"
  echo "      库存：  http://<公网IP>:8080        （记得安全组只放行你自己的 IP）"
fi

cat <<EOF

────────────────────────────────────────
下一步清单
────────────────────────────────────────
1) 安全组放行（阿里云控制台 → 本实例 → 安全组 → 入方向）：
   · 现在：22（限你公司 IP）、8080、8081（限你公司 IP，用于内部试跑）
   · 备案通过后：80、443 对全网开放；8080/8081 收回，不再对外
2) 数据搬迁（把 Windows 上的台账搬过来）：
   在 Windows 执行：
     Compress-Archive -Path E:\\netlify-git\\data\\pglite -DestinationPath E:\\pglite.zip
     scp E:\\pglite.zip root@<公网IP>:/tmp/
   在服务器执行：
     systemctl stop inventory
     rm -rf $DATA_DIR/pglite
     unzip -q /tmp/pglite.zip -d $DATA_DIR
     chown -R inventory:inventory $DATA_DIR
     systemctl start inventory
3) 独立站代码：把 company-site.zip 传上来到 /opt/company-site，再跑一次本脚本
4) 备案通过 + DNS 解析好之后，执行：
     sudo EMAIL=你的邮箱 bash $APP_DIR/deploy/install.sh --cert
5) 日常：更新库存站用 $APP_DIR/deploy/update.sh；备份看 deploy/backup.sh
EOF

log "全部完成 ✅"
