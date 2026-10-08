import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Upload, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { commitImport, parseImportFile } from "@/lib/inventory-import-fns";

type Preview = {
  stats: {
    categoryCount: number;
    productCount: number;
    variantCount: number;
    movementCount: number;
    warningCount: number;
  };
  groups: { name: string; date: string | null; role: string }[];
  categories: string[];
  ledgerDate: string;
  warnings: { row: number; sku: string; message: string }[];
  warningsTruncated: boolean;
  sample: {
    row: number;
    category: string;
    sku: string;
    color: string;
    cartons: number;
    sets: number;
  }[];
};

const ROLE_LABEL: Record<string, string> = {
  main: "当前库存",
  other: "其他仓（并入颜色）",
  ignored: "旧快照（忽略）",
};

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<{ base64: string; name: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);

  function reset() {
    setPreview(null);
    fileRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    if (committing) return;
    onOpenChange(false);
    reset();
  }

  async function onFile(file: File) {
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      toast.error("请选择 .xlsx 库存表格（本次不支持 .xls 老格式）。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("文件超过 20MB，请压缩后再导入。");
      return;
    }
    setParsing(true);
    setPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const base64 = btoa(binary);
      fileRef.current = { base64, name: file.name };
      const res = await parseImportFile({ data: { base64 } });
      setPreview(res);
    } catch (err) {
      fileRef.current = null;
      toast.error(`解析失败：${errorMessage(err)}`);
    } finally {
      setParsing(false);
    }
  }

  async function onCommit() {
    const file = fileRef.current;
    if (!file) return;
    setCommitting(true);
    try {
      const res = await commitImport({ data: { base64: file.base64 } });
      toast.success(
        `导入完成：${res.categories} 个分类、${res.products} 个货号、${res.variants} 个颜色款`,
      );
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["categories"] });
      void qc.invalidateQueries({ queryKey: ["movements"] });
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(`导入失败：${errorMessage(err)}`);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => close()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-primary" />
            导入库存表格
          </DialogTitle>
          <DialogDescription>
            按「芳村仓」模板（货号 / 装箱数量 / 颜色及型号 / 本日入 / 本日出 /
            剩余数量）导入。<span className="text-primary font-medium">导入会清空现有台账</span>
            ，用表格内容整体重建，导入前请确认。
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />

        {!preview && !parsing && (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              选择库存 Excel 文件，先预览解析结果，确认无误再写入台账。
            </p>
            <Button className="mt-4" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              选择文件
            </Button>
          </div>
        )}

        {parsing && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            正在解析文件…
          </div>
        )}

        {preview && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>已解析：{fileRef.current?.name}</span>
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                换文件
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="分类" value={String(preview.stats.categoryCount)} />
              <Mini label="货号" value={String(preview.stats.productCount)} />
              <Mini label="颜色款" value={String(preview.stats.variantCount)} />
              <Mini label="流水" value={String(preview.stats.movementCount)} />
            </div>

            <div className="flex flex-wrap gap-1.5 text-xs">
              {preview.groups.map((g, i) => (
                <span
                  key={i}
                  className="rounded border border-border bg-secondary px-1.5 py-0.5 text-secondary-foreground"
                >
                  {g.name} {g.date ?? ""} · {ROLE_LABEL[g.role] ?? g.role}
                </span>
              ))}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                分类：{preview.categories.join("、")}
              </p>
              <div className="max-h-32 overflow-y-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1 font-medium">行</th>
                      <th className="px-2 py-1 font-medium">货号</th>
                      <th className="px-2 py-1 font-medium">颜色</th>
                      <th className="px-2 py-1 text-right font-medium">件</th>
                      <th className="px-2 py-1 text-right font-medium">散</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.slice(0, 20).map((v, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2 py-1 text-muted-foreground tabular-nums">{v.row}</td>
                        <td className="px-2 py-1">{v.sku}</td>
                        <td className="px-2 py-1">{v.color}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{v.cartons}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{v.sets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.sample.length >= 20 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  仅显示前 20 行，共 {preview.stats.variantCount} 个颜色款。
                </p>
              )}
            </div>

            {preview.stats.warningCount > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
                <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
                  <TriangleAlert className="size-3.5" />
                  {preview.stats.warningCount} 条提醒（不影响导入，建议导入后核对）
                </p>
                <ul className="mt-1 max-h-24 overflow-y-auto text-xs text-muted-foreground">
                  {preview.warnings.slice(0, 12).map((w, i) => (
                    <li key={i} className="truncate">
                      第 {w.row} 行 {w.sku ? `「${w.sku}」` : ""}：{w.message}
                    </li>
                  ))}
                  {preview.warningsTruncated && (
                    <li>……（其余提醒见导入后台账核对）</li>
                  )}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={committing}>
                取消
              </Button>
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => void onCommit()}
                disabled={committing || preview.stats.variantCount === 0}
              >
                {committing ? "写入中…" : `确认导入并重建台账（${preview.stats.variantCount} 款）`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-card px-2 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
