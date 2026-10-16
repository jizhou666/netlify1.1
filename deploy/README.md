# 部署到阿里云香港服务器（huiranpk.com）

一台服务器跑两个站：

| 域名 | 站点 | 实现 |
| --- | --- | --- |
| `huiranpk.com`、`www.huiranpk.com` | **独立站** | Nginx 直接伺服（静态 / PHP / Node 三种改法见配置注释） |
| `kc.huiranpk.com` | **库存台账** | Nginx 反代到 `127.0.0.1:8080`，由 systemd 托管 |

香港服务器**不需要 ICP 备案**；但阿里云买的域名要先完成**实名认证**，否则会被停止解析。

---

## 0. 先做三件事

1. **DNS**（阿里云 → 云解析 DNS → huiranpk.com → 解析设置 → 添加记录）

   | 类型 | 主机记录 | 记录值 |
   | --- | --- | --- |
   | A | `@` | 服务器公网 IP |
   | A | `www` | 服务器公网 IP |
   | A | `kc` | 服务器公网 IP |

   验证：`nslookup kc.huiranpk.com 223.5.5.5`

2. **安全组放行** `80`、`443`（应用自己只监听 127.0.0.1:8080，不对外）。

3. **服务器配置**：建议 2 核 4G 起（独立站 + 库存应用 + 内嵌 Postgres 同机）。系统 Ubuntu 22.04 / Alibaba Cloud Linux 3 都行。

---

## 1. 装 Node 22

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# 记住 node 的真实路径，systemd 单元里要用
which node            # 常见是 /usr/bin/node；nvm 装的会不一样
```

## 2. 放代码并构建

```bash
sudo mkdir -p /opt/inventory
sudo git clone https://github.com/jizhou666/netlify1.1.git /opt/inventory/app
cd /opt/inventory/app
sudo npm ci
sudo env SELF_HOST=1 npm run build   # 注意：必须带 SELF_HOST=1，否则不会输出 .output
```

> 仓库若是私有的，用部署密钥或 `https://<token>@github.com/...` 克隆。

## 3. 建用户、数据目录、环境变量

```bash
sudo useradd --system --home /opt/inventory --shell /usr/sbin/nologin inventory
sudo mkdir -p /var/lib/inventory
sudo chown -R inventory:inventory /var/lib/inventory

# 连接串等（照着 deploy/inventory.env.example 填）
sudo cp deploy/inventory.env.example /etc/inventory.env
sudo nano /etc/inventory.env        # 填 SYNC_DATABASE_URL
sudo chmod 600 /etc/inventory.env
```

## 4. 装成系统服务

```bash
sudo cp deploy/inventory.service /etc/systemd/system/inventory.service
sudo nano /etc/systemd/system/inventory.service   # 确认 ExecStart 的 node 路径
sudo systemctl daemon-reload
sudo systemctl enable --now inventory
systemctl status inventory --no-pager
curl -I http://127.0.0.1:8080/        # 应该 200
```

## 5. Nginx + 证书 + 访问密码

```bash
sudo cp deploy/nginx-huiranpk.conf /etc/nginx/conf.d/huiranpk.conf
sudo nano /etc/nginx/conf.d/huiranpk.conf     # 改独立站目录（默认 /var/www/huiranpk）
sudo nginx -t

# 签证书（需要 DNS 已生效、80 端口可达）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d huiranpk.com -d www.huiranpk.com -d kc.huiranpk.com

# 给库存加一层账号密码（强烈建议，应用本身没有登录）
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/htpasswd-inventory huiran
# 然后把配置里 auth_basic 那两行的注释去掉
sudo nano /etc/nginx/conf.d/huiranpk.conf
sudo nginx -t && sudo systemctl reload nginx
```

独立站如果是 WordPress：把配置里 PHP 那段注释打开、`root` 指到站点目录、装好 php-fpm；如果是 Node 应用：把反代那段打开，指向它自己的端口。

## 6. 把现有台账数据搬过来

**方式一（推荐，连手工流水一起搬）**：把 Windows 上的内嵌库整个拷过去。

```powershell
# Windows PowerShell
Compress-Archive -Path E:\netlify-git\data\pglite -DestinationPath E:\pglite.zip
scp E:\pglite.zip root@<服务器IP>:/tmp/
```

```bash
# 服务器
sudo systemctl stop inventory
sudo rm -rf /var/lib/inventory/pglite
sudo mkdir -p /var/lib/inventory
sudo unzip -q /tmp/pglite.zip -d /var/lib/inventory     # 解出 /var/lib/inventory/pglite
sudo chown -R inventory:inventory /var/lib/inventory
sudo systemctl start inventory
```

**方式二**：打开 `https://kc.huiranpk.com` → 「导入表格」→ 上传 `10.5.xlsx`（会按表格重建台账，应用里手工登记的流水会丢）。

**方式三**：`/etc/inventory.env` 里填 `DATABASE_URL`（Neon）→ 重启 → 数据以云端为准。跨区域会慢，只建议临时用。

## 7. 验证清单

```bash
curl -I https://huiranpk.com          # 独立站，200
curl -I https://www.huiranpk.com      # 独立站
curl -I https://kc.huiranpk.com       # 库存（会先弹账号密码）
curl -I http://<服务器IP>/            # 应该 444（兜底，不暴露库存）
```

浏览器里再确认一次：
- 登录后台账能打开、340 个货号在；
- 点某个货号「操作」→ 入库 → 保存成功；
- 「导入表格」能上传 10.5.xlsx（这条会验证 `client_max_body_size 40m` 生效）；
- 「云端同步」能连上 Neon。

## 8. 日常维护

```bash
# 更新代码（拉取 → 构建 → 重启 → 自检）
sudo /opt/inventory/app/deploy/update.sh

# 看日志
journalctl -u inventory -n 100 --no-pager -f

# 每日备份（停服 5 秒打包内嵌库，保留 14 份）
sudo crontab -e
# 加一行：
30 2 * * * /opt/inventory/app/deploy/backup.sh >> /var/log/inventory-backup.log 2>&1
```

## 9. 常见故障

| 现象 | 原因 / 处理 |
| --- | --- |
| 502 Bad Gateway | 应用没起来：`systemctl status inventory` + `journalctl -u inventory -n 50` |
| 413 Request Entity Too Large | 导入 Excel 被 Nginx 拦了：确认 kc 段里 `client_max_body_size 40m` 生效 |
| 域名打不开 / 证书失败 | DNS 没生效或安全组没放行 80；`nslookup` + `curl -I http://<IP>` 排查 |
| 页面很慢 | 别用美东 Neon 直连（`DATABASE_URL`）；保持本机内嵌库 + `SYNC_DATABASE_URL` |
| 磁盘涨得快 | 内嵌库会随流水增长（现在约 39MB）；开备份保留份数，或改用 Neon |

## 10. 上线后 Windows 那边怎么办

服务器 7×24 在线后，Windows 上那套（`启动库存系统.bat` + cpolar 隧道 + 常驻看守）就不需要天天开了：

- 想让服务器成为**唯一**台账：Windows 那份留作历史备份，别再往里录数据（两边各有一份内嵌库，数据会分叉）；
- 想继续用 Windows 做备份：保留「云端同步」按钮，定期把服务器上的台账推一次到 Neon 即可。
