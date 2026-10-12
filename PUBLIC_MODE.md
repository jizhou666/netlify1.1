# 芳村仓库存：公开共享模式

本版本不使用登录或角色权限。只要能打开部署链接，就可以读取和修改同一份库存台账。

## 数据

两种跑法，`.env.local` 里换一个变量名就能切：

| 变量 | 含义 |
| --- | --- |
| （都不写） | 台账跑本机内嵌库 `data/pglite`，断网也能用，数据只在这台电脑 |
| `SYNC_DATABASE_URL` | 本机库照常用，另外把 Neon 当作上传目标：页面上「云端同步」按钮可一键把整套台账推上去 |
| `DATABASE_URL` | 应用直接读写云端 Neon 库（各处实时一致，依赖网络） |

- 「云端同步」是**整份覆盖**：清空云端的分类/货号/型号/出入库流水，再按原 id 写入本机台账，并记录同步时间。
  迁移用 `_migrations` 记账，同一个库只建表一次，重复同步安全。
- 部署到 Netlify / Vercel 时不用 `.env.local`：平台注入 `DATABASE_URL`，应用直接以云端库为准。
- 连接串（含密码）只放在 `.env.local`（已被 `.gitignore` 忽略）或平台环境变量里，不要提交。
- 配置样例见 `.env.local.example`；命令行搬运兜底脚本：`node --experimental-strip-types tasks/copy-pglite-to-target.mjs`。

## 常驻运行（同事随时能打开）

内网穿透只是转发，**真正要一直活着的是 8080 上的应用**；应用一没，同事就会看到
`Tunnel unavailable … must be running on port 8080`。为此有「常驻看守」`scripts/serve-inventory.mjs`：

- 每 30 秒看一眼：是我们自己的应用就什么都不做；没人应答就重新拉起来；应用崩了 5 秒后自动重启
- 端口被别的程序占用时只记日志、不抢不杀，避免误伤
- 日志：`data/watchdog.log`；自检：`node scripts/serve-inventory.mjs --check`（输出 OURS / OTHER / DOWN）
- 启动：双击 **`启动库存系统.bat`**（会自动带上看守 + 隧道；端口上已有我们的应用就只开隧道）
  - 情况不对时用 `启动库存系统.bat restart`：清掉 8080 上的残留进程再重启
  - 改了代码要重建：`启动库存系统.bat rebuild`
- 停止：双击 **`停止库存看守.bat`**（应用和看守一起停，同事的链接会打不开）
- 登录自启：`scripts/start-watchdog.vbs`（隐藏窗口）。本机已放一份到
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`，不想要就删掉那个文件
- 换机器时：把 `.env.local` 和「启动」文件夹里的自启文件一起拷过去

## Netlify

1. 用 Git 导入本项目，或把构建产物按 Netlify 站点发布
2. 构建命令：`npm run build`，发布目录：`dist`（见 `netlify.toml`）
3. 在站点环境变量中设置 `DATABASE_URL`（Neon 连接字符串）
4. Node 版本使用 22

Netlify 构建时会自动带上 `NETLIFY=true`，应用会输出 Netlify Functions，而不是 Vercel 产物。

## 应用平台发布

从预览里一键发布仍走平台默认的 Vercel 通道，同样需要 `DATABASE_URL`（平台会注入）。不要打开访问保护，否则公开链接无法读写库存。
