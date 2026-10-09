/**
 * 云端同步核心：把一份台账（分类 / 货号 / 型号 / 出入库流水 / 设置）原样复制到另一份库。
 *
 * 只依赖两个最小接口，所以浏览器外的脚本（tasks/copy-pglite-to-target.mjs）和
 * 服务器函数（src/lib/cloud-sync-fns.ts）共用同一套逻辑，不会出现两处实现不一致。
 *   source: { query(text, params) -> rows }
 *   target: { query(...), exec(sql) }   // exec 用于跑迁移这类多语句 DDL
 */
import { pendingMigrations } from "../../scripts/migration-plan.mjs";

export type SyncRunner = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type SyncTarget = SyncRunner & { exec(sql: string): Promise<void> };

export type TableSpec = {
  name: string;
  cols: string[];
  order: string;
  /** 复制时排除的行（例如「上次同步时间」这种本机状态） */
  where?: string;
};

/** 需要搬运的表；顺序即依赖顺序（先主表后子表）。 */
export const SYNC_TABLES: TableSpec[] = [
  { name: "categories", cols: ["id", "name", "sort_order"], order: "id" },
  {
    name: "products",
    cols: ["id", "category_id", "sku", "packing_qty", "packing_unit", "sort_order"],
    order: "id",
  },
  {
    name: "variants",
    cols: [
      "id",
      "product_id",
      "color",
      "warehouse",
      "packing_qty",
      "packing_unit",
      "remaining_cartons",
      "remaining_sets",
      "sort_order",
    ],
    order: "id",
  },
  {
    name: "stock_movements",
    cols: ["id", "variant_id", "movement_date", "kind", "cartons", "sets", "note"],
    order: "id",
  },
  {
    name: "app_settings",
    cols: ["key", "value"],
    order: "key",
    where: "key <> 'cloud_last_sync'",
  },
];

/** 显式写入 id 之后必须把自增序列拨到最大值，否则新建记录会撞主键。 */
export const SYNC_SEQUENCES = ["categories", "products", "variants", "stock_movements"];

export function findMigrationSql(sqlByFile: Record<string, string>, file: string): string | null {
  for (const [path, sql] of Object.entries(sqlByFile)) {
    if (path.endsWith(`/${file}`) || path.endsWith(`\\${file}`) || path === file) return sql;
  }
  return null;
}

/**
 * 在目标库建表 / 补迁移。
 *
 * 用与应用相同的 `_migrations` 记账（键是文件名），所以：
 * - 一个库只会执行一次迁移，重复同步不会重跑；
 * - 0002 里那条 `create unique index variants_product_color_idx`（旧的「同货号同颜色唯一」，
 *   会被 0003 换成带仓库的三列唯一索引）不会再对着已有数据执行 —— 那正是同步第二次
 *   报 `could not create unique index` 的原因。
 */
export async function migrateTarget(target: SyncTarget, sqlByFile: Record<string, string>) {
  await target.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const appliedRows = await target.query<{ name: string }>("select name from _migrations");
  const pending = pendingMigrations(
    Object.keys(sqlByFile),
    appliedRows.map((row) => row.name),
  );
  const applied: string[] = [];
  for (const { name, path } of pending) {
    const sql = findMigrationSql(sqlByFile, name) ?? sqlByFile[path];
    if (!sql) throw new Error(`找不到迁移文件 ${name}，无法在云端建表`);
    await target.exec(sql);
    await target.query("insert into _migrations (name) values ($1)", [name]);
    applied.push(name);
  }
  return applied;
}

/** 业务表可能还不存在，清空失败就忽略。 */
async function clearQuietly(target: SyncTarget) {
  try {
    await clearTarget(target);
  } catch {
    /* 表还没建，交给迁移去建 */
  }
}

/**
 * 同步前的准备：清空 → 补迁移 → 再清空。
 * 先清一次，是为了让 0002 里的旧唯一索引能在空表上创建成功；
 * 迁移完再清一次，是为了把 0002 自带的种子数据（4 个示例货号）去掉，避免和真实 id 撞车。
 */
export async function prepareTarget(
  target: SyncTarget,
  sqlByFile: Record<string, string>,
  log: (line: string) => void = () => {},
) {
  await clearQuietly(target);
  const applied = await migrateTarget(target, sqlByFile);
  if (applied.length) log(`云端已补迁移：${applied.join("、")}`);
  await clearTarget(target);
  return applied;
}

/** 清空业务表（反依赖顺序），_migrations 不动。 */
export async function clearTarget(target: SyncTarget) {
  await target.exec(
    `delete from stock_movements;
     delete from variants;
     delete from products;
     delete from categories;
     delete from app_settings;`,
  );
}

export async function resetSequences(target: SyncRunner) {
  for (const table of SYNC_SEQUENCES) {
    await target.query(
      `select setval('${table}_id_seq', coalesce((select max(id) from ${table}), 1))`,
    );
  }
}

export type TableCounts = {
  categories: number;
  products: number;
  variants: number;
  stock_movements: number;
};

export async function countTables(runner: SyncRunner): Promise<TableCounts> {
  const counts: TableCounts = {
    categories: 0,
    products: 0,
    variants: 0,
    stock_movements: 0,
  };
  for (const table of SYNC_SEQUENCES) {
    const rows = await runner.query<{ c: number }>(
      `select count(*)::int as c from ${table}`,
    );
    counts[table as keyof TableCounts] = Number(rows[0]?.c ?? 0);
  }
  return counts;
}

function placeholders(rowCount: number, width: number) {
  const groups: string[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const cols: string[] = [];
    for (let j = 0; j < width; j += 1) cols.push(`$${i * width + j + 1}`);
    groups.push(`(${cols.join(", ")})`);
  }
  return groups.join(", ");
}

async function insertRows(target: SyncRunner, table: TableSpec, rows: Record<string, unknown>[]) {
  const width = table.cols.length;
  const BATCH = 200;
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    const params: unknown[] = [];
    for (const row of slice) for (const col of table.cols) params.push(row[col] ?? null);
    await target.query(
      `insert into ${table.name} (${table.cols.join(", ")})
       values ${placeholders(slice.length, width)}`,
      params,
    );
  }
}

/** 搬运主流程。dryRun 只统计不写入。 */
export async function copyInventory(
  source: SyncRunner,
  target: SyncRunner,
  opts: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<Record<string, number>> {
  const { dryRun = false, log = () => {} } = opts;
  const counts: Record<string, number> = {};
  for (const table of SYNC_TABLES) {
    const where = table.where ? ` where ${table.where}` : "";
    const rows = await source.query<Record<string, unknown>>(
      `select ${table.cols.join(", ")} from ${table.name}${where} order by ${table.order}`,
    );
    counts[table.name] = rows.length;
    if (dryRun) continue;
    await insertRows(target, table, rows);
    log(`${table.name}: ${rows.length} 行`);
  }
  if (!dryRun) await resetSequences(target);
  return counts;
}
