#!/usr/bin/env node
/**
 * 库存应用「常驻看守」——保证 8080 上一直有应用在跑。
 *
 * 为什么需要它：应用是被某个窗口/进程启动的，窗口一关、机器一重启、或者启动它的进程
 * 一退出，同事那边的隧道就变成 "Tunnel unavailable"。交给它盯着，就等于有个不下班的看守。
 *
 * 行为：
 *   端口上已经是我们自己的应用 → 什么都不做，30 秒后再看
 *   端口被别的程序占用         → 记日志，30 秒后再看（不抢、不杀）
 *   没人应答                   → 启动 .output/server/index.mjs；它退出后 5 秒自动重启
 *   出现 data/watchdog.stop    → 删掉标记、停掉应用、看守退出（给「停止库存看守.bat」用）
 *
 * 环境：从项目根目录 .env.local 读 DATABASE_URL / SYNC_DATABASE_URL（已存在的环境变量优先）。
 * 日志：data/watchdog.log（超过 1MB 自动截断重写）。
 * 自检：node scripts/serve-inventory.mjs --check   → 打印当前端口状态就退出
 *
 * 开机/登录自启：见 scripts/start-watchdog.vbs（可复制到「启动」文件夹）。
 */
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeApp } from "./check-app-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const port = Number(process.env.PORT ?? process.env.APP_PORT ?? 8080);
const logFile = join(root, "data", "watchdog.log");
const stopFile = join(root, "data", "watchdog.stop");
const IDLE_MS = 30_000;
const RESTART_DELAY_MS = 5_000;

function log(line) {
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
  const text = `[${stamp}] ${line}\n`;
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    if (existsSync(logFile) && statSync(logFile).size > 1_000_000) writeFileSync(logFile, "");
    appendFileSync(logFile, text);
  } catch {
    /* 日志写不进去也不影响看守 */
  }
  process.stdout.write(text);
}

/** 读 .env.local（只补缺失的变量，不覆盖已有的）。 */
function loadEnvFile() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (m?.[1] && m[2] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.argv.includes("--check")) {
  console.log(await probeApp(port));
  process.exit(0);
}

loadEnvFile();
log(
  `看守启动 pid=${process.pid} 端口=${port} 数据源=${
    process.env.DATABASE_URL ? "云端库 Neon" : "本机内嵌库"
  } 云端同步=${process.env.SYNC_DATABASE_URL ? "已配置" : "未配置"}`,
);

let child = null;

for (;;) {
  if (existsSync(stopFile)) {
    rmSync(stopFile, { force: true });
    if (child && child.exitCode === null) child.kill();
    log("收到停止指令：应用已停、看守退出。");
    process.exit(0);
  }

  const state = await probeApp(port);
  if (state === "OURS") {
    await sleep(IDLE_MS);
    continue;
  }
  if (state === "OTHER") {
    log("8080 被别的程序占用，等待它让开…");
    await sleep(IDLE_MS);
    continue;
  }

  log("8080 没有应答，启动库存应用…");
  child = spawn(process.execPath, [join(root, ".output", "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "0.0.0.0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => log(`[app] ${String(chunk).trim()}`));
  child.stderr.on("data", (chunk) => log(`[app:err] ${String(chunk).trim()}`));

  const reason = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve(signal ? `信号 ${signal}` : `退出码 ${code}`));
  });
  log(`应用退出了（${reason}），${RESTART_DELAY_MS / 1000} 秒后重试`);
  await sleep(RESTART_DELAY_MS);
}
