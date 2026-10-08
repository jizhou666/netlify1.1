/**
 * 导入草稿 → 数据库的原子写入（清空重建）。
 * 不依赖 Vite/服务器函数运行时，方便独立测试与复用。
 */
import type { Sql } from "@/lib/db";
import type { ImportDraft } from "@/lib/ledger-import";

export type ImportWriteResult = {
  categories: number;
  products: number;
  variants: number;
  movements: number;
};

export async function writeDraftToDb(
  sql: Sql,
  draft: ImportDraft,
): Promise<ImportWriteResult> {
  return sql.tx(async (run) => {
    // 1) 清空旧数据（反向依赖顺序删除；_migrations 不动）
    await run("delete from stock_movements");
    await run("delete from variants");
    await run("delete from products");
    await run("delete from categories");
    await run("delete from app_settings");

    // 2) 仓名与类别
    await run("insert into app_settings (key, value) values ('warehouse_name', $1)", [
      draft.warehouseName || "芳村仓",
    ]);
    const catId = new Map<string, number>();
    for (const [i, name] of draft.categories.entries()) {
      const rows = await run<{ id: number }>(
        "insert into categories (name, sort_order) values ($1, $2) returning id",
        [name, i + 1],
      );
      if (rows[0]) catId.set(name, rows[0].id);
    }

    // 3) 货号 + 颜色×仓库（同 类别+货号 复用同一 product 行）
    const productKey = (cat: string, sku: string) => `${cat}\u0000${sku}`;
    const productId = new Map<string, number>();
    const variantSeen = new Map<string, number>();
    let variantSeq = 0;

    const ensureProduct = async (cat: string, sku: string, qty: number, unit: string) => {
      const key = productKey(cat, sku);
      const existing = productId.get(key);
      if (existing != null) return existing;
      const cid = catId.get(cat);
      if (cid == null) throw new Error(`类别 ${cat} 创建失败`);
      const rows = await run<{ id: number }>(
        `insert into products (category_id, sku, packing_qty, packing_unit, sort_order)
         values ($1, $2, $3, $4, $5) returning id`,
        [cid, sku, qty, unit, productId.size + 1],
      );
      const id = rows[0]?.id;
      if (id == null) throw new Error(`货号 ${sku} 创建失败`);
      productId.set(key, id);
      return id;
    };

    let variantRows = 0;
    let movementRows = 0;
    for (const v of draft.variants) {
      const pid = await ensureProduct(v.category, v.sku, v.packingQty, v.packingUnit);
      const vkey = `${v.category}\u0000${v.sku}\u0000${v.warehouse}\u0000${v.color}`;
      const known = variantSeen.get(vkey);
      if (known == null) {
        const rows = await run<{ id: number }>(
          `insert into variants (product_id, color, warehouse, remaining_cartons, remaining_sets, sort_order)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [pid, v.color, v.warehouse, v.cartons, v.sets, ++variantSeq],
        );
        const created = rows[0]?.id;
        if (created == null) throw new Error(`颜色 ${v.color} 创建失败`);
        variantSeen.set(vkey, created);
        variantRows += 1;
      } else {
        await run(
          `update variants set remaining_cartons = remaining_cartons + $2,
           remaining_sets = remaining_sets + $3 where id = $1`,
          [known, v.cartons, v.sets],
        );
      }
      for (const mv of v.movements) {
        const vid = variantSeen.get(vkey);
        if (vid == null) continue;
        await run(
          `insert into stock_movements (variant_id, movement_date, kind, cartons, sets, note)
           values ($1, $2, $3, $4, $5, $6)`,
          [vid, mv.date, mv.kind, mv.cartons, mv.sets, mv.note],
        );
        movementRows += 1;
      }
    }
    return {
      categories: catId.size,
      products: productId.size,
      variants: variantRows,
      movements: movementRows,
    };
  });
}
