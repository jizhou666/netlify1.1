import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CloudUpload,
  Download,
  FolderTree,
  Plus,
  Printer,
  Search,
  Upload,
  Warehouse,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportDialog } from "@/components/import-dialog";
import { CloudSyncDialog } from "@/components/cloud-sync-dialog";
import {
  CategoryDialog,
  ConfirmDeleteDialog,
  HistorySheet,
  MovementFormDialog,
  ProductFormDialog,
  RowActionDialog,
  VariantFormDialog,
  type ConfirmState,
  type HistoryState,
  type MovementDialogState,
  type ProductDialogState,
  type RowActionState,
  type VariantDialogState,
} from "@/components/inventory-dialogs";
import { LedgerCards, LedgerTable, type LedgerHandlers } from "@/components/ledger-table";
import {
  filterInventory,
  formatLedgerDate,
  ledgerToCsv,
  todayISO,
  warehouseLabel,
  type CategoryOption,
  type InventoryPayload,
  type InventoryProduct,
  type InventoryVariant,
  type MovementKind,
} from "@/lib/inventory";
import { listCategories, listInventory } from "@/lib/inventory-fns";
import { cloudSyncStatus } from "@/lib/cloud-sync-fns";

export function InventoryApp({
  initial,
}: {
  initial: {
    date: string;
    inventory: InventoryPayload;
    categories: CategoryOption[];
  };
}) {
  const [date, setDate] = useState(initial.date);
  const [warehouse, setWarehouse] = useState(initial.inventory.warehouse || "芳村");
  const [search, setSearch] = useState("");

  const [productDialog, setProductDialog] = useState<ProductDialogState>({ open: false });
  const [variantDialog, setVariantDialog] = useState<VariantDialogState>({ open: false });
  const [movementDialog, setMovementDialog] = useState<MovementDialogState>({ open: false });
  const [history, setHistory] = useState<HistoryState>({ open: false });
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });
  const [rowActions, setRowActions] = useState<RowActionState>({ open: false });
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);

  // 搜索在本地做（见 filterInventory），queryKey 里不再有搜索词：
  // 打字不会再反复打接口，只有换日期/仓库或改完数据才重新请求。
  // 只有配了云端同步地址才显示按钮（没配就藏起来，免得同事点开看到"未配置"）
  const cloudStatusQuery = useQuery({
    queryKey: ["cloud-sync-status"],
    queryFn: () => cloudSyncStatus(),
    staleTime: 5 * 60_000,
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory", date, warehouse],
    queryFn: () => listInventory({ data: { date, warehouse } }),
    initialData:
      date === initial.date && warehouse === initial.inventory.warehouse
        ? initial.inventory
        : undefined,
    placeholderData: keepPreviousData,
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCategories(),
    initialData: initial.categories,
  });

  const raw = inventoryQuery.data;
  const data = useMemo(() => (raw ? filterInventory(raw, search) : undefined), [raw, search]);
  const searching = search.trim().length > 0;
  const categories = categoriesQuery.data ?? [];

  const handlers: LedgerHandlers = useMemo(
    () => ({
      onAddVariant: (product) => setVariantDialog({ open: true, mode: "create", product }),
      onEditProduct: (product) => setProductDialog({ open: true, mode: "edit", product }),
      onDeleteProduct: (product) => setConfirm({ open: true, type: "product", product }),
      onEditVariant: (product, variant) =>
        setVariantDialog({ open: true, mode: "edit", product, variant }),
      onDeleteVariant: (product, variant) =>
        setConfirm({ open: true, type: "variant", product, variant }),
      onOpenActions: (product, variant) => setRowActions({ open: true, product, variant }),
      onMove: (kind: MovementKind, product: InventoryProduct, variant: InventoryVariant) =>
        setMovementDialog({ open: true, kind, product, variant }),
      onHistory: (product, variant) => setHistory({ open: true, product, variant }),
    }),
    [],
  );

  const empty = Boolean(data && data.categories.every((c) => c.products.length === 0));

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Warehouse className="size-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground">库存台账</p>
              <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                芳村仓库存
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data?.warehouseName ?? "芳村仓"}
                {data ? ` · ${warehouseLabel(data.warehouse)}` : ""} · {formatLedgerDate(date)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="w-[11.5rem] tabular-nums print:hidden"
              aria-label="台账日期"
            />
            <Button variant="outline" className="print:hidden" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              <span className="hidden sm:inline">导入表格</span>
            </Button>
            {cloudStatusQuery.data?.configured ? (
              <Button variant="outline" className="print:hidden" onClick={() => setCloudOpen(true)}>
                <CloudUpload className="size-4" />
                <span className="hidden sm:inline">云端同步</span>
              </Button>
            ) : null}
            <Button variant="outline" className="print:hidden" onClick={() => setCategoryOpen(true)}>
              <FolderTree className="size-4" />
              分类
            </Button>
            <Button
              variant="outline"
              className="print:hidden"
              disabled={!data}
              onClick={() => data && downloadCsv(data)}
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">导出</span>
            </Button>
            <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
              <Printer className="size-4" />
              <span className="hidden sm:inline">打印</span>
            </Button>
            <Button className="print:hidden" onClick={() => setProductDialog({ open: true, mode: "create" })}>
              <Plus className="size-4" />
              新增货品
            </Button>
          </div>
        </header>

        {data && data.warehouses.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 print:hidden" role="tablist" aria-label="仓库切换">
            {data.warehouses.map((w) => {
              const active = w === (data.warehouse ?? warehouse);
              return (
                <button
                  key={w}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setWarehouse(w)}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {warehouseLabel(w)}
                </button>
              );
            })}
          </div>
        )}

        {data ? (
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="货号" value={String(data.stats.productCount)} />
            <Stat label="颜色款" value={String(data.stats.variantCount)} />
            <Stat label="缺货" value={String(data.stats.outOfStock)} warn={data.stats.outOfStock > 0} />
            <Stat
              label="本日出入"
              value={`${data.stats.todayInLines}/${data.stats.todayOutLines}`}
            />
          </section>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        )}

        <div className="print:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索货号或颜色（本地筛选，输入即出结果）"
              className="pl-9 pr-9"
              aria-label="搜索"
            />
            {searching ? (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          {searching && data ? (
            <p className="mt-1.5 px-1 text-xs text-muted-foreground">
              匹配 <span className="font-medium text-foreground">{data.stats.productCount}</span> 个货号 ·{" "}
              <span className="font-medium text-foreground">{data.stats.variantCount}</span> 个颜色款
              {data.stats.productCount === 0 ? "（换个关键词试试）" : ""}
            </p>
          ) : null}
        </div>

        {inventoryQuery.isLoading ? (
          <Skeleton className="h-80 rounded-xl" />
        ) : inventoryQuery.isError ? (
          <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            台账加载失败，请刷新重试。
          </div>
        ) : data && !empty ? (
          <>
            <div className="hidden md:block">
              <LedgerTable categories={data.categories} handlers={handlers} resetKey={search} />
            </div>
            <div className="md:hidden">
              <LedgerCards categories={data.categories} handlers={handlers} resetKey={search} />
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card px-5 py-16 text-center">
            <p className="font-display text-lg font-semibold">暂无匹配货品</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {searching ? "换个关键词试试，或点搜索框右侧的 × 清空。" : "从新增货品开始建立台账。"}
            </p>
            <Button className="mt-4" onClick={() => setProductDialog({ open: true, mode: "create" })}>
              新增货品
            </Button>
          </div>
        )}
      </div>

      <ProductFormDialog
        state={productDialog}
        categories={categories}
        warehouse={warehouse}
        onOpenChange={(open) => {
          if (!open) setProductDialog({ open: false });
        }}
      />
      <VariantFormDialog
        state={variantDialog}
        warehouse={warehouse}
        onOpenChange={(open) => {
          if (!open) setVariantDialog({ open: false });
        }}
      />
      <MovementFormDialog
        state={movementDialog}
        date={date}
        onOpenChange={(open) => {
          if (!open) setMovementDialog({ open: false });
        }}
      />
      <HistorySheet
        state={history}
        onOpenChange={(open) => {
          if (!open) setHistory({ open: false });
        }}
      />
      <RowActionDialog
        state={rowActions}
        onOpenChange={(open) => {
          if (!open) setRowActions({ open: false });
        }}
        onMove={handlers.onMove}
        onHistory={handlers.onHistory}
        onAddVariant={handlers.onAddVariant}
        onEditVariant={handlers.onEditVariant}
        onEditProduct={handlers.onEditProduct}
        onDeleteVariant={handlers.onDeleteVariant}
        onDeleteProduct={handlers.onDeleteProduct}
      />
      <ConfirmDeleteDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm({ open: false });
        }}
      />
      <CategoryDialog open={categoryOpen} onOpenChange={setCategoryOpen} categories={categories} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <CloudSyncDialog open={cloudOpen} onOpenChange={setCloudOpen} />
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold tabular-nums ${warn ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function downloadCsv(payload: InventoryPayload) {
  const csv = `\uFEFF${ledgerToCsv(payload)}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `芳村仓库存-${payload.date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
