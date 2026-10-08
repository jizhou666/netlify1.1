import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import type {
  CategoryOption,
  InventoryCategory,
  InventoryPayload,
  InventoryProduct,
  MovementKind,
  StockMovement,
} from "./inventory";

type CategoryRow = {
  id: number;
  name: string;
  sort_order: number;
};

type ProductRow = {
  id: number;
  category_id: number;
  sku: string;
  packing_qty: number;
  packing_unit: string;
  sort_order: number;
};

type VariantRow = {
  id: number;
  product_id: number;
  color: string;
  warehouse: string;
  remaining_cartons: number;
  remaining_sets: number;
  sort_order: number;
};

type MovementAggRow = {
  variant_id: number;
  in_cartons: number;
  in_sets: number;
  out_cartons: number;
  out_sets: number;
};

type MovementRow = {
  id: number;
  variant_id: number;
  sku: string;
  color: string;
  movement_date: string;
  kind: MovementKind;
  cartons: number;
  sets: number;
  note: string | null;
  created_at: string;
};

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e.code === "23505" || /unique|duplicate/i.test(e.message ?? "");
}

function asInt(value: number, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function subtractStock(
  cartons: number,
  sets: number,
  outCartons: number,
  outSets: number,
  packingQty: number,
) {
  let nextCartons = cartons - outCartons;
  let nextSets = sets - outSets;
  const pack = packingQty > 0 ? packingQty : 0;
  while (nextSets < 0 && pack > 0 && nextCartons > 0) {
    nextCartons -= 1;
    nextSets += pack;
  }
  if (nextCartons < 0 || nextSets < 0) {
    throw new Error("库存不足，无法出库");
  }
  return { cartons: nextCartons, sets: nextSets };
}

async function loadInventory(
  date: string,
  query: string,
  warehouse: string,
): Promise<InventoryPayload> {
  const sql = await getSql();
  const pattern = `%${query.trim()}%`;

  const [settingRows, categoryRows, productRows, variantRows, movementRows, warehouseRows] =
    await Promise.all([
      sql<{ value: string }>`select value from app_settings where key = ${"warehouse_name"}`,
      sql<CategoryRow>`select id, name, sort_order from categories order by sort_order, id`,
      sql<ProductRow>`
        select id, category_id, sku, packing_qty, packing_unit, sort_order
        from products
        order by sort_order, id
      `,
      sql<VariantRow>`
        select v.id, v.product_id, v.color, v.warehouse, v.remaining_cartons, v.remaining_sets, v.sort_order
        from variants v
        join products p on p.id = v.product_id
        where v.warehouse = ${warehouse}
          and (p.sku ilike ${pattern} or v.color ilike ${pattern})
        order by v.sort_order, v.id
      `,
      sql<MovementAggRow>`
        select
          variant_id,
          coalesce(sum(case when kind = 'in' then cartons else 0 end), 0) as in_cartons,
          coalesce(sum(case when kind = 'in' then sets else 0 end), 0) as in_sets,
          coalesce(sum(case when kind = 'out' then cartons else 0 end), 0) as out_cartons,
          coalesce(sum(case when kind = 'out' then sets else 0 end), 0) as out_sets
        from stock_movements
        where movement_date = ${date}
        group by variant_id
      `,
      sql<{ warehouse: string }>`select distinct warehouse from variants order by warehouse`,
    ]);

  // 仓库列表：芳村排最前（主仓），其余按名称排序；请求的仓库不存在时回落到第一个。
  const allWarehouses = warehouseRows.map((r) => r.warehouse);
  const warehouses = [
    ...allWarehouses.filter((w) => w === "芳村" || w === "芳村仓"),
    ...allWarehouses.filter((w) => w !== "芳村" && w !== "芳村仓").sort(),
  ];
  const current = warehouses.includes(warehouse)
    ? warehouse
    : (warehouses[0] ?? warehouse);

  const movementMap = new Map<number, MovementAggRow>();
  for (const row of movementRows) movementMap.set(row.variant_id, row);

  const variantsByProduct = new Map<number, VariantRow[]>();
  for (const row of variantRows) {
    const list = variantsByProduct.get(row.product_id) ?? [];
    list.push(row);
    variantsByProduct.set(row.product_id, list);
  }

  const hasQuery = query.trim().length > 0;
  const categories: InventoryCategory[] = [];
  let productCount = 0;
  let variantCount = 0;
  let outOfStock = 0;
  let todayInLines = 0;
  let todayOutLines = 0;

  for (const category of categoryRows) {
    const products: InventoryProduct[] = [];
    for (const product of productRows) {
      if (product.category_id !== category.id) continue;
      const vars = variantsByProduct.get(product.id) ?? [];
      // 当前仓库没有颜色的货号不展示（它只存在于其他仓库）。
      if (vars.length === 0) continue;
      productCount += 1;
      products.push({
        id: product.id,
        categoryId: product.category_id,
        sku: product.sku,
        packingQty: product.packing_qty,
        packingUnit: product.packing_unit,
        sortOrder: product.sort_order,
        variants: vars.map((v) => {
          const m = movementMap.get(v.id);
          const inCartons = asInt(m?.in_cartons ?? 0);
          const inSets = asInt(m?.in_sets ?? 0);
          const outCartons = asInt(m?.out_cartons ?? 0);
          const outSets = asInt(m?.out_sets ?? 0);
          variantCount += 1;
          if (v.remaining_cartons === 0 && v.remaining_sets === 0) outOfStock += 1;
          if (inCartons !== 0 || inSets !== 0) todayInLines += 1;
          if (outCartons !== 0 || outSets !== 0) todayOutLines += 1;
          return {
            id: v.id,
            productId: v.product_id,
            color: v.color,
            warehouse: v.warehouse,
            remainingCartons: v.remaining_cartons,
            remainingSets: v.remaining_sets,
            inCartons,
            inSets,
            outCartons,
            outSets,
            sortOrder: v.sort_order,
          };
        }),
      });
    }
    if (products.length === 0) continue;
    categories.push({
      id: category.id,
      name: category.name,
      sortOrder: category.sort_order,
      products,
    });
  }

  return {
    warehouseName: settingRows[0]?.value ?? "芳村仓",
    warehouse: current,
    warehouses: warehouses.length > 0 ? warehouses : [current],
    date,
    categories,
    stats: {
      productCount,
      variantCount,
      outOfStock,
      todayInLines,
      todayOutLines,
    },
  };
}

const dateInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  q: z.string().optional(),
  warehouse: z.string().trim().min(1).max(20).default("芳村"),
});

export const listInventory = createServerFn({ method: "POST" })
  .validator((input: unknown) => dateInput.parse(input))
  .handler(async ({ data }) => loadInventory(data.date, data.q ?? "", data.warehouse));

export const listCategories = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const rows = await sql<CategoryRow>`
    select id, name, sort_order from categories order by sort_order, id
  `;
  return rows.map(
    (row): CategoryOption => ({
      id: row.id,
      name: row.name,
    }),
  );
});

const createCategoryInput = z.object({
  name: z.string().trim().min(1).max(40),
});

export const createCategory = createServerFn({ method: "POST" })
  .validator((input: unknown) => createCategoryInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const maxRows = await sql<{ max: number | null }>`select max(sort_order) as max from categories`;
    const sortOrder = asInt(maxRows[0]?.max ?? 0) + 1;
    try {
      const rows = await sql<CategoryRow>`
        insert into categories (name, sort_order)
        values (${data.name}, ${sortOrder})
        returning id, name, sort_order
      `;
      const row = rows[0];
      if (!row) throw new Error("新建分类失败");
      return { id: row.id, name: row.name };
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error("分类已存在");
      throw err;
    }
  });

const deleteCategoryInput = z.object({ id: z.number().int() });

export const deleteCategory = createServerFn({ method: "POST" })
  .validator((input: unknown) => deleteCategoryInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const used = await sql<{ count: number }>`
      select count(*)::int as count from products where category_id = ${data.id}
    `;
    if (asInt(used[0]?.count ?? 0) > 0) {
      throw new Error("该分类下仍有货品，无法删除");
    }
    await sql`delete from categories where id = ${data.id}`;
    return { ok: true as const };
  });

const createProductInput = z.object({
  categoryId: z.number().int(),
  sku: z.string().trim().min(1).max(80),
  packingQty: z.number().int().positive(),
  packingUnit: z.string().trim().min(1).max(8),
  color: z.string().trim().min(1).max(20),
  remainingCartons: z.number().int().min(0),
  remainingSets: z.number().int().min(0),
  warehouse: z.string().trim().min(1).max(20).default("芳村"),
});

export const createProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => createProductInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const maxRows = await sql<{ max: number | null }>`
      select max(sort_order) as max from products where category_id = ${data.categoryId}
    `;
    const sortOrder = asInt(maxRows[0]?.max ?? 0) + 1;
    const products = await sql<{ id: number }>`
      insert into products (category_id, sku, packing_qty, packing_unit, sort_order)
      values (${data.categoryId}, ${data.sku}, ${data.packingQty}, ${data.packingUnit}, ${sortOrder})
      returning id
    `;
    const productId = products[0]?.id;
    if (!productId) throw new Error("新增货品失败");
    await sql`
      insert into variants (product_id, color, warehouse, remaining_cartons, remaining_sets, sort_order)
      values (${productId}, ${data.color}, ${data.warehouse}, ${data.remainingCartons}, ${data.remainingSets}, 1)
    `;
    return { id: productId };
  });

const updateProductInput = z.object({
  id: z.number().int(),
  categoryId: z.number().int(),
  sku: z.string().trim().min(1).max(80),
  packingQty: z.number().int().positive(),
  packingUnit: z.string().trim().min(1).max(8),
});

export const updateProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => updateProductInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`
      update products
      set category_id = ${data.categoryId},
          sku = ${data.sku},
          packing_qty = ${data.packingQty},
          packing_unit = ${data.packingUnit},
          updated_at = now()
      where id = ${data.id}
    `;
    return { ok: true as const };
  });

const deleteProductInput = z.object({ id: z.number().int() });

export const deleteProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => deleteProductInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from products where id = ${data.id}`;
    return { ok: true as const };
  });

const createVariantInput = z.object({
  productId: z.number().int(),
  color: z.string().trim().min(1).max(20),
  remainingCartons: z.number().int().min(0),
  remainingSets: z.number().int().min(0),
  warehouse: z.string().trim().min(1).max(20).default("芳村"),
});

export const createVariant = createServerFn({ method: "POST" })
  .validator((input: unknown) => createVariantInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const maxRows = await sql<{ max: number | null }>`
      select max(sort_order) as max from variants
      where product_id = ${data.productId} and warehouse = ${data.warehouse}
    `;
    const sortOrder = asInt(maxRows[0]?.max ?? 0) + 1;
    try {
      const rows = await sql<{ id: number }>`
        insert into variants (product_id, color, warehouse, remaining_cartons, remaining_sets, sort_order)
        values (${data.productId}, ${data.color}, ${data.warehouse}, ${data.remainingCartons}, ${data.remainingSets}, ${sortOrder})
        returning id
      `;
      return { id: rows[0]?.id };
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error("该仓库此货号下已有此颜色");
      throw err;
    }
  });

const updateVariantInput = z.object({
  id: z.number().int(),
  color: z.string().trim().min(1).max(20),
});

export const updateVariant = createServerFn({ method: "POST" })
  .validator((input: unknown) => updateVariantInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    try {
      await sql`
        update variants
        set color = ${data.color}, updated_at = now()
        where id = ${data.id}
      `;
      return { ok: true as const };
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error("该货号下已有此颜色");
      throw err;
    }
  });

const deleteVariantInput = z.object({ id: z.number().int() });

export const deleteVariant = createServerFn({ method: "POST" })
  .validator((input: unknown) => deleteVariantInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const product = await sql<{ product_id: number; warehouse: string; count: number }>`
      select v.product_id, v.warehouse, (
        select count(*)::int from variants v2
        where v2.product_id = v.product_id and v2.warehouse = v.warehouse
      ) as count
      from variants v
      where v.id = ${data.id}
    `;
    const row = product[0];
    if (!row) throw new Error("颜色不存在");
    if (asInt(row.count) <= 1) {
      throw new Error("该仓库至少保留一种颜色，如需清空请直接删除货号");
    }
    await sql`delete from variants where id = ${data.id}`;
    return { ok: true as const };
  });

const recordMovementInput = z.object({
  variantId: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["in", "out", "adjust"]),
  cartons: z.number().int().min(0),
  sets: z.number().int().min(0),
  note: z.string().trim().max(120).optional(),
});

export const recordMovement = createServerFn({ method: "POST" })
  .validator((input: unknown) => recordMovementInput.parse(input))
  .handler(async ({ data }) => {
    if (data.kind !== "adjust" && data.cartons === 0 && data.sets === 0) {
      throw new Error("请填写件数或套数");
    }
    const sql = await getSql();
    const rows = await sql<VariantRow & { packing_qty: number }>`
      select v.id, v.product_id, v.color, v.remaining_cartons, v.remaining_sets, v.sort_order,
             p.packing_qty
      from variants v
      join products p on p.id = v.product_id
      where v.id = ${data.variantId}
    `;
    const variant = rows[0];
    if (!variant) throw new Error("货品不存在");

    let nextCartons = variant.remaining_cartons;
    let nextSets = variant.remaining_sets;
    if (data.kind === "in") {
      nextCartons += data.cartons;
      nextSets += data.sets;
    } else if (data.kind === "out") {
      const next = subtractStock(
        variant.remaining_cartons,
        variant.remaining_sets,
        data.cartons,
        data.sets,
        variant.packing_qty,
      );
      nextCartons = next.cartons;
      nextSets = next.sets;
    } else {
      nextCartons = data.cartons;
      nextSets = data.sets;
    }

    await sql`
      update variants
      set remaining_cartons = ${nextCartons},
          remaining_sets = ${nextSets},
          updated_at = now()
      where id = ${data.variantId}
    `;
    await sql`
      insert into stock_movements (variant_id, movement_date, kind, cartons, sets, note)
      values (
        ${data.variantId},
        ${data.date},
        ${data.kind},
        ${data.cartons},
        ${data.sets},
        ${data.note || null}
      )
    `;
    return { remainingCartons: nextCartons, remainingSets: nextSets };
  });

const listMovementsInput = z.object({
  variantId: z.number().int(),
});

export const listMovements = createServerFn({ method: "POST" })
  .validator((input: unknown) => listMovementsInput.parse(input))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<MovementRow>`
      select
        m.id,
        m.variant_id,
        p.sku,
        v.color,
        m.movement_date,
        m.kind,
        m.cartons,
        m.sets,
        m.note,
        m.created_at
      from stock_movements m
      join variants v on v.id = m.variant_id
      join products p on p.id = v.product_id
      where m.variant_id = ${data.variantId}
      order by m.movement_date desc, m.id desc
      limit 100
    `;
    return rows.map(
      (row): StockMovement => ({
        id: row.id,
        variantId: row.variant_id,
        sku: row.sku,
        color: row.color,
        movementDate: row.movement_date,
        kind: row.kind,
        cartons: row.cartons,
        sets: row.sets,
        note: row.note,
        createdAt: row.created_at,
      }),
    );
  });
