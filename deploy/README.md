# 部署到阿里云香港服务器（huiranpk.com）

一台服务器跑两个站：

| 域名 | 站点 | 技术栈 | 本机端口 |
| --- | --- | --- | --- |
| `huiranpk.com`、`www.huiranpk.com` | **独立站**（company-site） | 纯 Node（只用内置模块，无构建、无 npm 依赖） | 8081 |
| `kc.huiranpk.com` | **库存台账** | TanStack Start + Nitro + 内嵌 Postgres(PGLite) | 8080 |

香港服务器**不需要 ICP 备案**；但阿里云买的域名要先完成**实名认证**，否则会被停止解析。

## 服务器要多大

实测占用（两个应用 + Nginx + 系统）：

| 项 | 内存 |
| --- | --- |
| 库存台账（Node + 内嵌 Postgres） | 约 170 MB |
| 独立站（纯 Node 静态服务） | 约 40~60 MB |
| Nginx | 约 20 MB |
| 系统 + SSH + cron | 约 200 MB |
| **合计** | **约 450 MB** |

**结论：2 核 2G 够用**，还剩 1.5G 余量。建议无论几 G 都加 2G swap 兜底：

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10
```

> 只有在「服务器上还要跑 MySQL/WordPress」或「想在服务器上跑 npm 构建」时才需要 4G。
> 本项目两个应用都不需要：独立站无构建，库存站的构建可以在本地做完再传，或临时加 swap 构建。

---

## 0. 先做三件事

1. **DNS**（阿里云 → 云解析 DNS → huiranpk.com → 解析设置 → 添加记录）

   | 类型 | 主机记录 | 记录值 |
   | --- | --- | --- |
   | A | `@` | 服务器公网 IP |
   | A | `www` | 服务器公网 IP |
   | A | `kc` | 服务器公网 IP |

   验证：`nslookup kc.huiranpk.com 223.5.5.5`

2. **安全组只放行 `22`、`80`、`443`**。
   ⚠️ **不要放行 8080 / 8081**：这两个端口只给 Nginx 在本机反代，独立站的 `server.js`
   默认绑 `0.0.0.0`，端口一旦对外，后台登录就是明文 HTTP 送到公网。

3. 系统：Ubuntu 22.04 / Alibaba Cloud Linux 3 都行。

---

## 1. 装 Node 22 和 Nginx

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx

which node     # 记下路径，systemd 单元里要用（常见 /usr/bin/node）
```

## 2. 部署库存台账

```bash
sudo mkdir -p /opt/inventory
sudo git clone https://github.com/jizhou666/netlify1.1.git /opt/inventory/app
cd /opt/inventory/app
sudo npm ci
sudo env SELF_HOST=1 npm run build      # 必须带 SELF_HOST=1，否则不输出 .output

sudo useradd --system --home /opt/inventory --shell /usr/sbin/nologin inventory
sudo mkdir -p /var/lib/inventory
sudo chown -R inventory:inventory /var/lib/inventory

sudo cp deploy/inventory.env.example /etc/inventory.env
sudo nano /etc/inventory.env            # 填 SYNC_DATABASE_URL
sudo chmod 600 /etc/inventory.env

sudo cp deploy/inventory.service /etc/systemd/system/inventory.service
sudo nano /etc/systemd/system/inventory.service   # 核对 ExecStart 里的 node 路径
sudo systemctl daemon-reload
sudo systemctl enable --now inventory
curl -I http://127.0.0.1:8080/          # 应该 200
```

> 仓库若是私有的，用部署密钥或 `https://<token>@github.com/...` 克隆。

## 3. 部署独立站（company-site）

它没有构建步骤、没有 npm 依赖（`express`/`cookie-parser` 只是写在 package.json 里，代码没用到），
**把目录拷过去就能跑**。要带过去的是内容数据：`data/`（后台配置 + 询盘内容）和 `uploads/`（图片视频）。

```powershell
# Windows PowerShell：打包（logs 不用带）
cd E:\HRBZ
Compress-Archive -Path company-site -DestinationPath E:\company-site.zip
scp E:\company-site.zip root@<服务器IP>:/tmp/
```

```bash
# 服务器
sudo apt install -y unzip
sudo unzip -q /tmp/company-site.zip -d /opt        # 解出 /opt/company-site

sudo useradd --system --home /opt/company-site --shell /usr/sbin/nologin huiran
sudo chown -R root:root /opt/company-site
sudo chown -R huiran:huiran /opt/company-site/uploads /opt/company-site/data /opt/company-site/logs

# 建议改一行，让它只听本机（Nginx 反代就够，避免 8081 直接暴露）
sudo sed -i 's/server\.listen(PORT, () =>/server.listen(PORT, process.env.HOST || "0.0.0.0", () =>/' /opt/company-site/server.js
grep -n 'server.listen' /opt/company-site/server.js
```

⚠️ **独立站的后台默认密码是 `huiran2026`，而且启动时会打印在控制台**（`server.js` 第 654 行附近）。
上线后第一件事就是登录 `/admin/` 改掉它，并确认 `data/config.json` 的权限只有服务用户可读：

```bash
sudo chmod 600 /opt/company-site/data/config.json
```

systemd 单元用仓库里的 `deploy/company-site.service`：

```bash
sudo cp /opt/inventory/app/deploy/company-site.service /etc/systemd/system/company-site.service
sudo nano /etc/systemd/system/company-site.service     # 核对 ExecStart 的 node 路径
sudo systemctl daemon-reload
sudo systemctl enable --now company-site
curl -I http://127.0.0.1:8081/          # 应该 200
```

## 4. Nginx + 证书 + 访问密码

```bash
sudo cp /opt/inventory/app/deploy/nginx-huiranpk.conf /etc/nginx/conf.d/huiranpk.conf
sudo nginx -t

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d huiranpk.com -d www.huiranpk.com -d kc.huiranpk.com

# 给库存加一层账号密码（强烈建议，库存应用自身没有登录）
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/htpasswd-inventory huiran
sudo nano /etc/nginx/conf.d/huiranpk.conf      # 去掉 auth_basic 两行的注释
sudo nginx -t && sudo systemctl reload nginx
```

## 5. 把现有库存数据搬过来

**方式一（推荐，连手工流水一起搬）**：把 Windows 上的内嵌库整个拷过去。

```powershell
Compress-Archive -Path E:\netlify-git\data\pglite -DestinationPath E:\pglite.zip
scp E:\pglite.zip root@<服务器IP>:/tmp/
```

```bash
sudo systemctl stop inventory
sudo rm -rf /var/lib/inventory/pglite
sudo unzip -q /tmp/pglite.zip -d /var/lib/inventory     # 解出 /var/lib/inventory/pglite
sudo chown -R inventory:inventory /var/lib/inventory
sudo systemctl start inventory
```

**方式二**：打开 `https://kc.huiranpk.com` → 「导入表格」→ 上传 `10.5.xlsx`（按表格重建，手工登记的流水会丢）。

**方式三**：`/etc/inventory.env` 填 `DATABASE_URL`（Neon）→ 重启，数据以云端为准（跨区域会慢，只建议临时用）。

## 6. 验证清单

```bash
curl -I https://huiranpk.com          # 301 → www
curl -I https://www.huiranpk.com      # 独立站 200
curl -I https://kc.huiranpk.com       # 库存（先弹账号密码）
curl -I http://<服务器IP>/            # 应该 444
curl -I http://<服务器IP>:8081/       # 应该连不上（安全组没放行）
```

浏览器再过一遍：
- 独立站首页、语言切换、后台 `/admin/` 能登录；
- 后台传一张图（验证独立站的 `client_max_body_size 30m` 生效）；
- 库存台账能打开、340 个货号在；点某行「操作」→ 入库 → 保存成功；
- 「导入表格」能上传 10.5.xlsx（验证 40m 生效）；「云端同步」能连上 Neon。

## 7. 日常维护

```bash
# 更新库存站（拉代码 → 构建 → 重启 → 自检）
sudo /opt/inventory/app/deploy/update.sh

# 独立站更新：重新 scp 覆盖后重启即可
sudo systemctl restart company-site

# 日志
journalctl -u inventory -n 100 --no-pager -f
journalctl -u company-site -n 100 --no-pager -f

# 每日备份内嵌库（停服 5 秒打包，保留 14 份）
sudo crontab -e
30 2 * * * /opt/inventory/app/deploy/backup.sh >> /var/log/inventory-backup.log 2>&1
```

## 8. 常见故障

| 现象 | 原因 / 处理 |
| --- | --- |
| 502 Bad Gateway | 对应应用没起来：`systemctl status inventory` / `company-site`，再看 journalctl |
| 413 Request Entity Too Large | 上传被 Nginx 拦：独立站要 `30m`、库存要 `40m`，确认对应 server 块生效 |
| 域名打不开 / 证书失败 | DNS 未生效或安全组没放行 80；`nslookup` + `curl -I http://<IP>` |
| 库存页面很慢 | 别直连美东 Neon（`DATABASE_URL`）；保持本机内嵌库 + `SYNC_DATABASE_URL` |
| 内存被吃满 / 服务被杀 | `free -h`、`ps aux --sort=-%mem \| head`；加 swap；必要时升配到 4G |
| 后台密码泄露风险 | 确认安全组没开 8081，`server.listen` 已绑 `127.0.0.1`，HTTPS 已生效 |

## 9. 上线后 Windows 那边怎么办

服务器 7×24 在线后，Windows 上那两套隧道/看守（`启动库存系统.bat`、company-site 的 `启动.bat`/隧道脚本）都不需要天天开：

- 想让服务器成为**唯一**数据源：Windows 那份留作历史备份，别再往里录数据（两边各有一份内嵌库，会分叉）；
- 想继续用 Windows 做备份：保留库存页面的「云端同步」按钮，定期推一次到 Neon。
