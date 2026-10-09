import { createServerFn } from "@tanstack/react-start";
import { dbSource, getSql } from "@/lib/db";
import {
  copyInventory,
  countTables,
  prepareTarget,
  type SyncTarget,
  type SyncRunner,
  type TableCounts,
} from "./cloud-sync-core";

/**
 * 云端同步（服务器端）。
 *
 * 语义：
 * - 本机用内嵌库跑（默认），`SYNC_DATABASE_URL` 指向 Neon 时，页面上可以「一键上传」：
 *   把本机整套台账清空重建到云端。
 * - 如果 `DATABASE_URL` 本身已经指向云端库（dbSource === "neon"），应用直接读写云端，
 *   这套同步就没有意义了，状态接口会说明「当前已在用云端库」。
 */

const migrations = import.meta.glob("/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const CLOUD_LAST_SYNC_KEY = "cloud_last_sync";

export type CloudSyncStatus = {
  /** "local-first"：本机库 + 可选云端同步；"cloud-first"：应用本身就在用云端库 */
  mode: "local-first" | "cloud-first";
  configured: boolean;
  /** 云端地址（只显示主机名，不带密码） */
  host: string | null;
  lastSyncAt: string | null;
  local: TableCounts | null;
  cloud: TableCounts | null;
  cloudError: string | null;
};

function syncUrl(): string | null {
  const raw = process.env.SYNC_DATABASE_URL;
  const value = raw?.trim();
  return value ? value : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(连接串无法解析)";
  }
}

/** 每次同步开一个独立的短连接池，用完即关，不占应用自身的连接。 */
async function withTarget<T>(url: string, fn: (target: SyncTarget) => Promise<T>): Promise<T> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
  });
  pool.on("error", (err) => console.error("[cloud-sync] pool error:", err));
  try {
    const target: SyncTarget = {
      query: async <R = Record<string, unknown>>(text: string, params: unknown[] = []) =>
        (await pool.query(text, params)).rows as R[],
      exec: async (sql: string) => {
        // node-postgres 的 query 支持一次执行多条语句（迁移文件就是多条）。
        await pool.query(sql);
      },
    };
    return await fn(target);
  } finally {
    await pool.end().catch(() => {});
  }
}

export const cloudSyncStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<CloudSyncStatus> => {
    const sql = await getSql();
    const source: SyncRunner = {
      query: <R = Record<string, unknown>>(text: string, params: unknown[] = []) =>
        sql.query<R>(text, params),
    };

    let local: TableCounts | null = null;
    try {
      local = await countTables(source);
    } catch {
      local = null;
    }

    const settingRows = await sql<{ value: string }>`
      select value from app_settings where key = ${CLOUD_LAST_SYNC_KEY}
    `;
    const lastSyncAt = settingRows[0]?.value ?? null;

    const url = syncUrl();
    if (dbSource === "neon") {
      return {
        mode: "cloud-first",
        configured: true,
        host: url ? hostOf(url) : "(应用自身的 DATABASE_URL)",
        lastSyncAt,
        local,
        cloud: local,
        cloudError: null,
      };
    }
    if (!url) {
      return {
        mode: "local-first",
        configured: false,
        host: null,
        lastSyncAt,
        local,
        cloud: null,
        cloudError: null,
      };
    }

    try {
      const cloud = await withTarget(url, async (target) => {
        const exists = await target.query<{ t: string | null }>(
          "select to_regclass('public.products') as t",
        );
        if (!exists[0]?.t) return null; // 还没建表
        return await countTables(target);
      });
      return {
        mode: "local-first",
        configured: true,
        host: hostOf(url),
        lastSyncAt,
        local,
        cloud,
        cloudError: null,
      };
    } catch (err) {
      return {
        mode: "local-first",
        configured: true,
        host: hostOf(url),
        lastSyncAt,
        local,
        cloud: null,
        cloudError: err instanceof Error ? err.message : String(err),
      };
    }
  },
);

export type CloudSyncResult = {
  at: string;
  pushed: Record<string, number>;
  cloud: TableCounts;
  durationMs: number;
};

/**
 * 一键上传：清空云端业务表 → 把本机台账按原 id 写入 → 拨正自增序列 → 记录同步时间。
 * confirm 必须是 true（前端在确认弹窗里才发），避免误触清空云端。
 */
export const pushToCloud = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = input as { confirm?: boolean };
    if (data?.confirm !== true) throw new Error("请先在弹窗里确认后再同步");
    return { confirm: true as const };
  })
  .handler(async (): Promise<CloudSyncResult> => {
    const url = syncUrl();
    if (!url) {
      throw new Error(
        "还没有配置云端同步地址：请在项目目录的 .env.local 里加一行 SYNC_DATABASE_URL=你的 Neon 连接串，然后重启应用。",
      );
    }
    if (dbSource === "neon") {
      throw new Error("当前应用已经在直接使用云端库（DATABASE_URL），无需再同步。");
    }
    const started = Date.now();
    const sql = await getSql();
    const source: SyncRunner = {
      query: <R = Record<string, unknown>>(text: string, params: unknown[] = []) =>
        sql.query<R>(text, params),
    };

    const result = await withTarget(url, async (target) => {
      await prepareTarget(target, migrations, (line) => console.log(`[cloud-sync] ${line}`));
      const pushed = await copyInventory(source, target, {
        log: (line) => console.log(`[cloud-sync] ${line}`),
      });
      const cloud = await countTables(target);
      return { pushed, cloud };
    });

    const at = new Date().toISOString();
    await sql`
      insert into app_settings (key, value) values (${CLOUD_LAST_SYNC_KEY}, ${at})
      on conflict (key) do update set value = excluded.value
    `;

    return { at, pushed: result.pushed, cloud: result.cloud, durationMs: Date.now() - started };
  });
