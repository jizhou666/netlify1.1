/**
 * 芳村仓库存 Excel 模板解析器（纯函数，浏览器与测试脚本共用）。
 *
 * 模板结构（以 10.5.xlsx「芳村仓」工作表为准）：
 * - 第 1 行：各「本日入/本日出/剩余数量」列组的日期（如 2026.10.5）
 * - 第 2 行：表头 货号 | 装箱数量 | 颜色及型号 | <仓>本日入 | <仓>本日出 | <仓>剩余数量 …
 * - 类别行：第一列以「：」结尾（纸罐&铁罐：、茶叶礼盒：…）
 * - 货号/装箱列常合并单元格跨多行颜色 → 提取时按合并范围回填
 * - 数量写法：`7件+25套`、`20件`、`330个`、`19套`，空为 0，纯数字按「套」
 *
 * 多列组规则：
 * - 主列组 = 剩余列组中表头日期最新的一组（即"当前库存"）
 * - 同仓更早日期的列组 = 历史快照 → 忽略（报告中提示）
 * - 异仓列组（如龙归）→ 生成该仓库的独立行（warehouse=列组名），
 *   前端按仓库切换视图；出入流水按列组日期入库
 */

// ───────────────────────── 类型 ─────────────────────────

export type CellValue = string | number | null;

export type ImportGroupInfo = {
  name: string;
  date: string | null;
  role: "main" | "other" | "ignored";
};

export type ImportMovementDraft = {
  date: string;
  kind: "in" | "out";
  cartons: number;
  sets: number;
  note: string | null;
};

export type ImportVariantDraft = {
  row: number; // Excel 行号，便于对照原表
  category: string;
  sku: string;
  packingQty: number;
  packingUnit: string;
  color: string;
  /** 所属仓库（芳村 / 龙归 / …），前端按仓库切换视图 */
  warehouse: string;
  cartons: number;
  sets: number;
  movements: ImportMovementDraft[];
};

export type ImportWarningDraft = {
  row: number;
  sku: string;
  message: string;
};

export type ImportDraft = {
  warehouseName: string;
  ledgerDate: string;
  categories: string[];
  variants: ImportVariantDraft[];
  warnings: ImportWarningDraft[];
  groups: ImportGroupInfo[];
  stats: {
    categoryCount: number;
    productCount: number;
    variantCount: number;
    movementCount: number;
    warningCount: number;
  };
};

// ───────────────── 数量 / 装箱 文本解析 ─────────────────

const QTY_UNITS = "个套只粒罐盒条包张双对卷片把支本瓶袋枚块";
const QTY_TOKEN_RE = new RegExp(`(\\d+)\\s*(件|[${QTY_UNITS}])`, "g");
// 形如「金872个 橙782个」的多色合计串
const MULTI_COLOR_RE = /[金银红黄橙绿蓝紫粉黑白灰棕米咖墨青靛朱玫桃象牙]\s*\d/;

export type ParsedQty = {
  cartons: number;
  sets: number;
  ok: boolean;
  reason?: string;
  note?: string; // 解析成功但含备注文字/多色合计，需要人工核对
};

export function parseQtyText(raw: CellValue): ParsedQty {
  if (raw == null || raw === "") return { cartons: 0, sets: 0, ok: true };
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0
      ? { cartons: 0, sets: Math.round(raw), ok: true }
      : { cartons: 0, sets: 0, ok: false, reason: "数量不是有效数字" };
  }
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return { cartons: 0, sets: Number(text), ok: true };
  // 去掉括号内的备注段（如「9件+149个（无印无标7件+149个）」「0件 （有黑点）」）
  const stripped = text.replace(/[（(][^）)]*[）)]/g, "");
  const multiColor = MULTI_COLOR_RE.test(stripped);

  let cartons = 0;
  let sets = 0;
  let matched = false;
  for (const m of stripped.matchAll(QTY_TOKEN_RE)) {
    matched = true;
    const n = Number(m[1]);
    if (m[2] === "件") cartons += n;
    else sets += n;
  }
  if (!matched) {
    return { cartons: 0, sets: 0, ok: false, reason: `数量写法无法识别：${text}` };
  }
  // token 之外的残段：纯数字按散数（如「8件+17」= 8件+17套）；
  // 中文备注词（啡色/无盖/已挑选…）忽略；其他符号残段判失败。
  let hasCjkNote = false;
  const rest = stripped
    .replace(QTY_TOKEN_RE, "")
    .split(/[\s+＋、,，;；/／\-–—。.×*＊]+/)
    .filter(Boolean);
  for (const part of rest) {
    if (/^\d+$/.test(part)) sets += Number(part);
    else if (/[一-龥]/.test(part)) hasCjkNote = true;
    else return { cartons: 0, sets: 0, ok: false, reason: `数量写法无法识别：${text}` };
  }
  let note: string | undefined;
  if (multiColor) note = `多色合计已并为一行：${text}`;
  else if (hasCjkNote) note = `含备注文字，已按数值合计：${text}`;
  return { cartons, sets, ok: true, note };
}

const PACK_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*([${QTY_UNITS}])\\s*[/／每]\\s*[件箱]`);
const PACK_NUM_ONLY_RE = /^(\d+(?:\.\d+)?)\s*[/／]\s*[件箱]$/;

export type ParsedPacking = { qty: number; unit: string; ok: boolean; reason?: string };

export function parsePackingText(raw: CellValue): ParsedPacking {
  if (raw == null || String(raw).trim() === "") {
    return { qty: 1, unit: "个", ok: false, reason: "装箱数量缺失，按 1 导入，请导入后修正" };
  }
  const text = String(raw).trim();
  const m = PACK_RE.exec(text);
  if (m) return { qty: Math.max(1, Math.round(Number(m[1]))), unit: m[2] ?? "个", ok: true };
  // 「160/件」——无单位时默认按「个」
  const m2 = PACK_NUM_ONLY_RE.exec(text);
  if (m2?.[1]) return { qty: Math.max(1, Math.round(Number(m2[1]))), unit: "个", ok: true };
  // 纯数字（如「430」）视为 430个/件
  if (/^\d+$/.test(text)) return { qty: Math.max(1, Number(text)), unit: "个", ok: true };
  return { qty: 1, unit: "个", ok: false, reason: `装箱写法无法识别：${text}，按 1 导入，请导入后修正` };
}

function normalizeDateText(v: CellValue, fallback: string): string {
  if (typeof v === "string") {
    const m = v.match(/(\d{4})[.\-/年](\d{1,2})[.\-/月]?(\d{1,2})/);
    if (m?.[1] && m[2] && m[3]) {
      return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
    }
  }
  return fallback;
}

// ───────────────── exceljs 工作表 → 单元格矩阵 ─────────────────

/** 只声明用到的 exceljs 成员，避免浏览器包依赖具体版本类型。 */
export interface ExcelSheetLike {
  name: string;
  model?: { merges?: string[] };
  rowCount?: number;
  actualRowCount?: number;
  getCell(row: number, col: number): {
    value: unknown;
    address?: string;
    isMerged?: boolean;
    master?: { address?: string };
  };
}

function cellText(v: unknown): CellValue {
  if (v == null) return null;
  if (v instanceof Date) {
    // exceljs 对日期单元格给出 UTC 午夜 Date，直接按 UTC 取年月日。
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(
      v.getUTCDate(),
    ).padStart(2, "0")}`;
  }
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "object") {
    const o = v as {
      text?: string;
      result?: unknown;
      richText?: { text: string }[];
      hyperlinks?: unknown;
    };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("").trim() || null;
    if (o.text != null) return String(o.text).trim() || null;
    if (o.result != null) return cellText(o.result);
    return null;
  }
  return null;
}

const MERGE_RE = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/;

function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * 把工作表导出为 1-based 单元格矩阵；合并单元格的左上角值回填到整个范围
 * （货号 / 装箱列跨行合并即靠这一步完成继承）。
 * 同时返回未回填的 raw 矩阵——类别行常整行合并，必须按 raw 判断。
 */
export function sheetToCellMatrix(
  sheet: ExcelSheetLike,
  maxCols: number,
): { cells: CellValue[][]; rawCells: CellValue[][]; rowCount: number } {
  const merges = (sheet.model?.merges ?? []).filter((r): r is string => typeof r === "string");
  // 实际末行 = 工作表行数、合并范围末行中的最大值，再自末尾向上找首个非空行。
  const maxMergeBottom = merges.reduce((acc, m) => {
    const n = Number(MERGE_RE.exec(m)?.[4] ?? 0);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);
  const declaredBottom = Math.max(sheet.actualRowCount ?? 0, sheet.rowCount ?? 0, maxMergeBottom);
  let rowCount = declaredBottom;
  for (let r = declaredBottom; r >= 1; r -= 1) {
    let any = false;
    for (let c = 1; c <= maxCols; c += 1) {
      if (cellText(sheet.getCell(r, c).value) != null) {
        any = true;
        break;
      }
    }
    if (any) {
      rowCount = r;
      break;
    }
    rowCount = r - 1;
  }
  rowCount = Math.max(rowCount, 1);

  const cells: CellValue[][] = Array.from({ length: rowCount + 1 }, () =>
    new Array<CellValue>(maxCols + 1).fill(null),
  );
  for (let r = 1; r <= rowCount; r += 1) {
    for (let c = 1; c <= maxCols; c += 1) {
      cells[r]![c] = cellText(sheet.getCell(r, c).value);
    }
  }
  // raw 矩阵只保留合并锚点值：exceljs 会把合并单元格的值传播到整行
  // （类别行 A3:M3 合并后 B3..M3 都会报出「纸罐&铁罐：」），非锚点格置空。
  const rawCells: CellValue[][] = cells.map((row) => row.slice());
  for (let r = 1; r <= rowCount; r += 1) {
    for (let c = 1; c <= maxCols; c += 1) {
      const cell = sheet.getCell(r, c);
      if (cell.isMerged && cell.address && cell.master?.address && cell.master.address !== cell.address) {
        rawCells[r]![c] = null;
      }
    }
  }
  // 合并回填：范围外圈按 anchor 值填充（同表视觉一致），用于货号/装箱列继承。
  for (const range of merges) {
    const m = MERGE_RE.exec(range);
    if (!m?.[1] || !m[3]) continue;
    const c1 = colToNum(m[1]);
    const c2 = colToNum(m[3]);
    const r1 = Number(m[2]);
    const r2 = Number(m[4]);
    const anchor = cells[r1]?.[c1];
    if (anchor == null) continue;
    for (let r = r1; r <= Math.min(r2, rowCount); r += 1) {
      for (let c = c1; c <= Math.min(c2, maxCols); c += 1) {
        if (cells[r] && cells[r][c] == null) cells[r][c] = anchor;
      }
    }
  }
  return { cells, rawCells, rowCount };
}

// ────────────────────── 草稿构建 ──────────────────────

const HEADER_RE = /剩余数量|剩余$/;
const GROUP_PREFIX_RE = /^(.{1,6}?)(?:本日|剩余)/;

function parseGroups(
  headerRowCells: CellValue[],
  dateRowCells: CellValue[],
  ledgerDate: string,
) {
  const header = headerRowCells;
  const anchors: number[] = [];
  for (let c = 4; c < header.length; c += 1) {
    const v = header[c];
    if (typeof v === "string" && HEADER_RE.test(v)) anchors.push(c);
  }
  if (anchors.length === 0) return null;

  let mainPrefix = "";
  for (const a of anchors) {
    const name = typeof header[a] === "string" ? String(header[a]) : "";
    const g = GROUP_PREFIX_RE.exec(name);
    if (g?.[1]) {
      mainPrefix = g[1];
      break;
    }
  }

  const groups = anchors.map((a) => {
    const headerText = String(header[a] ?? "");
    const gm = GROUP_PREFIX_RE.exec(headerText);
    const name = gm?.[1] ?? mainPrefix ?? "";
    // 日期写在表头的上一行，位置在各组第一个列（剩余列往前两列）。
    const date = dateRowCells[a - 2] ?? dateRowCells[a] ?? null;
    return { anchor: a, name, date: normalizeDateText(date, ledgerDate) };
  });

  // 主组 = 日期最新；其余同仓为历史(ignored)，异仓为 other。
  let mainIdx = 0;
  groups.forEach((g, i) => {
    if (g.date > groups[mainIdx]!.date) mainIdx = i;
  });
  const mainName = groups[mainIdx]!.name;
  const info: ImportGroupInfo[] = groups.map((g, i) => ({
    name: g.name || `列组${i + 1}`,
    date: g.date,
    role:
      i === mainIdx ? "main" : g.name === mainName ? "ignored" : ("other" as ImportGroupInfo["role"]),
  }));
  return { groups, info, mainIdx };
}

/** 解析整个单元格矩阵为导入草稿（cells 为合并回填后，rawCells 为原始值）。 */
export function buildImportDraft(
  cells: CellValue[][],
  rawCells: CellValue[][],
  rowCount: number,
  opts: { ledgerDate: string; warehouseName: string },
): { ok: true; draft: ImportDraft } | { ok: false; error: string } {
  // 表头行：前 5 行内同时出现「货号」与「剩余」的行
  let headerRow = 0;
  for (let r = 1; r <= Math.min(5, rowCount); r += 1) {
    const line = cells[r] ?? [];
    const hasSku = line.some((v) => typeof v === "string" && v.includes("货号"));
    const hasRemain = line.some((v) => typeof v === "string" && HEADER_RE.test(v));
    if (hasSku && hasRemain) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) return { ok: false, error: "没找到「货号 / 剩余数量」表头行，请确认使用库存模板表格。" };

  const parsed = parseGroups(cells[headerRow]!, cells[headerRow - 1] ?? [], opts.ledgerDate);
  if (!parsed) return { ok: false, error: "表头中没找到「剩余数量」列，无法识别库存列组。" };
  const { groups, info, mainIdx } = parsed;

  const warnings: ImportWarningDraft[] = [];
  const categoryOrder: string[] = [];
  const variantMap = new Map<string, ImportVariantDraft>();
  const skuSet = new Set<string>();

  let curCategory = "";
  let lastSku = "";
  let lastPacking: CellValue = null;

  const addWarning = (row: number, sku: string, message: string) =>
    warnings.push({ row, sku, message });

  // 主列组的仓库名（芳村），用于把异仓列组归到各自 warehouse。
  const mainWarehouse = groups[mainIdx]!.name || "芳村";

  for (let r = headerRow + 1; r <= rowCount; r += 1) {
    const line = cells[r]!;
    const raw = rawCells[r]!;
    const a = line[1];
    const b = line[2];
    const c = line[3];

    // 类别行：以冒号结尾且后两列空。判断基于 raw——类别行常整行横向合并，
    // 回填矩阵会把所有列都填成类别名。
    const ra = raw[1];
    const rb = raw[2];
    const rc = raw[3];
    if (typeof ra === "string" && /[：:]\s*$/.test(ra) && rb == null && rc == null) {
      curCategory = ra.replace(/[：:]\s*$/, "").trim();
      if (curCategory && !categoryOrder.includes(curCategory)) categoryOrder.push(curCategory);
      lastSku = "";
      lastPacking = null;
      continue;
    }

    if (typeof a === "string" && /合计|总计/.test(a)) continue;
    // 空行判断同样基于 raw（回填后整行都非空）
    let rawAny = false;
    for (let cc = 1; cc < raw.length; cc += 1) {
      if (raw[cc] != null) {
        rawAny = true;
        break;
      }
    }
    if (!rawAny) continue;
    if (ra == null && rb == null && rc == null && !rawAny) continue;

    let sku: string;
    let packingRaw: CellValue;
    if (a != null && a !== lastSku) {
      sku = String(a);
      lastSku = sku;
      lastPacking = b ?? null;
      packingRaw = b ?? lastPacking;
    } else {
      sku = lastSku;
      packingRaw = b ?? lastPacking;
    }
    if (!sku) {
      addWarning(r, "", "该行没有货号可继承，已跳过");
      continue;
    }

    const category = curCategory || "(未分类)";
    if (!categoryOrder.includes(category)) categoryOrder.push(category);
    const packing = parsePackingText(packingRaw);
    if (!packing.ok) addWarning(r, sku, `装箱数量：${packing.reason}`);
    skuSet.add(`${category}\u0000${sku}`);

    // 主列组：当前库存 + 当日流水
    const main = groups[mainIdx]!;
    {
      const colorBase = c != null ? String(c) : "";
      const displayColor = colorBase || "(未填颜色)";
      if (!colorBase) addWarning(r, sku, "颜色及型号为空，已用「(未填颜色)」占位");

      const remain = parseQtyText(line[main.anchor]);
      if (!remain.ok) addWarning(r, sku, `剩余数量：${remain.reason}`);
      else if (remain.note) addWarning(r, sku, `剩余数量：${remain.note}`);
      const inQ = parseQtyText(line[main.anchor - 2]);
      const outQ = parseQtyText(line[main.anchor - 1]);
      const movements: ImportMovementDraft[] = [];
      if (inQ.ok && (inQ.cartons > 0 || inQ.sets > 0)) {
        movements.push({ date: main.date, kind: "in", cartons: inQ.cartons, sets: inQ.sets, note: "Excel导入" });
      }
      if (!inQ.ok) addWarning(r, sku, `本日入：${inQ.reason}`);
      if (outQ.ok && (outQ.cartons > 0 || outQ.sets > 0)) {
        movements.push({ date: main.date, kind: "out", cartons: outQ.cartons, sets: outQ.sets, note: "Excel导入" });
      }
      if (!outQ.ok) addWarning(r, sku, `本日出：${outQ.reason}`);

      const key = `${category}\u0000${sku}\u0000${mainWarehouse}\u0000${displayColor}`;
      const existing = variantMap.get(key);
      if (existing) {
        existing.cartons += remain.cartons;
        existing.sets += remain.sets;
        existing.movements.push(...movements);
        addWarning(r, sku, `颜色「${displayColor}」重复出现，数量已合并`);
      } else {
        variantMap.set(key, {
          row: r,
          category,
          sku,
          packingQty: packing.qty,
          packingUnit: packing.unit,
          color: displayColor,
          warehouse: mainWarehouse,
          cartons: remain.cartons,
          sets: remain.sets,
          movements,
        });
      }
    }

    // 异仓列组（如龙归）：生成该仓库的独立行
    for (let gi = 0; gi < groups.length; gi += 1) {
      if (gi === mainIdx || info[gi]!.role !== "other") continue;
      const g = groups[gi]!;
      const rowHasData = [g.anchor, g.anchor - 1, g.anchor - 2].some(
        (col) => line[col] != null && line[col] !== 0 && line[col] !== "",
      );
      if (!rowHasData) continue;
      const color = c != null ? String(c) : "(未填颜色)";
      const remain = parseQtyText(line[g.anchor]);
      if (!remain.ok) addWarning(r, sku, `${info[gi]!.name}剩余：${remain.reason}`);
      else if (remain.note) addWarning(r, sku, `${info[gi]!.name}剩余：${remain.note}`);
      const movements: ImportMovementDraft[] = [];
      const inQ = parseQtyText(line[g.anchor - 2]);
      const outQ = parseQtyText(line[g.anchor - 1]);
      if (inQ.ok && (inQ.cartons > 0 || inQ.sets > 0)) {
        movements.push({ date: g.date, kind: "in", cartons: inQ.cartons, sets: inQ.sets, note: `Excel导入-${info[gi]!.name}` });
      }
      if (outQ.ok && (outQ.cartons > 0 || outQ.sets > 0)) {
        movements.push({ date: g.date, kind: "out", cartons: outQ.cartons, sets: outQ.sets, note: `Excel导入-${info[gi]!.name}` });
      }
      const key = `${category}\u0000${sku}\u0000${info[gi]!.name}\u0000${color}`;
      const existing = variantMap.get(key);
      if (existing) {
        existing.cartons += remain.cartons;
        existing.sets += remain.sets;
        existing.movements.push(...movements);
      } else {
        variantMap.set(key, {
          row: r,
          category,
          sku,
          packingQty: packing.qty,
          packingUnit: packing.unit,
          color,
          warehouse: info[gi]!.name,
          cartons: remain.cartons,
          sets: remain.sets,
          movements,
        });
      }
    }
  }

  const variants = [...variantMap.values()];
  if (variants.length === 0) return { ok: false, error: "表格里没有解析到任何货品行。" };

  const movementCount = variants.reduce((n, v) => n + v.movements.length, 0);
  const draft: ImportDraft = {
    warehouseName: opts.warehouseName,
    ledgerDate: opts.ledgerDate,
    categories: categoryOrder,
    variants,
    warnings,
    groups: info,
    stats: {
      categoryCount: categoryOrder.length,
      productCount: skuSet.size,
      variantCount: variants.length,
      movementCount,
      warningCount: warnings.length,
    },
  };
  return { ok: true, draft };
}
