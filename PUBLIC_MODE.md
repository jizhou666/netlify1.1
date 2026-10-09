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

## Netlify

1. 用 Git 导入本项目，或把构建产物按 Netlify 站点发布
2. 构建命令：`npm run build`，发布目录：`dist`（见 `netlify.toml`）
3. 在站点环境变量中设置 `DATABASE_URL`（Neon 连接字符串）
4. Node 版本使用 22

Netlify 构建时会自动带上 `NETLIFY=true`，应用会输出 Netlify Functions，而不是 Vercel 产物。

## 应用平台发布

从预览里一键发布仍走平台默认的 Vercel 通道，同样需要 `DATABASE_URL`（平台会注入）。不要打开访问保护，否则公开链接无法读写库存。
