create table if not exists categories (
  id serial primary key,
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id serial primary key,
  category_id integer not null references categories(id),
  sku text not null,
  packing_qty integer not null,
  packing_unit text not null default '个',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists variants (
  id serial primary key,
  product_id integer not null references products(id) on delete cascade,
  color text not null,
  remaining_cartons integer not null default 0,
  remaining_sets integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists variants_product_color_idx
  on variants (product_id, color);

create index if not exists products_category_id_idx on products (category_id);
create index if not exists variants_product_id_idx on variants (product_id);

create table if not exists stock_movements (
  id serial primary key,
  variant_id integer not null references variants(id) on delete cascade,
  movement_date date not null,
  kind text not null,
  cartons integer not null default 0,
  sets integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_variant_date_idx
  on stock_movements (variant_id, movement_date);

create table if not exists app_settings (
  key text primary key,
  value text not null
);

insert into app_settings (key, value)
values ('warehouse_name', '芳村仓')
on conflict (key) do nothing;

insert into categories (id, name, sort_order)
values (1, '纸罐&铁罐', 1)
on conflict (name) do nothing;

-- Reset sequences after explicit ids
select setval('categories_id_seq', (select coalesce(max(id), 1) from categories));

insert into products (id, category_id, sku, packing_qty, packing_unit, sort_order)
values
  (1, 1, 'H1405-83雅礼花罐', 72, '个', 1),
  (2, 1, 'H1506-73慢品（高）', 150, '个', 2),
  (3, 1, 'H1506-73B慢品（矮）', 200, '个', 3),
  (4, 1, 'H1506-83慢品', 70, '个', 4)
on conflict (id) do nothing;

select setval('products_id_seq', (select coalesce(max(id), 1) from products));

insert into variants (id, product_id, color, remaining_cartons, remaining_sets, sort_order)
values
  (1, 1, '黄色', 7, 25, 1),
  (2, 1, '红色', 1, 121, 2),
  (3, 2, '橙色', 0, 0, 1),
  (4, 2, '绿色', 5, 52, 2),
  (5, 3, '橙色', 7, 30, 1),
  (6, 3, '红色', 2, 67, 2),
  (7, 3, '绿色', 0, 61, 3),
  (8, 4, '红色', 19, 44, 1),
  (9, 4, '橙色', 11, 10, 2),
  (10, 4, '绿色', 0, 0, 3)
on conflict (id) do nothing;

select setval('variants_id_seq', (select coalesce(max(id), 1) from variants));
