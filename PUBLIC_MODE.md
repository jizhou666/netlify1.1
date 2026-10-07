# 芳村仓库存：公开共享模式

本版本不使用登录或角色权限。只要能打开部署链接，就可以读取和修改同一份库存台账。

## 数据

- 库存通过服务端写入 Postgres（Neon）
- 预览环境没有数据库连接时，会使用内嵌库，刷新进程后数据会重置
- 正式发布必须配置 `DATABASE_URL`

## Netlify

1. 用 Git 导入本项目，或把构建产物按 Netlify 站点发布
2. 构建命令：`npm run build`，发布目录：`dist`（见 `netlify.toml`）
3. 在站点环境变量中设置 `DATABASE_URL`（Neon 连接字符串）
4. Node 版本使用 22

Netlify 构建时会自动带上 `NETLIFY=true`，应用会输出 Netlify Functions，而不是 Vercel 产物。

## 应用平台发布

从预览里一键发布仍走平台默认的 Vercel 通道，同样需要 `DATABASE_URL`（平台会注入）。不要打开访问保护，否则公开链接无法读写库存。
