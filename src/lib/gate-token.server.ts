import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** 只在服务端使用：签/验登录票据、比对密码。 */
export const GATE_COOKIE = "kc_gate";
export const GATE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 天

function password(): string {
  const fromEnv = process.env.KC_PASSWORD?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "huiran2026";
}

function secret(): string {
  const fromEnv = process.env.KC_GATE_SECRET?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : `kc-gate:${password()}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function checkPassword(input: string): boolean {
  return safeEqual(input, password());
}

export function makeToken(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + GATE_TTL_SECONDS;
  return `${exp}.${sign(String(exp))}`;
}

export function verifyToken(token: string | null | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expRaw, sig] = token.split(".");
  if (!expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  return safeEqual(sig, sign(expRaw));
}
