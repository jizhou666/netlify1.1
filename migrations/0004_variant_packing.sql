-- 装箱数量下沉到颜色/型号行：同一货号不同型号（高/矮）装箱数量不同。
-- variants 自带 packing 列；为空时回退到 products 的货号级装箱数量（兼容旧行）。

alter table variants add column if not exists packing_qty integer;
alter table variants add column if not exists packing_unit text;

-- 初始回填：所有现有行先继承所属货号的装箱数量，行为与改造前一致。
update variants
set packing_qty = (select p.packing_qty from products p where p.id = variants.product_id),
    packing_unit = (select p.packing_unit from products p where p.id = variants.product_id)
where packing_qty is null;
