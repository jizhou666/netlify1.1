# 部署到云服务器（huiranpk.com）

一台服务器跑两个站：

| 域名 | 站点 | 技术栈 | 本机端口 |
| --- | --- | --- | --- |
| `huiranpk.com`、`www.huiranpk.com` | **独立站**（company-site） | 纯 Node（只用内置模块，无构建、无 npm 依赖） | 8081 |
| `kc.huiranpk.com` | **库存台账** | TanStack Start + Nitro + 内嵌 Postgres(PGLite) | 8080 |

---

## 一、选地域：香港 还是 大陆

| | 香港 | 大陆（杭州/深圳等） |
| --- | --- | --- |
| ICP 备案 | **不需要** | **必须备案**，否则域名走 80/443 被拦 |
| 域名可用时间 | 买完解析一下，当天就能用 | 要等备案通过，**约 2~4 周** |
| 大陆访问速度 | 30~80ms，普通 BGP 晚高峰会抖 | 20~40ms，最稳 |
| 备案服务号 | 不需要 | 需要，**只有买满 3 个月的正式实例才有**（免费试用实例不给） |
| 其他 | — | 备案通过后 30 日内还要做**公安备案** |

**走向大陆服务器，按下面的顺序做**（顺序反了会白等）：

1. **域名实名认证**（阿里云控制台 → 域名；1~3 天同步）
2. **买正式实例**：包年包月 **≥3 个月**（才有备案服务号），地域选杭州/深圳等，2 核 4G 起
3. **先把两个站部署起来**，用 `http://<公网IP>:8080` / `:8081` 内部试用（见第四~七节）
4. **提交 ICP 备案**：阿里云备案控制台 → 填主体/网站信息 → 阿里云初审（1~2 工作日）→ 短信核验 → **管局审核 7~20 个工作日**
   - 企业备案材料：营业执照、法人身份证、网站负责人身份证、备案服务号、（部分省份）核验视频
   - 备案期间**域名先别解析到这台机器**（解析了 80/443 也不通）
5. **备案通过后**：把 `@` / `www` / `kc` 三条 A 记录指向服务器 → 签证书 → 正式上线
6. **公安备案**：备案通过 30 日内到「全国互联网安全管理服务平台」登记

> ⚠️ 备案期间这两个端口是**明文 HTTP**（没有证书），而且库存应用本身没有登录。
> 请在阿里云**防火墙/安全组里只放行你公司出口 IP**，不要对全网开 8080/8081，等域名 + HTTPS 配好再放开。

## 二、服务器要多大

实测占用（两个应用 + Nginx + 系统）：

| 项 | 内存 |
| --- | --- |
| 库存台账（Node + 内嵌 Postgres） | 约 170 MB |
| 独立站（纯 Node 静态服务） | 约 40~60 MB |
| Nginx | 约 20 MB |
| 系统 + SSH + cron | 约 200 MB |
| **合计** | **约 450 MB** |

**2 核 2G 够用**，2 核 4G 更宽裕。建议加 2G swap 兜底：

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10
```

---

## 三、装环境（大陆服务器换国内镜像，快很多）

```bash
# ① apt 换阿里云源（按系统版本改 focal/jammy/noble）
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak
sudo sed -i 's|//.*archive.ubuntu.com|//mirrors.aliyun.com|g; s|//.*security.ubuntu.com|//mirrors.aliyun.com|g' /etc/apt/sources.list
sudo apt update

# ② 装 Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx unzip

# ③ npm 换国内源（构建快、不容易断）
npm config set registry https://registry.npmmirror.com

which node      # 记下路径，systemd 单元里要用
```

## 四、部署库存台账

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

## 五、部署独立站（company-site）

它没有构建步骤、没有 npm 依赖（`express`/`cookie-parser` 只是写在 package.json 里，代码没用到），
**把目录拷过去就能跑**。要带的是内容数据：`data/`（后台配置 + 询盘内容）和 `uploads/`。

```powershell
# Windows PowerShell
cd E:\HRBZ
Compress-Archive -Path company-site -DestinationPath E:\company-site.zip
scp E:\company-site.zip root@<服务器IP>:/tmp/
```

```bash
# 服务器
sudo unzip -q /tmp/company-site.zip -d /opt        # 解出 /opt/company-site

sudo useradd --system --home /opt/company-site --shell /usr/sbin/nologin huiran
sudo chown -R root:root /opt/company-site
sudo chown -R huiran:huiran /opt/company-site/uploads /opt/company-site/data /opt/company-site/logs

# 让它只听本机（Nginx 反代就够，避免 8081 直接暴露）
sudo sed -i 's/server\.listen(PORT, () =>/server.listen(PORT, process.env.HOST || "0.0.0.0", () =>/' /opt/company-site/server.js
grep -n 'server.listen' /opt/company-site/server.js

sudo cp /opt/inventory/app/deploy/company-site.service /etc/systemd/system/company-site.service
sudo nano /etc/systemd/system/company-site.service     # 核对 node 路径
sudo systemctl daemon-reload
sudo systemctl enable --now company-site
curl -I http://127.0.0.1:8081/          # 应该 200
```

⚠️ **独立站后台默认密码是 `huiran2026`，启动时会打印在控制台**。上线后第一件事就是登录 `/admin/` 改掉，并
`sudo chmod 600 /opt/company-site/data/config.json`。

## 六、Nginx + 证书 + 访问密码

```bash
sudo cp /opt/inventory/app/deploy/nginx-huiranpk.conf /etc/nginx/conf.d/huiranpk.conf
sudo nginx -t && sudo systemctl reload nginx
```

**备案通过、域名解析生效后**再签证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d huiranpk.com -d www.huiranpk.com -d kc.huiranpk.com

# 给库存加账号密码（强烈建议，库存应用自身没有登录）
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/htpasswd-inventory huiran
sudo nano /etc/nginx/conf.d/huiranpk.conf      # 去掉 auth_basic 两行的注释
sudo nginx -t && sudo systemctl reload nginx
```

**防火墙（安全组）规则**：

| 阶段 | 放行 |
| --- | --- |
| 备案期间 | `22`、`80`、`443`（限自己 IP）+ `8080`、`8081`（限自己 IP） |
| 上线后 | `22`（限自己 IP）、`80`、`443`；**8080/8081 始终不要对全网开** |

## 七、把现有数据搬过来

**库存**（推荐，连手工流水一起搬）：

```powershell
Compress-Archive -Path E:\netlify-git\data\pglite -DestinationPath E:\pglite.zip
scp E:\pglite.zip root@<服务器IP>:/tmp/
```

```bash
sudo systemctl stop inventory
sudo rm -rf /var/lib/inventory/pglite
sudo unzip -q /tmp/pglite.zip -d /var/lib/inventory
sudo chown -R inventory:inventory /var/lib/inventory
sudo systemctl start inventory
```

或者打开台账 → 「导入表格」→ 上传 `10.5.xlsx`（按表格重建，手工登记的流水会丢）。

**独立站**：`data/` + `uploads/` 已随目录一起拷过去（见第五节）。

## 八、验证清单

```bash
curl -I http://127.0.0.1:8080/        # 库存
curl -I http://127.0.0.1:8081/        # 独立站
# 备案通过并解析后：
curl -I https://huiranpk.com          # 301 → www
curl -I https://www.huiranpk.com      # 独立站 200
curl -I https://kc.huiranpk.com       # 库存（先弹账号密码）
curl -I http://<服务器IP>/            # 444（兜底）
```

浏览器再确认：独立站首页/语言切换/后台登录；后台上传一张图（验证 30m 限制）；库存台账货号都在、点「操作」入库成功；「导入表格」能上传 Excel（验证 40m）；「云端同步」能连 Neon。

## 九、日常维护

```bash
sudo /opt/inventory/app/deploy/update.sh        # 更新库存站（拉代码→构建→重启→自检）
sudo systemctl restart company-site             # 独立站更新后重启
journalctl -u inventory -n 100 --no-pager -f    # 日志
journalctl -u company-site -n 100 --no-pager -f

# 每日备份内嵌库（停服 5 秒打包，保留 14 份）
sudo crontab -e
30 2 * * * /opt/inventory/app/deploy/backup.sh >> /var/log/inventory-backup.log 2>&1
```

## 十、常见故障

| 现象 | 原因 / 处理 |
| --- | --- |
| 域名打不开、用 IP 能开 | 备案没通过（大陆机器拦 80/443），或 DNS 没生效 |
| 502 Bad Gateway | 应用没起来：`systemctl status inventory` / `company-site` + journalctl |
| 413 Request Entity Too Large | 上传被 Nginx 拦：独立站要 `30m`、库存要 `40m` |
| npm 安装极慢 / 超时 | 没换国内源：`npm config set registry https://registry.npmmirror.com` |
| 库存页面很慢 | 别直连美东 Neon（`DATABASE_URL`）；保持本机内嵌库 + `SYNC_DATABASE_URL` |
| 内存被吃满、服务被杀 | 加 swap；必要时升配；`ps aux --sort=-%mem \| head` |
| 后台密码泄露风险 | 确认 8080/8081 没对全网开、`server.listen` 已绑 `127.0.0.1`、HTTPS 已生效、后台默认密码已改 |

## 十一、上线后 Windows 那边怎么办

服务器 7×24 在线后，Windows 上那两套（`启动库存系统.bat`、company-site 的隧道脚本）都不用天天开：

- 想让服务器成为**唯一**数据源：Windows 那份留作历史备份，别再往两边录数据（各有一份内嵌库，会分叉）；
- 想继续用 Windows 做备份：保留库存页面的「云端同步」按钮，定期推一次到 Neon。

## 十二、一键发布（改完代码双击一次）

| 按钮 | 作用 | 耗时 |
| --- | --- | --- |
| `发布到服务器.bat` | 库存台账：类型检查 → 提交并推送 GitHub → 服务器 `git reset` 到最新 → 装依赖 → 构建 → 重启 → 自检 | 3~8 分钟 |
| `发布独立站.bat` | 独立站：打包代码（**不含** `data/`、`uploads/`）→ 上传覆盖 → 重启 | 10~30 秒 |

> 只改**内容**（产品、图片、文案）不需要发布：独立站登录 `/admin/` 改、库存直接在页面里改。

### 首次使用前：配一次 SSH 免密（只需一次）

```powershell
# 1) 本机生成密钥（一路回车，密码短语留空）
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519"

# 2A) 推荐：打印公钥，用 Workbench 粘到服务器
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
#    在服务器上执行（把整串公钥替换进去）：
#    mkdir -p ~/.ssh && echo 'ssh-ed25519 AAAA...你的公钥' >> ~/.ssh/authorized_keys
#    chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys

# 2B) 或者：控制台「重置密码」给 root 设密码后，一条命令推上去（会提示输一次密码）
type "$env:USERPROFILE\.ssh\id_ed25519.pub" | ssh root@8.163.86.170 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"

# 3) 验证：不提示密码、直接打印主机名就配好了
ssh -o BatchMode=yes root@8.163.86.170 hostname
```

### 几个说明
- 服务器上的 `deploy/update.sh` 用 `git reset --hard origin/main` 对齐代码——服务器上被 `npm` 改过的 `package-lock.json` 之类不会挡住发布。
- 发布脚本以 **GitHub 为源**：服务器要能 `git pull`（首次 clone 成功过即可）。如果哪次拉不动 GitHub，改用打包上传：本地 `tar` → `scp` → 服务器解开 → `SELF_HOST=1 npm run build` → `systemctl restart inventory`。
- 发布完成后浏览器按 **Ctrl+F5** 强制刷新（服务端渲染的页面不会自动更新）。

## 十三、证书：用 DNS 校验（国内推荐）

`certbot --nginx`（HTTP-01）在国内经常失败：nginx 日志里能看到校验请求**已经 200 正常返回**，但 Let's Encrypt 的多点校验里有节点在到达服务器前被重置（`Connection reset by peer`）；改 DNS-01 又偶发 `SERVFAIL`（二次校验查国内 DNS）。

**可靠做法：用阿里云 DNS 接口签证书**（不依赖 80 端口，续期也自动）：

```bash
# 1) 建一个只给 DNS 权限的 RAM 用户，拿 AccessKey
#    阿里云 → RAM 访问控制 → 用户 → 创建用户（只勾「使用永久 AccessKey 访问」）
#    授权 AliyunDNSFullAccess（千万别给 AdministratorAccess）
# 2) 在服务器上跑
sudo Ali_Key='AccessKeyID' Ali_Secret='AccessKeySecret' bash /root/issue-cert.sh
```

脚本会：装 acme.sh（含 dns_ali 插件）→ 自动加 TXT 记录 → 签发（先 Let's Encrypt，失败自动换 ZeroSSL）→ 证书装到 `/etc/letsencrypt/live/huiranpk.com/` → 配好 90 天自动续期 cron。

签完装正式 Nginx 配置（Ubuntu 22.04 自带 **nginx 1.18 不支持 `http2 on;`**，必须是 `listen 443 ssl http2;`）：

```bash
sudo cp /opt/inventory/app/deploy/nginx-huiranpk.conf /etc/nginx/conf.d/huiranpk.conf
sudo nginx -t && sudo systemctl reload nginx
```

上线后应有的结果（实测通过）：

| 地址 | 行为 |
| --- | --- |
| `http://huiranpk.com`、`http://www.huiranpk.com` | 301 → `https://www.huiranpk.com` |
| `https://www.huiranpk.com` | 200，独立站 |
| `https://huiranpk.com` | 301 → www |
| `https://kc.huiranpk.com` | 401 → 输入账号密码后 200（库存台账） |
| `https://<公网IP>` | 444，直接断开 |

改库存访问密码：
```bash
sudo htpasswd /etc/nginx/htpasswd-inventory huiran   # 按提示输入新密码
sudo systemctl reload nginx
```


