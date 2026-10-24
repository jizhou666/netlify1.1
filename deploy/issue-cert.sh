#!/usr/bin/env bash
# 汇然：用阿里云 DNS 验证签发证书（不依赖 80 端口，国内最稳）
#
# 用法（在服务器上）：
#   sudo Ali_Key='AccessKeyID' Ali_Secret='AccessKeySecret' bash /root/issue-cert.sh
#
# 这个 RAM 用户只需要 AliyunDNSFullAccess 权限。
# 证书装到 /etc/letsencrypt/live/huiranpk.com/，并自动配置 90 天续期（acme.sh 的 cron）。
set -euo pipefail

DOMAIN="${DOMAIN:-huiranpk.com}"
DOMAINS="${DOMAINS:-$DOMAIN www.$DOMAIN kc.$DOMAIN}"
EMAIL="${EMAIL:-admin@huiranpk.com}"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

if [ -z "${Ali_Key:-}" ] || [ -z "${Ali_Secret:-}" ]; then
  echo "用法：sudo Ali_Key='你的AccessKeyID' Ali_Secret='你的AccessKeySecret' bash $0" >&2
  exit 1
fi
export Ali_Key Ali_Secret

echo "== 1/5 准备 acme.sh =="
ACME="/root/.acme.sh/acme.sh"
if [ ! -x "$ACME" ]; then
  echo "下载 acme.sh…"
  if ! curl -fsSL --max-time 60 https://gitee.com/neilpang/acme.sh/raw/master/acme.sh -o /root/acme.sh; then
    echo "gitee 取不到，改用 GitHub…"
    curl -fsSL --max-time 90 https://raw.githubusercontent.com/acmesh-official/acme.sh/master/acme.sh -o /root/acme.sh
  fi
  chmod +x /root/acme.sh
  # --install 会复制到 ~/.acme.sh 并安装续期 cron
  /root/acme.sh --install -m "$EMAIL" >/dev/null 2>&1 || true
fi
[ -x "$ACME" ] || ACME="/root/acme.sh"
if [ ! -x "$ACME" ]; then
  echo "acme.sh 没准备好，请手动下载后重试" >&2
  exit 1
fi
"$ACME" --set-default-ca --server letsencrypt >/dev/null 2>&1 || true
echo "acme.sh: $ACME ($("$ACME" --version 2>/dev/null | head -1))"

echo "== 2/5 用阿里云 DNS 验证签发证书 =="
# shellcheck disable=SC2086
"$ACME" --issue --dns dns_ali --server letsencrypt --keylength ec-256 \
  -d "$DOMAIN" -d "www.$DOMAIN" -d "kc.$DOMAIN" 2>&1 | tail -25

echo "== 3/5 安装证书到 $CERT_DIR =="
mkdir -p "$CERT_DIR"
KEY_FILE="$CERT_DIR/privkey.pem"
FULLCHAIN="$CERT_DIR/fullchain.pem"
CHAIN="$CERT_DIR/chain.pem"
CERT_FILE="$CERT_DIR/cert.pem"

"$ACME" --install-cert -d "$DOMAIN" --ecc \
  --key-file "$KEY_FILE" \
  --fullchain-file "$FULLCHAIN" \
  --cert-file "$CERT_FILE" \
  --ca-file "$CHAIN" \
  --reloadcmd "systemctl reload nginx" 2>&1 | tail -8

echo "== 4/5 校验证书 =="
if [ -f "$FULLCHAIN" ]; then
  openssl x509 -in "$FULLCHAIN" -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null | sed 's/^/  /'
else
  echo "证书文件没生成，失败" >&2
  exit 1
fi

echo "== 5/5 续期任务 =="
crontab -l 2>/dev/null | grep -q 'acme.sh --cron' && echo "  已存在 acme.sh 续期 cron" || {
  ( crontab -l 2>/dev/null; echo "17 3 * * * \"$ACME\" --cron --home \"/root/.acme.sh\" > /dev/null" ) | crontab -
  echo "  已添加每日 03:17 检查续期"
}

echo
echo "完成。接下来："
echo "  bash /opt/inventory/app/deploy/install.sh   # 只会装 Nginx 配置（证书已存在），或手动："
echo "  cp /opt/inventory/app/deploy/nginx-huiranpk.conf /etc/nginx/conf.d/huiranpk.conf"
echo "  nginx -t && systemctl reload nginx"
