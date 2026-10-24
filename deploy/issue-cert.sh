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

echo "== 1/5 准备 acme.sh（必须带 dns_ali 插件） =="
ACME="/root/.acme.sh/acme.sh"
have_plugin() { [ -f /root/.acme.sh/dnsapi/dns_ali.sh ] || [ -f /root/acme.sh-src/dnsapi/dns_ali.sh ]; }

if [ ! -x "$ACME" ] || ! have_plugin; then
  echo "下载 acme.sh 完整包（含 dnsapi 插件）…"
  rm -rf /root/acme.sh-src
  if git clone --depth 1 -q https://gitee.com/neilpang/acme.sh.git /root/acme.sh-src 2>/dev/null \
     || git clone --depth 1 -q https://github.com/acmesh-official/acme.sh.git /root/acme.sh-src 2>/dev/null; then
    chmod +x /root/acme.sh-src/acme.sh
    echo "  已克隆到 /root/acme.sh-src"
    /root/acme.sh-src/acme.sh --install -m "$EMAIL" >/dev/null 2>&1 || true
  else
    echo "  克隆失败，退回单文件方式"
    curl -fsSL --max-time 60 https://gitee.com/neilpang/acme.sh/raw/master/acme.sh -o /root/acme.sh || \
      curl -fsSL --max-time 90 https://raw.githubusercontent.com/acmesh-official/acme.sh/master/acme.sh -o /root/acme.sh
    chmod +x /root/acme.sh
    /root/acme.sh --install -m "$EMAIL" >/dev/null 2>&1 || true
  fi
fi

# 兜底：直接补插件文件
if [ ! -f /root/.acme.sh/dnsapi/dns_ali.sh ]; then
  mkdir -p /root/.acme.sh/dnsapi
  curl -fsSL --max-time 60 https://gitee.com/neilpang/acme.sh/raw/master/dnsapi/dns_ali.sh -o /root/.acme.sh/dnsapi/dns_ali.sh 2>/dev/null || \
  curl -fsSL --max-time 90 https://raw.githubusercontent.com/acmesh-official/acme.sh/master/dnsapi/dns_ali.sh -o /root/.acme.sh/dnsapi/dns_ali.sh
fi
if [ ! -f /root/.acme.sh/dnsapi/dns_ali.sh ]; then
  echo "dns_ali 插件仍然缺失。请执行并把结果贴给我：" >&2
  echo "  ls -l /root/acme.sh-src/dnsapi/ | head" >&2
  exit 1
fi

[ -x "$ACME" ] || ACME="/root/.acme.sh/acme.sh"
echo "acme.sh: $ACME"
echo "dns_ali 插件: $(wc -c < /root/.acme.sh/dnsapi/dns_ali.sh) 字节"

echo "== 2/5 用阿里云 DNS 验证签发证书 =="
# Let's Encrypt 是多点校验，个别校验节点查国内 DNS 可能 SERVFAIL；
# 失败就自动改用 ZeroSSL（单点校验，国内更稳），证书浏览器都认。
issue_with() {
  local ca="$1" server="$2" out
  echo "—— 尝试 CA：$ca ——"
  # shellcheck disable=SC2086
  if out=$("$ACME" --issue --dns dns_ali --server "$server" --keylength ec-256 --dnssleep 30 \
      -d "$DOMAIN" -d "www.$DOMAIN" -d "kc.$DOMAIN" 2>&1); then
    echo "$out" | tail -12
    return 0
  fi
  echo "$out" | tail -12
  return 1
}

ISSUED=0
if issue_with "Let's Encrypt" letsencrypt; then
  ISSUED=1
else
  echo
  echo "Let's Encrypt 没通过（多为多点校验偶发失败），改用 ZeroSSL 再试一次…"
  "$ACME" --register-account -m "$EMAIL" --server zerossl >/dev/null 2>&1 || true
  if issue_with "ZeroSSL" zerossl; then
    ISSUED=1
  fi
fi
if [ "$ISSUED" != "1" ]; then
  echo
  echo "两家 CA 都没签成。把上面最后 20 行贴给管理员。" >&2
  exit 1
fi

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
