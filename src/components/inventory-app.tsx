import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FolderTree, Plus, Printer, Search, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CategoryDialog,
  ConfirmDeleteDialog,
  HistorySheet,
  MovementFormDialog,
  ProductFormDialog,
  VariantFormDialog,
  type ConfirmState,
  type HistoryState,
  type MovementDialogState,
  type ProductDialogState,
  type VariantDialogState,
} from "@/components/inventory-dialogs";
import { LedgerCards, LedgerTable, type LedgerHandlers } from "@/components/ledger-table";
import {
  formatLedgerDate,
  ledgerToCsv,
  todayISO,
  type CategoryOption,
  type InventoryPayload,
  type InventoryProduct,
  type InventoryVariant,
  type MovementKind,
} from "@/lib/inventory";
import { listCategories, listInventory } from "@/lib/inventory-fns";

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

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
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 200);

  const [productDialog, setProductDialog] = useState<ProductDialogState>({ open: false });
  const [variantDialog, setVariantDialog] = useState<VariantDialogState>({ open: false });
  const [movementDialog, setMovementDialog] = useState<MovementDialogState>({ open: false });
  const [history, setHistory] = useState<HistoryState>({ open: false });
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });
  const [categoryOpen, setCategoryOpen] = useState(false);

  const inventoryQuery = useQuery({
    queryKey: ["inventory", date, q],
    queryFn: () => listInventory({ data: { date, q } }),
    initialData: date === initial.date && q === "" ? initial.inventory : undefined,
    placeholderData: keepPreviousData,
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCategories(),
    initialData: initial.categories,
  });

  const data = inventoryQuery.data;
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
                {data?.warehouseName ?? "芳村仓"} · {formatLedgerDate(date)}
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

        <div className="relative print:hidden">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索货号或颜色"
            className="pl-9"
            aria-label="搜索"
          />
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
              <LedgerTable categories={data.categories} handlers={handlers} />
            </div>
            <div className="md:hidden">
              <LedgerCards categories={data.categories} handlers={handlers} />
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card px-5 py-16 text-center">
            <p className="font-display text-lg font-semibold">暂无匹配货品</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {q ? "换个关键词试试，或清空搜索。" : "从新增货品开始建立台账。"}
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
        onOpenChange={(open) => {
          if (!open) setProductDialog({ open: false });
        }}
      />
      <VariantFormDialog
        state={variantDialog}
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
      <ConfirmDeleteDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm({ open: false });
        }}
      />
      <CategoryDialog open={categoryOpen} onOpenChange={setCategoryOpen} categories={categories} />
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
