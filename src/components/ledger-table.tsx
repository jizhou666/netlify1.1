import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorLabel } from "@/components/inventory-dialogs";
import {
  formatPacking,
  formatQty,
  isOutOfStock,
  type InventoryCategory,
  type InventoryProduct,
  type InventoryVariant,
  type MovementKind,
} from "@/lib/inventory";
import { cn } from "@/lib/utils";

/** 每批渲染多少个货号（同一货号的所有颜色整块渲染，合并不被切开） */
const PAGE_SIZE = 60;

/**
 * 按「货号」截取前 limit 个，保留分类顺序；空分类只有在还没截断时保留（好显示"该分类暂无货品"）。
 */
function sliceGroups(categories: InventoryCategory[], limit: number): InventoryCategory[] {
  let left = limit;
  const out: InventoryCategory[] = [];
  for (const category of categories) {
    if (category.products.length === 0) {
      if (left > 0) out.push(category);
      continue;
    }
    if (left <= 0) break;
    const take = category.products.slice(0, left);
    left -= take.length;
    out.push(take.length === category.products.length ? category : { ...category, products: take });
  }
  return out;
}

/**
 * 增量渲染：首屏只渲染前 PAGE_SIZE 个货号，滑到底部自动追加下一批。
 * 数据仍是一次性全量取回的，所以搜索/统计不受影响 —— 只是 DOM 少了很多。
 * resetKey（搜索词）变化时才回到第一批；普通数据刷新不重置，避免编辑后列表跳回顶部。
 */
function useIncremental(categories: InventoryCategory[], resetKey: string) {
  const total = useMemo(
    () => categories.reduce((n, category) => n + category.products.length, 0),
    [categories],
  );
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [resetKey]);

  useEffect(() => {
    if (limit > total) setLimit(Math.max(PAGE_SIZE, total));
  }, [total, limit]);

  const visible = useMemo(() => sliceGroups(categories, limit), [categories, limit]);
  const hasMore = limit < total;

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + PAGE_SIZE);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, limit]);

  return { visible, total, limit, hasMore, sentinelRef };
}

export type LedgerHandlers = {
  onAddVariant: (product: InventoryProduct) => void;
  onEditProduct: (product: InventoryProduct) => void;
  onDeleteProduct: (product: InventoryProduct) => void;
  onEditVariant: (product: InventoryProduct, variant: InventoryVariant) => void;
  onDeleteVariant: (product: InventoryProduct, variant: InventoryVariant) => void;
  onMove: (kind: MovementKind, product: InventoryProduct, variant: InventoryVariant) => void;
  onHistory: (product: InventoryProduct, variant: InventoryVariant) => void;
  /** 每行「操作」按钮：打开集成了全部功能的弹窗 */
  onOpenActions: (product: InventoryProduct, variant: InventoryVariant) => void;
};

function LoadMoreHint({
  sentinelRef,
  hasMore,
  limit,
  total,
}: {
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  limit: number;
  total: number;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div
      ref={sentinelRef}
      className="flex items-center justify-center gap-2 border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground print:hidden"
    >
      {hasMore ? (
        <>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          已显示 {Math.min(limit, total)} / {total} 个货号，继续下滑自动加载
        </>
      ) : (
        <>已显示全部 {total} 个货号</>
      )}
    </div>
  );
}

function QtyCell({ cartons, sets, empty }: { cartons: number; sets: number; empty?: boolean }) {
  const zero = cartons === 0 && sets === 0;
  if (empty && zero) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular-nums", zero && "text-primary")}>{formatQty(cartons, sets)}</span>
  );
}

function RowMenu({
  product,
  variant,
  handlers,
}: {
  product: InventoryProduct;
  variant: InventoryVariant;
  handlers: LedgerHandlers;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="操作"
      title="入库 / 出库 / 修正库存 / 编辑颜色、货号 / 删除"
      onClick={() => handlers.onOpenActions(product, variant)}
      className="h-8 px-2.5 text-xs font-medium text-primary hover:bg-primary/8 hover:text-primary print:hidden"
    >
      操作
    </Button>
  );
}

export function LedgerTable({
  categories,
  handlers,
  resetKey = "",
}: {
  categories: InventoryCategory[];
  handlers: LedgerHandlers;
  /** 变化时回到第一批（通常是搜索词） */
  resetKey?: string;
}) {
  const { visible, total, limit, hasMore, sentinelRef } = useIncremental(categories, resetKey);
  return (
    <div className="rounded-xl border border-border bg-card shadow-ledger">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">货号</th>
              <th className="px-3 py-3 font-medium">装箱数量</th>
              <th className="px-3 py-3 font-medium">颜色及型号</th>
              <th className="px-3 py-3 font-medium">本日入</th>
              <th className="px-3 py-3 font-medium">本日出</th>
              <th className="px-3 py-3 font-medium">剩余数量</th>
              <th className="w-20 px-3 py-3 text-right font-medium print:hidden">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((category) => (
              <CategoryBlock key={category.id} category={category} handlers={handlers} />
            ))}
          </tbody>
        </table>
      </div>
      <LoadMoreHint sentinelRef={sentinelRef} hasMore={hasMore} limit={limit} total={total} />
    </div>
  );
}

function CategoryBlock({
  category,
  handlers,
}: {
  category: InventoryCategory;
  handlers: LedgerHandlers;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={7}
          className="bg-primary/8 px-4 py-2 font-display text-sm font-semibold text-primary"
        >
          {category.name}
        </td>
      </tr>
      {category.products.length === 0 ? (
        <tr>
          <td colSpan={7} className="px-4 py-4 text-sm text-muted-foreground">
            该分类暂无货品
          </td>
        </tr>
      ) : (
        category.products.map((product) => (
          <ProductRows key={product.id} product={product} handlers={handlers} />
        ))
      )}
    </>
  );
}

type PackingCell = { span: number; qty: number; unit: string };

/**
 * 同一货号下相邻型号的装箱数量可能相同（红/绿/橙都是 70个/件），也可能不同
 * （高 70个/件、矮 105个/件）。按「连续相同规格」合并成一格：既贴近 Excel 原表，
 * 又不会把「高」的规格错显示到「矮」行上。
 */
export function packingCells(variants: InventoryVariant[]): Map<number, PackingCell> {
  const cells = new Map<number, PackingCell>();
  let i = 0;
  while (i < variants.length) {
    const head = variants[i]!;
    let span = 1;
    while (
      i + span < variants.length &&
      variants[i + span]!.packingQty === head.packingQty &&
      variants[i + span]!.packingUnit === head.packingUnit
    ) {
      span += 1;
    }
    cells.set(i, { span, qty: head.packingQty, unit: head.packingUnit });
    i += span;
  }
  return cells;
}

function ProductRows({
  product,
  handlers,
}: {
  product: InventoryProduct;
  handlers: LedgerHandlers;
}) {
  const cells = packingCells(product.variants);
  return (
    <>
      {product.variants.map((variant, index) => {
        const cell = cells.get(index);
        const isDefault =
          cell != null &&
          cell.qty === product.packingQty &&
          cell.unit === product.packingUnit;
        return (
          <tr key={variant.id} className="group/row border-t border-rule/80 transition-colors hover:bg-muted/40">
            {index === 0 ? (
              <td
                rowSpan={product.variants.length}
                className="border-r border-rule/70 px-4 py-3 align-top font-medium"
              >
                {product.sku}
              </td>
            ) : null}
            {cell ? (
              <td
                rowSpan={cell.span}
                title={isDefault ? "货号默认装箱数量" : "该型号单独的装箱数量"}
                className={cn(
                  "border-r border-rule/70 px-3 py-3 align-top tabular-nums",
                  isDefault ? "text-muted-foreground" : "font-medium text-foreground",
                )}
              >
                {formatPacking(cell.qty, cell.unit)}
              </td>
            ) : null}
            <td className="px-3 py-3">
              <ColorLabel color={variant.color} />
            </td>
            <td className="px-3 py-3">
              <QtyCell cartons={variant.inCartons} sets={variant.inSets} empty />
            </td>
            <td className="px-3 py-3">
              <QtyCell cartons={variant.outCartons} sets={variant.outSets} empty />
            </td>
            <td className="px-3 py-3 font-medium">
              <QtyCell cartons={variant.remainingCartons} sets={variant.remainingSets} />
            </td>
            <td className="px-3 py-2 text-right print:hidden">
              <RowMenu product={product} variant={variant} handlers={handlers} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function LedgerCards({
  categories,
  handlers,
  resetKey = "",
}: {
  categories: InventoryCategory[];
  handlers: LedgerHandlers;
  resetKey?: string;
}) {
  const { visible, total, limit, hasMore, sentinelRef } = useIncremental(categories, resetKey);
  return (
    <div className="flex flex-col gap-5">
      {visible.map((category) => (
        <section key={category.id} className="flex flex-col gap-2">
          <h2 className="px-1 font-display text-sm font-semibold text-primary">{category.name}</h2>
          {category.products.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">该分类暂无货品</p>
          ) : (
            category.products.map((product) => (
              <article key={product.id} className="rounded-xl border border-border bg-card p-3 shadow-ledger">
                <header className="mb-2 flex items-baseline justify-between gap-3 border-b border-border pb-2">
                  <h3 className="font-medium">{product.sku}</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    默认 {formatPacking(product.packingQty, product.packingUnit)}
                  </span>
                </header>
                <ul className="flex flex-col">
                  {product.variants.map((variant) => (
                    <li
                      key={variant.id}
                      className="flex items-center justify-between gap-2 border-b border-rule/60 py-2.5 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <ColorLabel color={variant.color} />
                          {variant.packingQty !== product.packingQty ||
                          variant.packingUnit !== product.packingUnit ? (
                            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums text-secondary-foreground">
                              {formatPacking(variant.packingQty, variant.packingUnit)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          入 <QtyCell cartons={variant.inCartons} sets={variant.inSets} empty />
                          <span className="mx-1.5">·</span>
                          出 <QtyCell cartons={variant.outCartons} sets={variant.outSets} empty />
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            "mr-1 text-sm font-medium tabular-nums",
                            isOutOfStock(variant.remainingCartons, variant.remainingSets) &&
                              "text-primary",
                          )}
                        >
                          {formatQty(variant.remainingCartons, variant.remainingSets)}
                        </span>
                        <RowMenu product={product} variant={variant} handlers={handlers} />
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </section>
      ))}
      <LoadMoreHint sentinelRef={sentinelRef} hasMore={hasMore} limit={limit} total={total} />
    </div>
  );
}
