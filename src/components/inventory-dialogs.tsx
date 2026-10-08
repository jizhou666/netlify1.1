import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { QtyFields } from "@/components/qty-fields";
import { ColorDot } from "@/components/color-dot";
import { errorMessage } from "@/lib/errors";
import {
  formatLedgerDate,
  formatPacking,
  formatQty,
  KIND_LABEL,
  type CategoryOption,
  type InventoryProduct,
  type InventoryVariant,
  type MovementKind,
} from "@/lib/inventory";
import {
  createCategory,
  createProduct,
  createVariant,
  deleteCategory,
  deleteProduct,
  deleteVariant,
  listMovements,
  recordMovement,
  updateProduct,
  updateVariant,
} from "@/lib/inventory-fns";

export type ProductDialogState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit"; product: InventoryProduct };

export type VariantDialogState =
  | { open: false }
  | { open: true; mode: "create"; product: InventoryProduct }
  | { open: true; mode: "edit"; product: InventoryProduct; variant: InventoryVariant };

export type MovementDialogState =
  | { open: false }
  | {
      open: true;
      kind: MovementKind;
      product: InventoryProduct;
      variant: InventoryVariant;
    };

export type HistoryState =
  | { open: false }
  | { open: true; product: InventoryProduct; variant: InventoryVariant };

export type ConfirmState =
  | { open: false }
  | { open: true; type: "product"; product: InventoryProduct }
  | {
      open: true;
      type: "variant";
      product: InventoryProduct;
      variant: InventoryVariant;
    };

function invalidateInventory(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["inventory"] });
  void qc.invalidateQueries({ queryKey: ["categories"] });
  void qc.invalidateQueries({ queryKey: ["movements"] });
}

export function ProductFormDialog({
  state,
  onOpenChange,
  categories,
  warehouse,
}: {
  state: ProductDialogState;
  onOpenChange: (open: boolean) => void;
  categories: CategoryOption[];
  warehouse: string;
}) {
  const qc = useQueryClient();
  const editing = state.open && state.mode === "edit" ? state.product : null;
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [packingQty, setPackingQty] = useState(72);
  const [packingUnit, setPackingUnit] = useState("个");
  const [color, setColor] = useState("");
  const [cartons, setCartons] = useState(0);
  const [sets, setSets] = useState(0);
  const [newCategory, setNewCategory] = useState("");
  const [syncVariants, setSyncVariants] = useState(false);

  useEffect(() => {
    if (!state.open) return;
    if (state.mode === "edit") {
      setSku(state.product.sku);
      setCategoryId(String(state.product.categoryId));
      setPackingQty(state.product.packingQty);
      setPackingUnit(state.product.packingUnit);
    } else {
      setSku("");
      setCategoryId(categories[0] ? String(categories[0].id) : "");
      setPackingQty(72);
      setPackingUnit("个");
      setColor("");
      setCartons(0);
      setSets(0);
    }
    setSyncVariants(false);
    setNewCategory("");
  }, [state, categories]);

  const save = useMutation({
    mutationFn: async () => {
      let catId = Number(categoryId);
      if (newCategory.trim()) {
        const created = await createCategory({ data: { name: newCategory.trim() } });
        catId = created.id;
      }
      if (!catId) throw new Error("请选择分类");
      if (!sku.trim()) throw new Error("请填写货号");
      if (editing) {
        await updateProduct({
          data: {
            id: editing.id,
            categoryId: catId,
            sku: sku.trim(),
            packingQty,
            packingUnit: packingUnit.trim() || "个",
            syncVariants,
          },
        });
        return;
      }
      if (!color.trim()) throw new Error("请填写颜色");
      await createProduct({
        data: {
          categoryId: catId,
          sku: sku.trim(),
          packingQty,
          packingUnit: packingUnit.trim() || "个",
          color: color.trim(),
          remainingCartons: cartons,
          remainingSets: sets,
          warehouse,
        },
      });
    },
    onSuccess: () => {
      toast.success(editing ? "货号已更新" : "已新增货品");
      invalidateInventory(qc);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑货号" : "新增货品"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "修改货号、分类与默认装箱规格；单个型号的装箱数量请在「编辑颜色」里单独设置。"
              : "先建货号（装箱数量作为各型号的默认值），并录入第一种颜色的库存。"}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="sku">货号</Label>
            <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="H1405-83雅礼花罐" />
          </div>
          <div className="grid gap-1.5">
            <Label>分类</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="或输入新分类名称"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="packing-qty">装箱数量{editing ? "（货号默认）" : ""}</Label>
              <Input
                id="packing-qty"
                type="number"
                min={1}
                className="tabular-nums"
                value={packingQty}
                onChange={(e) => setPackingQty(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="packing-unit">单位</Label>
              <Input id="packing-unit" value={packingUnit} onChange={(e) => setPackingUnit(e.target.value)} />
            </div>
          </div>
          {editing && (
            <label className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 size-3.5 accent-primary"
                checked={syncVariants}
                onChange={(e) => setSyncVariants(e.target.checked)}
              />
              <span>
                同时把装箱数量套用到该货号的<strong className="font-medium">所有颜色/型号</strong>
                <span className="block text-muted-foreground">
                  不勾选时：这里只是新增型号的默认值，各型号保留自己单独的装箱数量（如高 70、矮 105）。
                </span>
              </span>
            </label>
          )}
          {!editing && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="color">颜色及型号</Label>
                <Input id="color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="红色" />
              </div>
              <QtyFields id="new-stock" cartons={cartons} sets={sets} onCartons={setCartons} onSets={setSets} />
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VariantFormDialog({
  state,
  onOpenChange,
  warehouse,
}: {
  state: VariantDialogState;
  onOpenChange: (open: boolean) => void;
  warehouse: string;
}) {
  const qc = useQueryClient();
  const editing = state.open && state.mode === "edit" ? state.variant : null;
  const product = state.open ? state.product : null;
  const [color, setColor] = useState("");
  const [cartons, setCartons] = useState(0);
  const [sets, setSets] = useState(0);
  // 装箱数量按型号单独保存；留空表示跟随货号默认。
  const [packingQty, setPackingQty] = useState("");
  const [packingUnit, setPackingUnit] = useState("");

  useEffect(() => {
    if (!state.open) return;
    if (state.mode === "edit") {
      setColor(state.variant.color);
      setPackingQty(String(state.variant.packingQty));
      setPackingUnit(state.variant.packingUnit);
    } else {
      setColor("");
      setCartons(0);
      setSets(0);
      setPackingQty(String(state.product.packingQty));
      setPackingUnit(state.product.packingUnit);
    }
  }, [state]);

  const save = useMutation({
    mutationFn: async () => {
      if (!product) return;
      if (!color.trim()) throw new Error("请填写颜色");
      const qtyText = packingQty.trim();
      let qty: number | null = null;
      if (qtyText !== "") {
        qty = Number.parseInt(qtyText, 10);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("装箱数量要填正整数，或留空跟随货号默认");
      }
      const unit = qty == null ? null : packingUnit.trim() || "个";
      if (editing) {
        await updateVariant({
          data: { id: editing.id, color: color.trim(), packingQty: qty, packingUnit: unit },
        });
        return;
      }
      await createVariant({
        data: {
          productId: product.id,
          color: color.trim(),
          remainingCartons: cartons,
          remainingSets: sets,
          warehouse,
          packingQty: qty ?? undefined,
          packingUnit: unit ?? undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success(editing ? "颜色已更新" : "已添加颜色");
      invalidateInventory(qc);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑颜色" : "添加颜色"}</DialogTitle>
          <DialogDescription>
            {product
              ? `${product.sku} · 货号默认 ${formatPacking(product.packingQty, product.packingUnit)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="variant-color">颜色及型号</Label>
            <Input id="variant-color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="橙色" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="variant-packing-qty">装箱数量</Label>
              <Input
                id="variant-packing-qty"
                type="number"
                min={1}
                inputMode="numeric"
                className="tabular-nums"
                value={packingQty}
                placeholder="留空=跟随货号"
                onChange={(e) => setPackingQty(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="variant-packing-unit">单位</Label>
              <Input
                id="variant-packing-unit"
                value={packingUnit}
                placeholder="个"
                onChange={(e) => setPackingUnit(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            同一货号的不同型号可以各装各的（如「高」70个/件、「矮」105个/件）；留空则跟随货号默认。
          </p>
          {!editing && (
            <QtyFields id="variant-stock" cartons={cartons} sets={sets} onCartons={setCartons} onSets={setSets} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MovementFormDialog({
  state,
  date,
  onOpenChange,
}: {
  state: MovementDialogState;
  date: string;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [cartons, setCartons] = useState(0);
  const [sets, setSets] = useState(0);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!state.open) return;
    if (state.kind === "adjust") {
      setCartons(state.variant.remainingCartons);
      setSets(state.variant.remainingSets);
    } else {
      setCartons(0);
      setSets(0);
    }
    setNote("");
  }, [state]);

  const save = useMutation({
    mutationFn: async () => {
      if (!state.open) return;
      await recordMovement({
        data: {
          variantId: state.variant.id,
          date,
          kind: state.kind,
          cartons,
          sets,
          note: note.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      if (!state.open) return;
      toast.success(`${KIND_LABEL[state.kind]}已登记`);
      invalidateInventory(qc);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const kind = state.open ? state.kind : "in";
  const titles: Record<MovementKind, string> = {
    in: "登记入库",
    out: "登记出库",
    adjust: "修正库存",
  };

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[kind]}</DialogTitle>
          {state.open && (
            <DialogDescription>
              {state.product.sku} · {state.variant.color} · 现有{" "}
              {formatQty(state.variant.remainingCartons, state.variant.remainingSets)}
              <span className="block">
                装箱 {formatPacking(state.variant.packingQty, state.variant.packingUnit)}
                {state.kind === "out" ? "，出库时按此规格把「件」折算成「套/个」" : ""}
              </span>
            </DialogDescription>
          )}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <QtyFields id="move" cartons={cartons} sets={sets} onCartons={setCartons} onSets={setSets} />
          <div className="grid gap-1.5">
            <Label htmlFor="move-note">备注</Label>
            <Textarea
              id="move-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="可选"
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "提交中…" : "确认"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HistorySheet({ state, onOpenChange }: { state: HistoryState; onOpenChange: (open: boolean) => void }) {
  const enabled = state.open;
  const variantId = state.open ? state.variant.id : 0;
  const query = useQuery({
    queryKey: ["movements", variantId],
    queryFn: () => listMovements({ data: { variantId } }),
    enabled,
  });

  return (
    <Sheet open={state.open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>出入库流水</SheetTitle>
          {state.open && (
            <SheetDescription>
              {state.product.sku} · {state.variant.color}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : query.data && query.data.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {query.data.map((m) => (
                <li key={m.id} className="border-b border-border pb-3 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{KIND_LABEL[m.kind]}</span>
                    <span className="tabular-nums text-sm">{formatQty(m.cartons, m.sets)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{formatLedgerDate(m.movementDate)}</p>
                  {m.note ? <p className="mt-1 text-sm">{m.note}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">还没有流水记录。</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ConfirmDeleteDialog({
  state,
  onOpenChange,
}: {
  state: ConfirmState;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      if (!state.open) return;
      if (state.type === "product") {
        await deleteProduct({ data: { id: state.product.id } });
      } else {
        await deleteVariant({ data: { id: state.variant.id } });
      }
    },
    onSuccess: () => {
      toast.success("已删除");
      invalidateInventory(qc);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const title =
    state.open && state.type === "product" ? `删除货号 ${state.product.sku}？` : "删除此颜色？";
  const desc =
    state.open && state.type === "product"
      ? "将同时删除该货号下全部颜色及出入库记录，此操作无法撤销。"
      : state.open
        ? `${state.product.sku} · ${state.variant.color}`
        : "";

  return (
    <AlertDialog open={state.open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate()} disabled={remove.isPending}>
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CategoryDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryOption[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("请填写分类名称");
      await createCategory({ data: { name: name.trim() } });
    },
    onSuccess: () => {
      toast.success("已新增分类");
      setName("");
      invalidateInventory(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteCategory({ data: { id } }),
    onSuccess: () => {
      toast.success("已删除分类");
      invalidateInventory(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>分类管理</DialogTitle>
          <DialogDescription>分类用于台账分组，例如纸罐&铁罐。</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="新分类名称" />
          <Button type="submit" disabled={add.isPending}>
            添加
          </Button>
        </form>
        <ul className="grid gap-1">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent">
              <span className="text-sm">{c.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-primary"
                onClick={() => remove.mutate(c.id)}
              >
                删除
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function ColorLabel({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <ColorDot color={color} />
      {color}
    </span>
  );
}
