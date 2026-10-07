import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export type LedgerHandlers = {
  onAddVariant: (product: InventoryProduct) => void;
  onEditProduct: (product: InventoryProduct) => void;
  onDeleteProduct: (product: InventoryProduct) => void;
  onEditVariant: (product: InventoryProduct, variant: InventoryVariant) => void;
  onDeleteVariant: (product: InventoryProduct, variant: InventoryVariant) => void;
  onMove: (kind: MovementKind, product: InventoryProduct, variant: InventoryVariant) => void;
  onHistory: (product: InventoryProduct, variant: InventoryVariant) => void;
};

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="操作" className="print:hidden">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handlers.onMove("in", product, variant)}>入库</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onMove("out", product, variant)}>出库</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onMove("adjust", product, variant)}>
          修正库存
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onHistory(product, variant)}>流水</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => handlers.onAddVariant(product)}>添加颜色</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onEditVariant(product, variant)}>编辑颜色</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlers.onEditProduct(product)}>编辑货号</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => handlers.onDeleteVariant(product, variant)}>
          删除颜色
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => handlers.onDeleteProduct(product)}>
          删除货号
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LedgerTable({
  categories,
  handlers,
}: {
  categories: InventoryCategory[];
  handlers: LedgerHandlers;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-ledger">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">货号</th>
            <th className="px-3 py-3 font-medium">装箱数量</th>
            <th className="px-3 py-3 font-medium">颜色及型号</th>
            <th className="px-3 py-3 font-medium">本日入</th>
            <th className="px-3 py-3 font-medium">本日出</th>
            <th className="px-3 py-3 font-medium">剩余数量</th>
            <th className="w-12 px-2 py-3 print:hidden">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <CategoryBlock key={category.id} category={category} handlers={handlers} />
          ))}
        </tbody>
      </table>
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
        category.products.map((product) =>
          product.variants.map((variant, index) => (
            <tr key={variant.id} className="border-t border-rule/80 hover:bg-muted/40">
              {index === 0 ? (
                <td
                  rowSpan={product.variants.length}
                  className="border-r border-rule/70 px-4 py-3 align-top font-medium"
                >
                  {product.sku}
                </td>
              ) : null}
              {index === 0 ? (
                <td
                  rowSpan={product.variants.length}
                  className="border-r border-rule/70 px-3 py-3 align-top tabular-nums text-muted-foreground"
                >
                  {formatPacking(product.packingQty, product.packingUnit)}
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
              <td className="px-2 py-2 text-right print:hidden">
                <RowMenu product={product} variant={variant} handlers={handlers} />
              </td>
            </tr>
          )),
        )
      )}
    </>
  );
}

export function LedgerCards({
  categories,
  handlers,
}: {
  categories: InventoryCategory[];
  handlers: LedgerHandlers;
}) {
  return (
    <div className="flex flex-col gap-5">
      {categories.map((category) => (
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
                    {formatPacking(product.packingQty, product.packingUnit)}
                  </span>
                </header>
                <ul className="flex flex-col">
                  {product.variants.map((variant) => (
                    <li
                      key={variant.id}
                      className="flex items-center justify-between gap-2 border-b border-rule/60 py-2.5 last:border-0"
                    >
                      <div className="min-w-0">
                        <ColorLabel color={variant.color} />
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
    </div>
  );
}
