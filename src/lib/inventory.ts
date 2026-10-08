export type MovementKind = "in" | "out" | "adjust";

export type InventoryVariant = {
  id: number;
  productId: number;
  color: string;
  warehouse: string;
  /** 该颜色行独立的装箱数（同货号不同型号可不同，如高70/矮105） */
  packingQty: number;
  packingUnit: string;
  remainingCartons: number;
  remainingSets: number;
  inCartons: number;
  inSets: number;
  outCartons: number;
  outSets: number;
  sortOrder: number;
};

export type InventoryProduct = {
  id: number;
  categoryId: number;
  sku: string;
  packingQty: number;
  packingUnit: string;
  sortOrder: number;
  variants: InventoryVariant[];
};

export type InventoryCategory = {
  id: number;
  name: string;
  sortOrder: number;
  products: InventoryProduct[];
};

export type InventoryPayload = {
  warehouseName: string;
  /** 当前视图仓库（芳村 / 龙归 / …） */
  warehouse: string;
  /** 台账中出现过的全部仓库，供切换按钮渲染 */
  warehouses: string[];
  date: string;
  categories: InventoryCategory[];
  stats: {
    productCount: number;
    variantCount: number;
    outOfStock: number;
    todayInLines: number;
    todayOutLines: number;
  };
};

/** 仓库显示名：龙归 → 龙归仓；已带"仓"则原样。 */
export function warehouseLabel(name: string): string {
  return name.endsWith("仓") ? name : `${name}仓`;
}

export type CategoryOption = {
  id: number;
  name: string;
};

export type StockMovement = {
  id: number;
  variantId: number;
  sku: string;
  color: string;
  movementDate: string;
  kind: MovementKind;
  cartons: number;
  sets: number;
  note: string | null;
  createdAt: string;
};

export function formatQty(cartons: number, sets: number): string {
  if (cartons === 0 && sets === 0) return "0";
  const parts: string[] = [];
  if (cartons !== 0) parts.push(`${cartons}件`);
  if (sets !== 0) parts.push(`${sets}套`);
  return parts.join("+");
}

export function formatPacking(qty: number, unit: string): string {
  return `${qty}${unit}/件`;
}

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatLedgerDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(y)}. ${Number(m)}. ${Number(d)}`;
}

export type ColorSwatch = {
  token: string;
  label: string;
};

const SWATCH_RULES: { match: RegExp; token: string }[] = [
  { match: /黄/, token: "swatch-yellow" },
  { match: /红|朱红|玫红/, token: "swatch-red" },
  { match: /橙/, token: "swatch-orange" },
  { match: /绿|青/, token: "swatch-green" },
  { match: /蓝|靛/, token: "swatch-blue" },
  { match: /粉|桃/, token: "swatch-pink" },
  { match: /紫|lilac/i, token: "swatch-violet" },
  { match: /白|米|象牙/, token: "swatch-white" },
  { match: /黑|墨/, token: "swatch-black" },
  { match: /棕|咖|褐/, token: "swatch-brown" },
  { match: /灰|银/, token: "swatch-gray" },
  { match: /金/, token: "swatch-gold" },
];

export function colorSwatchToken(color: string): string {
  const hit = SWATCH_RULES.find((rule) => rule.match.test(color));
  return hit?.token ?? "swatch-unknown";
}

export function isOutOfStock(cartons: number, sets: number): boolean {
  return cartons === 0 && sets === 0;
}

export const KIND_LABEL: Record<MovementKind, string> = {
  in: "入库",
  out: "出库",
  adjust: "修正",
};

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function ledgerToCsv(payload: InventoryPayload): string {
  const header = ["分类", "货号", "装箱数量", "颜色及型号", "本日入", "本日出", "剩余数量"];
  const lines = [header.map(csvCell).join(",")];
  for (const category of payload.categories) {
    for (const product of category.products) {
      for (const variant of product.variants) {
        // 装箱数量按型号行导出（同一货号的高/矮可以不同）。
        const packing = formatPacking(variant.packingQty, variant.packingUnit);
        const inbound =
          variant.inCartons === 0 && variant.inSets === 0
            ? ""
            : formatQty(variant.inCartons, variant.inSets);
        const outbound =
          variant.outCartons === 0 && variant.outSets === 0
            ? ""
            : formatQty(variant.outCartons, variant.outSets);
        lines.push(
          [
            category.name,
            product.sku,
            packing,
            variant.color,
            inbound,
            outbound,
            formatQty(variant.remainingCartons, variant.remainingSets),
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }
  return lines.join("\r\n");
}

