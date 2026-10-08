-- 多仓库支持：variants 增加 warehouse 列（芳村 / 龙归 / …）。
-- 兼容既有数据：导入功能曾把其他仓写成「黄色（龙归）」颜色后缀，这里迁移为独立仓库行。

-- 1) 先放宽旧的 (product_id, color) 唯一约束，否则第 3 步会产生冲突。
drop index if exists variants_product_color_idx;

alter table variants add column if not exists warehouse text not null default '芳村';

-- 2) 把「××（龙归）」后缀行转换为 龙归 仓的同色行。
update variants
set warehouse = '龙归',
    color = trim(regexp_replace(color, '\s*[（(]龙归[)）]\s*$', ''))
where color ~ '[（(]龙归[)）]\s*$';

-- 3) 按新维度重建唯一约束：同货号同颜色在不同仓库各自一行。
create unique index if not exists variants_product_color_warehouse_idx
  on variants (product_id, color, warehouse);

create index if not exists variants_warehouse_idx on variants (warehouse);
