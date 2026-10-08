import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import {
  buildImportDraft,
  sheetToCellMatrix,
  type ImportDraft,
} from "@/lib/ledger-import";
import { writeDraftToDb } from "@/lib/inventory-import-core";

/** 服务器函数只走 JSON 序列化，ArrayBuffer 用 base64 传输。 */
function bytesFromBase64(b64: string): Uint8Array {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
}

/**
 * exceljs 只在 handler（服务端执行）里动态 import：本模块会被客户端 bundle
 * 引用，静态 import 会把整个 Node 库打进浏览器包里。
 */
async function parseWorkbook(data: Uint8Array, sheetName?: string): Promise<ImportDraft> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const ws =
    (sheetName ? wb.getWorksheet(sheetName) : undefined) ??
    wb.getWorksheet("芳村仓") ??
    wb.worksheets[0];
  if (!ws) throw new Error("这个文件里没有找到任何工作表。");
  const { cells, rawCells, rowCount } = sheetToCellMatrix(ws as never, 17);
  const ledgerDate = new Date().toISOString().slice(0, 10);
  const res = buildImportDraft(cells, rawCells, rowCount, {
    ledgerDate,
    warehouseName: "芳村仓",
  });
  if (!res.ok) throw new Error(res.error);
  return res.draft;
}

/** 解析上传的 Excel → 返回导入预览（不落库）。 */
export const parseImportFile = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = (input as { base64?: string; sheetName?: string }).base64;
    if (!data || data.length > 30_000_000) throw new Error("文件为空或超过 20MB。");
    return { base64: data, sheetName: (input as { sheetName?: string }).sheetName };
  })
  .handler(async ({ data }) => {
    const bytes = bytesFromBase64(data.base64);
    const draft = await parseWorkbook(bytes, data.sheetName);
    // 预览只回传汇总与前 50 条样本，避免 payload 过大。
    return {
      ok: true as const,
      stats: draft.stats,
      groups: draft.groups,
      categories: draft.categories,
      ledgerDate: draft.ledgerDate,
      warnings: draft.warnings.slice(0, 50),
      warningsTruncated: draft.warnings.length > 50,
      sample: draft.variants.slice(0, 50),
    };
  });

/** 把上传的 Excel 重新解析并写入数据库（清空重建，单事务）。 */
export const commitImport = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = (input as { base64?: string; sheetName?: string }).base64;
    if (!data || data.length > 30_000_000) throw new Error("文件为空或超过 20MB。");
    return { base64: data, sheetName: (input as { sheetName?: string }).sheetName };
  })
  .handler(async ({ data }) => {
    const bytes = bytesFromBase64(data.base64);
    const draft = await parseWorkbook(bytes, data.sheetName);
    if (draft.variants.length === 0) throw new Error("解析结果为空，没有可写入的数据。");
    const sql = await getSql();
    const result = await writeDraftToDb(sql, draft);
    return { ok: true as const, ...result };
  });
