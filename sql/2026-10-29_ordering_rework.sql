-- Ordering rework (Oct 29 2026). ADDITIVE ONLY — nothing dropped or renamed,
-- so the previous app version keeps working against this schema.

-- ── Orders: monthly sequence per store (keyed on pickup month) ────────────
alter table public.orders
  add column if not exists order_seq integer,
  add column if not exists stock_override boolean not null default false;

-- Counter table: one row per store per pickup month. The upsert below takes a
-- row lock, so two iPads asking at the same moment get different numbers.
create table if not exists public.order_counters (
  location_id text not null,
  ym text not null,                       -- 'YYYY-MM' of pickup_date
  last integer not null default 0,
  primary key (location_id, ym)
);
alter table public.order_counters enable row level security;
drop policy if exists "counters via function only" on public.order_counters;
-- No direct access; the function below is SECURITY DEFINER.

create or replace function public.next_order_seq(p_location text, p_pickup_date text)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.order_counters (location_id, ym, last)
  values (p_location, substr(p_pickup_date, 1, 7), 1)
  on conflict (location_id, ym)
  do update set last = public.order_counters.last + 1
  returning last;
$$;
revoke all on function public.next_order_seq(text, text) from public;
grant execute on function public.next_order_seq(text, text) to anon, authenticated;

-- Guard against duplicates even if something bypasses the function.
create unique index if not exists orders_location_month_seq_uq
  on public.orders (location_id, substr(pickup_date, 1, 7), order_seq)
  where order_seq is not null;

-- ── Order items: per-line note, decimal quantities (2.5 lb) ───────────────
alter table public.order_items
  add column if not exists note text;
alter table public.order_items
  alter column quantity type numeric(8,2) using quantity::numeric;

-- ── Items: picker structure and inventory tracking flag ───────────────────
alter table public.items
  add column if not exists category text,
  add column if not exists short_name text,
  add column if not exists tracked boolean not null default false;

-- ── Store settings: alert email for stock overrides ───────────────────────
alter table public.printer_settings
  add column if not exists alert_email text;

-- The app talks to Supabase as `anon` (login is the app's own users table),
-- but printer_settings only allowed `authenticated`. Match the other tables.
drop policy if exists "Authenticated users can write printer settings" on public.printer_settings;
drop policy if exists "Authenticated users can read printer settings" on public.printer_settings;
drop policy if exists "allow all" on public.printer_settings;
create policy "allow all" on public.printer_settings for all to public using (true) with check (true);

-- ── Backfill ──────────────────────────────────────────────────────────────
-- Existing orders get a monthly number in invoice order; counters seeded from them.
with numbered as (
  select id,
         row_number() over (partition by location_id, substr(pickup_date, 1, 7) order by invoice_number, created_at) as n
  from public.orders
  where order_seq is null
)
update public.orders o set order_seq = numbered.n from numbered where o.id = numbered.id;

insert into public.order_counters (location_id, ym, last)
select location_id, substr(pickup_date, 1, 7), max(order_seq)
from public.orders where order_seq is not null
group by location_id, substr(pickup_date, 1, 7)
on conflict (location_id, ym) do update set last = greatest(public.order_counters.last, excluded.last);

-- Pools with inventory rows are tracked; everything else is not.
update public.items set tracked = true where id like 'pool-%';

-- First-pass categories and pill labels (tune in Admin → Items).
update public.items set category = 'Turkeys', short_name = replace(replace(replace(name, 'Bell & Evans Turkey', 'B&E'), 'Iavarone Brothers Turkey', 'IB'), ' - ', ' ')
  where id like 'pool-%';
update public.items set category = 'Turkeys', short_name = case when name ilike '%Oven Ready%' then 'Oven Ready' else 'Plain' end
  where parent_id like 'pool-%';
update public.items set category = 'Turkey Breast', short_name = regexp_replace(regexp_replace(regexp_replace(name, '^Bone In Turkey Breast\s+', 'Bone-In '), '\s+lb$', ' lb'), '-\s+', '-')
  where name ilike 'Bone In Turkey Breast%';
update public.items set category = 'Turkey Breast', short_name = regexp_replace(name, '^Boneless Turkey Breast\s+(\d+) lb.*$', 'Boneless \1 lb')
  where name ilike 'Boneless Turkey Breast%';
update public.items set category = 'Turkey Breast', short_name = 'Stuffed Apple & Cornbread'
  where name ilike 'Stuffed Turkey Breast%';
update public.items set category = 'Chop Meat', short_name = trim(replace(name, 'Chop Meat -', ''))
  where name ilike 'Chop Meat%';
update public.items set category = 'Other', short_name = case
    when name ilike 'All Natural Chicken Cutlets' then 'Chicken Cutlets'
    when name ilike 'Bone-In Spiral Ham%' then 'Spiral Ham 1/2'
    else trim(name) end
  where category is null;

-- ── App-wide settings (Oct 30): session timeout ───────────────────────────
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "allow all" on public.app_settings;
create policy "allow all" on public.app_settings for all to public using (true) with check (true);
insert into public.app_settings (key, value) values ('session_timeout_minutes', '240')
on conflict (key) do nothing;
