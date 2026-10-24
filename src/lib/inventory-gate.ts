import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * 库存台账的登录门：页面里输一次密码，之后 30 天免输（httpOnly cookie）。
 *
 * - 页面级：`src/routes/__root.tsx` 的 beforeLoad 检查 `gateStatus`，未登录跳 /login
 * - 接口级：所有业务 server function 挂 `inventoryGate` 中间件，没有票据直接拒绝
 * - 密码来源：环境变量 `KC_PASSWORD`（服务器 /etc/inventory.env），没配则回落到 huiran2026
 */

const GATE_COOKIE = "kc_gate";
const GATE_TTL_SECONDS = 60 * 60 * 24 * 30;

/** 读当前请求是否已登录（只能跑在请求上下文里） */
async function readAuthorized(): Promise<boolean> {
  const { getCookie } = await import("@tanstack/react-start/server");
  const { verifyToken } = await import("./gate-token.server");
  return verifyToken(getCookie(GATE_COOKIE));
}

export const inventoryGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!(await readAuthorized())) {
    throw new Error("未登录：请先在登录页输入访问密码");
  }
  return next();
});

/** 前端用它决定是否显示登录页 */
export const gateStatus = createServerFn({ method: "GET" }).handler(async () => ({
  authorized: await readAuthorized(),
}));

export const gateLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ password: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { checkPassword, makeToken } = await import("./gate-token.server");
    if (!checkPassword(data.password)) {
      // 轻量延时，挡住暴力尝试
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { ok: false as const };
    }
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie(GATE_COOKIE, makeToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GATE_TTL_SECONDS,
    });
    return { ok: true as const };
  });

export const gateLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { setCookie } = await import("@tanstack/react-start/server");
  setCookie(GATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return { ok: true as const };
});
