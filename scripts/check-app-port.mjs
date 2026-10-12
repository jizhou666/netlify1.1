#!/usr/bin/env node
/**
 * 8080 端口状态探测（给「启动库存系统.bat」和常驻看守用）。
 *
 * 只打印一个词，方便 .bat 用 for /f 取：
 *   OURS  8080 上是我们的库存应用（HTTP 200 且页面带应用名）
 *   OTHER 8080 被别的程序占用（有 200 但不是本应用）
 *   DOWN  没人应答（端口空着，或残留进程占着却不应答）
 *
 * 带 --wait N 时最多等 N 秒：等到 OURS 立刻结束（退出码 0），超时打印最终状态并退出 1。
 * 端口可用 APP_PORT 覆盖（默认 8080）。
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

const MARKER = "芳村仓库存";
const TIMEOUT_MS = 3000;
const MAX_BODY = 200_000; // 应用首页约 2MB，只读前面一段找标记就够

/** 返回 "OURS" | "OTHER" | "DOWN"。 */
export function probeApp(port = Number(process.env.APP_PORT ?? 8080)) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/", timeout: TIMEOUT_MS },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (body.length < MAX_BODY) body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) resolve("DOWN");
          else resolve(body.includes(MARKER) ? "OURS" : "OTHER");
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve("DOWN");
    });
    req.on("error", () => resolve("DOWN"));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const waitIndex = args.indexOf("--wait");
  const waitSeconds = waitIndex >= 0 ? Number(args[waitIndex + 1] ?? 0) : 0;
  const port = Number(process.env.APP_PORT ?? 8080);

  const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;
  let state = await probeApp(port);
  while (state !== "OURS" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = await probeApp(port);
  }

  process.stdout.write(`${state}\n`);
  process.exit(state === "OURS" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
